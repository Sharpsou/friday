import {
  AnswerPlanJsonSchema,
  answerPlanPrompt,
  auditorPrompt,
  auditorRetryPrompt,
  boundedConversationTurns,
  ContextResolutionJsonSchema,
  contextualQuestionPrompt,
  deriveAnswerAudit,
  fallbackAnswerPlan,
  fallbackContextualQuestion,
  needsConversationResolution,
  OllamaClient,
  parseAnswerPlan,
  parseContextResolution,
  requiredAxesCovered,
  routeAnswerPlanPrompt,
  routeDeterministically,
  RoutePlanJsonSchema,
  RoutePlanOutputSchema,
  searchTopicPlanPrompt,
  selectEvidencePassagesHybrid,
  splitAuditUnits,
  stripPassageCitations,
  UnifiedUnitAuditJsonSchema,
  UnitAuditJsonSchema,
  writerPrompt,
  type AnswerAudit,
  type AnswerPlan,
  type AuditUnit,
  type AxisEvidence,
  type EvidenceDossier,
  type FrozenPage,
} from './foundation.js';
import type {
  ChatEngine,
  ChatEngineInput,
  ChatEngineResult,
} from './runtime-contracts.js';
import { runLegacyPipeline } from './runtime/legacy-pipeline.js';
import type { PipelineServices } from './runtime/pipeline-services.js';
import {
  parseAudit,
  resolveAnswer,
  safeAuditFailureCode,
  validateMarkdown,
} from './runtime/publication.js';
import {
  extractReadableParagraphs,
  routeForcedByMode,
} from './runtime/retrieval-policy.js';
import type {
  DiscoveryBundle,
  RuntimePageReader,
  RuntimeSearch,
  VerifiedChatEngineOptions,
} from './runtime/runtime-types.js';
import { runUnifiedPipeline } from './runtime/unified-pipeline.js';
import { runAxesPipeline } from './runtime/withaxes-pipeline.js';

export class SharedChatEngine implements ChatEngine {
  private pipelineServices(): PipelineServices {
    return {
      options: this.options,
      ollama: this.ollama,
      auditorModel: this.auditorModel,
      seed: this.seed,
      contextualizeInput: this.contextualizeInput.bind(this),
      routeAndPlan: this.routeAndPlan.bind(this),
      writerModel: this.writerModel,
      discoverBundle: this.discoverBundle.bind(this),
      pageReader: this.pageReader,
      select: this.select.bind(this),
      discoverPages: this.discoverPages.bind(this),
      noEvidenceFallback: this.noEvidenceFallback.bind(this),
      write: this.write.bind(this),
      audit: this.audit.bind(this),
      evidenceFallback: this.evidenceFallback.bind(this),
    };
  }

  private readonly ollama: Pick<OllamaClient, 'generate' | 'embed'>;
  private readonly search: RuntimeSearch;
  private readonly pageReader: RuntimePageReader;
  private readonly writerModel: string;
  private readonly auditorModel: string;
  private readonly embeddingModel: string;
  private readonly seed: number;
  private readonly axesEnabled: boolean;
  private readonly pipeline: 'unified' | 'axes';

  constructor(private readonly options: VerifiedChatEngineOptions) {
    this.ollama =
      options.ollama ??
      new OllamaClient({ timeoutMs: 240_000, maxQueueSize: 4 });
    this.search = options.search;
    this.pageReader = options.pageReader;
    this.writerModel = options.writerModel ?? 'gemma4:e4b-it-qat';
    this.auditorModel = options.auditorModel ?? 'qwen3.5:9b-q4_K_M';
    this.embeddingModel = options.embeddingModel ?? 'qwen3-embedding:0.6b';
    this.seed = options.seed ?? 17;
    this.axesEnabled = options.axesEnabled ?? false;
    this.pipeline = options.pipeline ?? 'unified';
  }

  webUsage(signal: AbortSignal) {
    if (!this.search.usage)
      return Promise.reject(new Error('WEB_USAGE_UNAVAILABLE'));
    return this.search.usage(signal);
  }

  async answer(input: ChatEngineInput): Promise<ChatEngineResult> {
    input = {
      ...input,
      signal: AbortSignal.any([input.signal, AbortSignal.timeout(300000)]),
    };
    if (this.pipeline === 'unified')
      return runUnifiedPipeline(this.pipelineServices(), input);
    if (this.axesEnabled)
      return runAxesPipeline(this.pipelineServices(), input);
    return runLegacyPipeline(this.pipelineServices(), input);
  }

  private async routeAndPlan(
    input: ChatEngineInput,
    generate: (
      request: Parameters<OllamaClient['generate']>[0],
    ) => Promise<string>,
    unified = false,
  ): Promise<{ route: 'local' | 'web'; plan: AnswerPlan | null }> {
    const forced = routeForcedByMode(input.mode, input.content);
    const deterministic = forced ?? routeDeterministically(input.content);
    if (deterministic?.route === 'local') return { route: 'local', plan: null };
    if (deterministic?.route === 'web') {
      const raw = await generate({
        model: this.auditorModel,
        prompt: unified
          ? searchTopicPlanPrompt(input.content)
          : answerPlanPrompt(input.content),
        seed: this.seed,
        format: AnswerPlanJsonSchema,
        maxTokens: 1_000,
        temperature: 0,
        signal: input.signal,
      });
      return { route: 'web', plan: parseAnswerPlan(raw, input.content) };
    }
    try {
      const raw = await generate({
        model: this.auditorModel,
        prompt: routeAnswerPlanPrompt(input.content, RoutePlanJsonSchema),
        seed: this.seed,
        format: RoutePlanJsonSchema,
        maxTokens: 1_000,
        temperature: 0,
        signal: input.signal,
      });
      const result = RoutePlanOutputSchema.parse(JSON.parse(raw));
      if (result.route === 'local' && result.plan !== null)
        throw new Error('LOCAL_ROUTE_MUST_NOT_HAVE_PLAN');
      if (result.route === 'web' && result.plan === null)
        throw new Error('WEB_ROUTE_REQUIRES_PLAN');
      return { route: result.route, plan: result.plan };
    } catch (error) {
      if (input.signal.aborted) throw error;
      if (
        error instanceof Error &&
        error.message === 'MODEL_CALL_LIMIT_REACHED'
      )
        throw error;
      return { route: 'web', plan: fallbackAnswerPlan(input.content) };
    }
  }

  private async contextualizeInput(
    input: ChatEngineInput,
    generate: (
      request: Parameters<OllamaClient['generate']>[0],
    ) => Promise<string>,
  ): Promise<ChatEngineInput> {
    if (!needsConversationResolution(input.content, input.priorTurns))
      return input;
    try {
      const raw = await generate({
        model: this.auditorModel,
        prompt: contextualQuestionPrompt(
          input.content,
          boundedConversationTurns(input.priorTurns),
        ),
        seed: this.seed,
        format: ContextResolutionJsonSchema,
        maxTokens: 384,
        temperature: 0,
        signal: input.signal,
      });
      return {
        ...input,
        content: parseContextResolution(raw, input.content, input.priorTurns),
      };
    } catch (error) {
      if (input.signal.aborted) throw error;
      if (
        error instanceof Error &&
        error.message === 'MODEL_CALL_LIMIT_REACHED'
      )
        throw error;
      return {
        ...input,
        content: fallbackContextualQuestion(input.content, input.priorTurns),
      };
    }
  }

  private evidenceFallback(
    plan: AnswerPlan,
    assignments: AxisEvidence[],
    dossier: EvidenceDossier,
    modelCalls: number,
    status: 'abstained' | 'audit_error',
    fallbackCode: string,
    audit?: AnswerAudit,
  ): ChatEngineResult {
    const auditAxes = new Map(audit?.axes.map((axis) => [axis.axisId, axis]));
    const passageById = new Map(
      dossier.passages.map((passage) => [passage.id, passage]),
    );
    const sections: string[] = [
      status === 'audit_error'
        ? 'Friday n’a pas pu terminer la vérification structurée. Le brouillon a été masqué.'
        : 'Friday n’a pas pu confirmer une réponse suffisamment fiable. Le brouillon a été masqué.',
      '_Les passages ci-dessous sont des extraits de sources, pas une réponse validée._',
    ];
    for (const assignment of assignments) {
      const auditedIds = auditAxes.get(assignment.axis.id)?.passageIds ?? [];
      const passageId = auditedIds[0] ?? assignment.passageIds[0];
      const passage = passageId ? passageById.get(passageId) : undefined;
      if (!passage) continue;
      const excerpt = stripPassageCitations(passage.text)
        .replace(/https?:\/\/\S+/giu, '')
        .replace(/[<>]/gu, '')
        .replace(/\s+/gu, ' ')
        .trim();
      if (!excerpt) continue;
      const doubt = auditAxes.get(assignment.axis.id)?.coverage ?? 'missing';
      sections.push(
        `### ${assignment.axis.label}`,
        `> « ${excerpt} » [${passage.id}]`,
        `*Doute de l’audit : élément demandé ${doubt === 'partial' ? 'partiellement couvert' : 'non confirmé'}.*`,
      );
    }
    if (sections.length === 2 && dossier.passages[0]) {
      const passage = dossier.passages[0];
      sections.push(
        '### Passage disponible',
        `> « ${stripPassageCitations(passage.text).replace(/[<>]/gu, '').slice(0, 420)} » [${passage.id}]`,
      );
    }
    const resolved = resolveAnswer(sections.join('\n\n'), dossier);
    return {
      ...resolved,
      status,
      route: 'web_verified',
      retrievalMode: dossier.retrievalMode,
      modelCalls,
      passageCount: dossier.passages.length,
      axisCount: plan.axes.length,
      requiredAxisCount: plan.axes.length,
      coveredAxisCount: audit ? requiredAxesCovered(plan.axes, audit) : 0,
      rejectedUnitCount:
        audit?.units.filter(
          ({ verdict }) =>
            verdict === 'unsupported' || verdict === 'contradicted',
        ).length ?? 0,
      fallbackCode,
    };
  }

  private noEvidenceFallback(
    plan: AnswerPlan,
    modelCalls: number,
    fallbackCode: string,
  ): ChatEngineResult {
    return {
      markdown:
        'Friday n’a trouvé aucune page originale exploitable et ne revient pas silencieusement à une réponse locale. Essayez de reformuler la demande ou de relancer la recherche plus tard.',
      status: 'abstained',
      route: 'web_verified',
      retrievalMode: 'lexical_fallback',
      sources: [],
      modelCalls,
      passageCount: 0,
      axisCount: plan.axes.length,
      requiredAxisCount: plan.axes.length,
      coveredAxisCount: 0,
      rejectedUnitCount: 0,
      fallbackCode,
    };
  }

  private async select(
    question: string,
    queries: string[],
    pages: FrozenPage[],
    signal: AbortSignal,
  ): Promise<EvidenceDossier> {
    const dossier = await selectEvidencePassagesHybrid({
      question,
      queries,
      pages,
      limits: {
        maxSources: 8,
        maxPassages: 12,
        maxCharacters: 24000,
        maxPassagesPerSource: Math.max(
          3,
          Math.ceil(12 / Math.max(1, pages.length)),
        ),
      },
      ...(this.options.retrieval === 'lexical'
        ? {}
        : {
            embeddings: {
              embed: (input, embedSignal) =>
                this.ollama.embed({
                  model: this.embeddingModel,
                  input,
                  ...(embedSignal ? { signal: embedSignal } : {}),
                }),
            },
          }),
      signal,
    });
    this.options.observe?.({ kind: 'evidence', dossier });
    return dossier;
  }

  private async write(
    input: ChatEngineInput,
    dossier: EvidenceDossier,
    generate: (
      request: Parameters<OllamaClient['generate']>[0],
    ) => Promise<string>,
    plan?: AnswerPlan,
    assignments?: AxisEvidence[],
    requestedResourceTypes?: string[],
  ): Promise<string> {
    input.updateStage('writing');
    return validateMarkdown(
      await generate({
        model: this.writerModel,
        prompt: writerPrompt({
          question: input.content,
          priorTurns: input.priorTurns,
          passages: dossier.passages,
          sources: dossier.sources,
          ...(requestedResourceTypes?.length ? { requestedResourceTypes } : {}),
          ...(plan ? { plan } : {}),
          ...(assignments
            ? {
                axisPassages: assignments.map(({ axis, passageIds }) => ({
                  axis,
                  passageIds,
                })),
              }
            : {}),
        }),
        seed: this.seed,
        maxTokens: 2_000,
        temperature: 0.2,
        signal: input.signal,
      }),
      dossier.passages,
    );
  }

  private async audit(
    input: ChatEngineInput,
    answer: string,
    dossier: EvidenceDossier,
    generate: (
      request: Parameters<OllamaClient['generate']>[0],
    ) => Promise<string>,
    axes: AnswerPlan['axes'] = [],
    assignments: AxisEvidence[] = [],
    maxAttempts = 2,
  ): Promise<{ units: AuditUnit[]; audit: AnswerAudit; auditError: boolean }> {
    input.updateStage('auditing');
    const units = splitAuditUnits(answer);
    const promptInput = {
      question: input.content,
      units,
      passages: dossier.passages,
      sources: dossier.sources,
      axes,
    };
    const prompt = auditorPrompt(promptInput);
    let failureCode = 'AUDIT_VALIDATION_FAILED';
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const raw = await generate({
          model: this.auditorModel,
          prompt:
            attempt === 0
              ? prompt
              : auditorRetryPrompt({ ...promptInput, failureCode }),
          seed: this.seed,
          format: axes.length
            ? UnitAuditJsonSchema
            : UnifiedUnitAuditJsonSchema,
          maxTokens: 4_096,
          temperature: 0,
          signal: input.signal,
        });
        const audit = deriveAnswerAudit(
          parseAudit(raw, units, dossier.passages, axes),
          axes,
          assignments,
        );
        this.options.observe?.({
          kind: 'audit',
          answer,
          units,
          audit,
          valid: true,
        });
        return { units, audit, auditError: false };
      } catch (error) {
        if (input.signal.aborted) throw error;
        failureCode = safeAuditFailureCode(error);
        /* one bounded retry */
      }
    }
    this.options.observe?.({ kind: 'audit', answer, units, valid: false });
    return {
      units,
      audit: {
        units: units.map(({ id }) => ({
          unitId: id,
          verdict: 'unsupported',
          passageIds: [],
        })),
        axes: axes.map(({ id }) => ({
          axisId: id,
          coverage: 'missing' as const,
          passageIds: [],
        })),
        usefulness: 'misses',
        missingAspects: ['Vérification indisponible'],
        evidenceSufficiency: 'insufficient',
      },
      auditError: true,
    };
  }

  private async discoverBundle(
    queries: string[],
    signal: AbortSignal,
    sourceOffset = 0,
    recent = false,
    budget: {
      remaining: number;
      remainingPages?: number;
      visited?: Set<string>;
    } = { remaining: 6 },
    enforceQuality = true,
  ): Promise<DiscoveryBundle> {
    const selectedQueries = queries.slice(
      0,
      Math.min(6, Math.max(0, budget.remaining)),
    );
    budget.remaining -= selectedQueries.length;
    const searchResults = await Promise.allSettled(
      selectedQueries.map((query) =>
        this.search.search(query, 'advanced', signal),
      ),
    );
    const discoveries = searchResults.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    );
    if (discoveries.length === 0) throw new Error('WEB_SEARCH_UNAVAILABLE');
    const listing = (value: string) =>
      /\/(?:tag|tags|category|categories|archive|search)(?:\/|$)/iu.test(
        new URL(value).pathname,
      );
    const rankedByQuery = discoveries.map(({ evidence }) =>
      [...evidence].sort(
        (left, right) =>
          Number(listing(left.url)) - Number(listing(right.url)) ||
          (recent
            ? Number(Boolean(right.publishedAt)) -
              Number(Boolean(left.publishedAt))
            : 0) ||
          (right.publishedAt ?? '').localeCompare(left.publishedAt ?? ''),
      ),
    );
    const unique = new Map<
      string,
      { title: string; url: string; publishedAt: string | null }
    >();
    for (const item of rankedByQuery.flat())
      if (!unique.has(item.url)) unique.set(item.url, item);
    const entries: Array<{
      title: string;
      url: string;
      publishedAt: string | null;
    }> = [];
    const scheduled = new Set<string>();
    const maxRank = Math.max(0, ...rankedByQuery.map((items) => items.length));
    for (let rank = 0; rank < maxRank && entries.length < 16; rank += 1) {
      for (const items of rankedByQuery) {
        const item = items[rank];
        if (!item || scheduled.has(item.url)) continue;
        scheduled.add(item.url);
        entries.push(item);
        if (entries.length === 16) break;
      }
    }
    const pageLimit =
      budget.remainingPages === undefined
        ? 16
        : Math.max(0, budget.remainingPages - (budget.remaining > 0 ? 4 : 0));
    const reading = entries
      .filter((e) => !budget.visited?.has(e.url))
      .slice(0, pageLimit);
    if (budget.remainingPages !== undefined)
      budget.remainingPages -= reading.length;
    reading.forEach((e) => budget.visited?.add(e.url));
    const retrievedAt = new Date().toISOString();
    const settled = await Promise.allSettled(
      reading.map(async (item, index): Promise<FrozenPage> => {
        const document = await this.pageReader.fetchArticleDocument(
          item.url,
          signal,
        );
        const paragraphs = enforceQuality
          ? extractReadableParagraphs(document.text, queries)
          : document.text
              .split(/\n{2,}/u)
              .map((value) => value.trim())
              .filter((value) => value.length >= 35)
              .slice(0, 500);
        if (!paragraphs.length) throw new Error('EMPTY_OR_IRRELEVANT_PAGE');
        return {
          source: {
            id: `S${(sourceOffset + index + 1).toString()}`,
            title: item.title,
            url: item.url,
            ...((item.publishedAt ?? document.publishedAt)
              ? { publishedAt: item.publishedAt ?? document.publishedAt! }
              : {}),
            retrievedAt: document.retrievedAt ?? retrievedAt,
          },
          sections: document.sections ?? [{ paragraphs }],
        };
      }),
    );
    const pages = settled.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    );
    const leads = settled.flatMap((result, index) => {
      if (result.status === 'fulfilled') return [];
      const item = reading[index]!;
      return [
        {
          title: item.title,
          url: item.url,
          publishedAt: item.publishedAt,
          retrievedAt,
        },
      ];
    });
    return {
      pages: enforceQuality ? pages : pages.slice(0, 8),
      leads: leads.slice(0, 4),
      discoveredCount: unique.size,
      rejectedPageCount: settled.length - pages.length,
    };
  }

  private async discoverPages(
    queries: string[],
    signal: AbortSignal,
    sourceOffset = 0,
    recent = false,
    budget: {
      remaining: number;
      remainingPages?: number;
      visited?: Set<string>;
    } = { remaining: 6 },
  ): Promise<FrozenPage[]> {
    return (
      await this.discoverBundle(
        queries,
        signal,
        sourceOffset,
        recent,
        budget,
        false,
      )
    ).pages;
  }
}

export {
  dedupeResolvedSourceCitations,
  highRiskNotice,
  normalizeGeneratedMarkdown,
} from './runtime/publication.js';
export {
  explicitResourceSearchQueries,
  explicitResourceTypes,
  extractReadableParagraphs,
  routeForcedByMode,
} from './runtime/retrieval-policy.js';
export type {
  RuntimeObservation,
  RuntimePageReader,
  RuntimeSearch,
  VerifiedChatEngineOptions,
} from './runtime/runtime-types.js';
