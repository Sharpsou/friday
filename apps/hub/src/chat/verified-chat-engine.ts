import {
  AnswerAuditJsonSchema,
  AnswerAuditSchema,
  AnswerPlanJsonSchema,
  OllamaClient,
  PROMPT_VERSIONS,
  RoutePlanJsonSchema,
  RoutePlanOutputSchema,
  answerPlanPrompt,
  assignEvidenceToAxes,
  auditorPrompt,
  auditorRetryPrompt,
  citedPassageIds,
  compileAuditedAnswer,
  decideEvaluation,
  fallbackAnswerPlan,
  localPrompt,
  mergeRedundantAxes,
  parseAnswerPlan,
  requiredAxesCovered,
  resolvePassageSources,
  revisionPrompt,
  routeAnswerPlanPrompt,
  routeDeterministically,
  routeQuestion,
  searchQueriesForPlan,
  selectEvidencePassagesHybrid,
  splitAuditSegments,
  splitAuditUnits,
  stripPassageCitations,
  suppressUnsupportedUnits,
  validateAuditReferences,
  writerPrompt,
  type AnswerAudit,
  type AnswerPlan,
  type AxisEvidence,
  type AuditUnit,
  type EvidenceDossier,
  type EvidencePassage,
  type FrozenPage,
  type RouteDecision,
} from '@friday/assistant-core';
import type { ChatMode, ChatSource } from '@friday/contracts';

import { SecureFeedClient } from '../watch/feed-client.js';
import { TavilySearchClient } from '../watch/tavily-search.js';
import type {
  ChatEngine,
  ChatEngineInput,
  ChatEngineResult,
} from './chat-service.js';

export interface VerifiedChatEngineOptions {
  ollama?: OllamaClient;
  search?: TavilySearchClient;
  pageReader?: SecureFeedClient;
  writerModel?: string;
  auditorModel?: string;
  embeddingModel?: string;
  seed?: number;
  axesEnabled?: boolean;
}

export function normalizeGeneratedMarkdown(markdown: string): string {
  return markdown
    .replace(/\[([^\]]+)\]\(https?:\/\/[^\s)]+\)/giu, '$1')
    .replace(/https?:\/\/[^\s<>()\]]+/giu, '')
    .replace(/\((P[1-9]\d*(?:\s*,\s*P[1-9]\d*)+)\)/gu, (_all, ids: string) =>
      ids
        .split(/\s*,\s*/u)
        .map((id) => `[${id}]`)
        .join(' '),
    )
    .replace(/\[(P[1-9]\d*(?:\s*[,;]\s*P[1-9]\d*)+)\]/gu, (_all, ids: string) =>
      ids
        .split(/\s*[,;]\s*/u)
        .map((id) => `[${id}]`)
        .join(' '),
    )
    .trim();
}

export function routeForcedByMode(
  mode: ChatMode,
  question: string,
): RouteDecision | null {
  if (mode === 'friday') return null;
  if (mode === 'local')
    return {
      route: 'local',
      reason: 'writing_or_conversation',
      queries: [],
      decidedBy: 'code',
      verificationLabel: 'non vérifié par des sources',
    };
  return {
    route: 'web',
    reason: 'explicit_web',
    queries: [question],
    decidedBy: 'code',
    verificationLabel: 'sources requises',
  };
}

function validateMarkdown(
  markdown: string,
  passages: EvidencePassage[],
): string {
  const answer = normalizeGeneratedMarkdown(markdown);
  if (!answer || answer.length > 100_000)
    throw new Error('MODEL_ANSWER_SIZE_INVALID');
  if (/https?:\/\//iu.test(answer))
    throw new Error('MODEL_OUTPUT_URL_FORBIDDEN');
  if (/<\/?[a-z][^>]*>/iu.test(answer))
    throw new Error('MODEL_OUTPUT_HTML_FORBIDDEN');
  const known = new Set(passages.map(({ id }) => id));
  if (
    [...answer.matchAll(/\[(P[1-9]\d*)\]/gu)].some(
      (match) => !known.has(match[1] as EvidencePassage['id']),
    )
  )
    throw new Error('MODEL_OUTPUT_UNKNOWN_PASSAGE');
  if (/[[(]\s*P[1-9]\d*/iu.test(answer.replace(/\[(P[1-9]\d*)\]/gu, '')))
    throw new Error('MODEL_OUTPUT_MALFORMED_PASSAGE');
  return answer;
}

function parseAudit(
  raw: string,
  units: AuditUnit[],
  passages: EvidencePassage[],
  axes = [] as AnswerPlan['axes'],
): AnswerAudit {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('AUDIT_INVALID_JSON');
  }
  return validateAuditReferences(
    AnswerAuditSchema.parse(value),
    units,
    passages,
    axes,
  );
}

function safeAuditFailureCode(error: unknown): string {
  if (error instanceof Error && /^AUDIT_[A-Z_]+$/u.test(error.message))
    return error.message;
  if (error instanceof Error && error.name === 'ZodError')
    return 'AUDIT_SCHEMA_INVALID';
  return 'AUDIT_VALIDATION_FAILED';
}

function resolveAnswer(
  answer: string,
  dossier: EvidenceDossier,
): { markdown: string; sources: ChatSource[] } {
  const cited = citedPassageIds(answer);
  const passageMap = new Map(
    dossier.passages.map((passage) => [passage.id, passage]),
  );
  const sources = resolvePassageSources(cited, dossier);
  const exposed = new Map(
    sources.map((source, index) => [source.id, `S${(index + 1).toString()}`]),
  );
  const markdown = answer.replace(
    /\[(P[1-9]\d*)\]/gu,
    (_all, passageId: string) => {
      const passage = passageMap.get(passageId as EvidencePassage['id']);
      if (!passage) throw new Error('UNKNOWN_PASSAGE_REFERENCE');
      return `[${exposed.get(passage.sourceId)!}]`;
    },
  );
  if (/[[(]\s*P[1-9]\d*/iu.test(markdown))
    throw new Error('UNRESOLVED_PASSAGE_REFERENCE');
  return {
    markdown,
    sources: sources.map((source) => ({
      id: exposed.get(source.id)!,
      title: source.title,
      url: source.url,
      domain: new URL(source.url).hostname,
      publishedAt: source.publishedAt ?? null,
      retrievedAt: source.retrievedAt,
    })),
  };
}

export class VerifiedChatEngine implements ChatEngine {
  private readonly ollama: OllamaClient;
  private readonly search: TavilySearchClient;
  private readonly pageReader: SecureFeedClient;
  private readonly writerModel: string;
  private readonly auditorModel: string;
  private readonly embeddingModel: string;
  private readonly seed: number;
  private readonly axesEnabled: boolean;

  constructor(options: VerifiedChatEngineOptions = {}) {
    this.ollama =
      options.ollama ??
      new OllamaClient({ timeoutMs: 240_000, maxQueueSize: 4 });
    this.search =
      options.search ??
      new TavilySearchClient(process.env.FRIDAY_TAVILY_API_KEY);
    this.pageReader = options.pageReader ?? new SecureFeedClient();
    this.writerModel = options.writerModel ?? 'gemma4:e4b-it-qat';
    this.auditorModel = options.auditorModel ?? 'qwen3.5:9b-q4_K_M';
    this.embeddingModel = options.embeddingModel ?? 'qwen3-embedding:0.6b';
    this.seed = options.seed ?? 17;
    this.axesEnabled =
      options.axesEnabled ?? process.env.FRIDAY_CHAT_AXES_ENABLED === 'true';
  }

  webUsage(signal: AbortSignal) {
    return this.search.usage(signal);
  }

  async answer(input: ChatEngineInput): Promise<ChatEngineResult> {
    if (this.axesEnabled) return this.answerWithAxes(input);
    return this.answerLegacy(input);
  }

  private async answerLegacy(
    input: ChatEngineInput,
  ): Promise<ChatEngineResult> {
    let calls = 0;
    const generate = async (
      request: Parameters<OllamaClient['generate']>[0],
    ): Promise<string> => {
      calls += 1;
      if (calls > 6) throw new Error('MODEL_CALL_LIMIT_REACHED');
      return (await this.ollama.generate(request)).response;
    };
    input.updateStage('routing');
    const deterministic =
      routeForcedByMode(input.mode, input.content) ??
      (await routeQuestion(input.content, {
        ollama: this.ollama,
        model: this.auditorModel,
        seed: this.seed,
        signal: input.signal,
      }));
    if (deterministic.decidedBy === 'classifier') calls += 1;
    if (deterministic.route === 'local') {
      input.updateStage('writing');
      const markdown = validateMarkdown(
        await generate({
          model: this.writerModel,
          prompt: localPrompt({
            question: input.content,
            priorTurns: input.priorTurns,
          }),
          seed: this.seed,
          maxTokens: 1_500,
          temperature: 0.2,
          signal: input.signal,
        }),
        [],
      );
      return {
        markdown,
        status: 'unverified',
        route: 'local_unverified',
        retrievalMode: 'none',
        sources: [],
        modelCalls: calls,
        passageCount: 0,
      };
    }

    input.updateStage('research');
    let pages = await this.discoverPages(deterministic.queries, input.signal);
    if (pages.length === 0) throw new Error('WEB_EVIDENCE_UNAVAILABLE');
    let dossier = await this.select(
      input.content,
      deterministic.queries.slice(1),
      pages,
      input.signal,
    );
    let answer = await this.write(input, dossier, generate);
    let audited = await this.audit(input, answer, dossier, generate);
    if (audited.auditError) {
      return {
        markdown:
          'Je ne peux pas publier cette réponse car sa vérification a échoué.',
        status: 'audit_error',
        route: 'web_verified',
        retrievalMode: dossier.retrievalMode,
        sources: [],
        modelCalls: calls,
        passageCount: dossier.passages.length,
      };
    }
    let decision = decideEvaluation(audited.audit, {
      revisionUsed: false,
      researchUsed: false,
      finalAudit: false,
    });
    if (decision === 'research') {
      const query = [input.content, ...audited.audit.missingAspects]
        .join(' ')
        .slice(0, 500);
      const extra = await this.discoverPages(
        [query],
        input.signal,
        pages.length,
      );
      pages = [...pages, ...extra].slice(0, 16);
      dossier = await this.select(
        input.content,
        audited.audit.missingAspects.slice(0, 2),
        pages,
        input.signal,
      );
      answer = await this.write(input, dossier, generate);
      audited = await this.audit(input, answer, dossier, generate);
      decision = audited.auditError
        ? 'partial'
        : decideEvaluation(audited.audit, {
            revisionUsed: false,
            researchUsed: true,
            finalAudit: true,
          });
    } else if (decision === 'revise') {
      input.updateStage('writing');
      answer = validateMarkdown(
        await generate({
          model: this.writerModel,
          prompt: revisionPrompt({
            question: input.content,
            answer,
            audit: audited.audit,
            passages: dossier.passages,
          }),
          seed: this.seed,
          maxTokens: 1_500,
          temperature: 0.2,
          signal: input.signal,
        }),
        dossier.passages,
      );
      audited = await this.audit(input, answer, dossier, generate);
      decision = audited.auditError
        ? 'partial'
        : decideEvaluation(audited.audit, {
            revisionUsed: true,
            researchUsed: false,
            finalAudit: true,
          });
    }
    if (audited.auditError) {
      return {
        markdown:
          'Je ne peux pas publier cette réponse car sa vérification a échoué.',
        status: 'audit_error',
        route: 'web_verified',
        retrievalMode: dossier.retrievalMode,
        sources: [],
        modelCalls: calls,
        passageCount: dossier.passages.length,
      };
    }
    if (decision === 'partial')
      answer = suppressUnsupportedUnits(audited.units, audited.audit);
    input.updateStage('finalizing');
    const resolved = resolveAnswer(answer, dossier);
    const abstained = /^Je ne peux pas fournir/u.test(answer.trim());
    return {
      ...resolved,
      status: abstained
        ? 'abstained'
        : decision === 'partial'
          ? 'partial'
          : 'verified',
      route: 'web_verified',
      retrievalMode: dossier.retrievalMode,
      modelCalls: calls,
      passageCount: dossier.passages.length,
    };
  }

  private async answerWithAxes(
    input: ChatEngineInput,
  ): Promise<ChatEngineResult> {
    let calls = 0;
    const generate = async (
      request: Parameters<OllamaClient['generate']>[0],
    ): Promise<string> => {
      calls += 1;
      if (calls > 6) throw new Error('MODEL_CALL_LIMIT_REACHED');
      return (await this.ollama.generate(request)).response;
    };
    input.updateStage('routing');
    const routed = await this.routeAndPlan(input, generate);
    if (routed.route === 'local') {
      input.updateStage('writing');
      const markdown = validateMarkdown(
        await generate({
          model: this.writerModel,
          prompt: localPrompt({
            question: input.content,
            priorTurns: input.priorTurns,
          }),
          seed: this.seed,
          maxTokens: 1_500,
          temperature: 0.2,
          signal: input.signal,
        }),
        [],
      );
      return {
        markdown,
        status: 'unverified',
        route: 'local_unverified',
        retrievalMode: 'none',
        sources: [],
        modelCalls: calls,
        passageCount: 0,
        axisCount: 0,
        requiredAxisCount: 0,
        coveredAxisCount: 0,
        rejectedUnitCount: 0,
        fallbackCode: null,
      };
    }

    let plan = routed.plan ?? fallbackAnswerPlan(input.content);
    input.updateStage('research');
    let pages: FrozenPage[];
    try {
      pages = await this.discoverPages(
        searchQueriesForPlan(input.content, plan),
        input.signal,
        0,
        plan.intent === 'recent',
      );
    } catch (error) {
      if (input.signal.aborted) throw error;
      return this.noEvidenceFallback(plan, calls, 'WEB_SEARCH_UNAVAILABLE');
    }
    if (pages.length === 0)
      return this.noEvidenceFallback(plan, calls, 'WEB_EVIDENCE_UNAVAILABLE');
    let dossier = await this.select(
      input.content,
      plan.axes.map(({ question }) => question),
      pages,
      input.signal,
    );
    let assignments = mergeRedundantAxes(assignEvidenceToAxes(plan, dossier));
    plan = { ...plan, axes: assignments.map(({ axis }) => axis) };
    let researchUsed = false;
    const uncoveredBeforeWriting = assignments.filter(
      ({ axis, passageIds }) =>
        axis.importance === 'required' && passageIds.length === 0,
    );
    if (uncoveredBeforeWriting.length) {
      researchUsed = true;
      const extra = await this.discoverPages(
        uncoveredBeforeWriting.map(({ axis }) => axis.query).slice(0, 2),
        input.signal,
        pages.length,
        plan.intent === 'recent',
      ).catch((error: unknown) => {
        if (input.signal.aborted) throw error;
        return [];
      });
      pages = [...pages, ...extra].slice(0, 16);
      dossier = await this.select(
        input.content,
        plan.axes.map(({ question }) => question),
        pages,
        input.signal,
      );
      assignments = mergeRedundantAxes(assignEvidenceToAxes(plan, dossier));
      plan = { ...plan, axes: assignments.map(({ axis }) => axis) };
    }

    let answer = await this.write(input, dossier, generate, plan, assignments);
    let audited = await this.audit(input, answer, dossier, generate, plan.axes);
    if (audited.auditError)
      return this.evidenceFallback(
        plan,
        assignments,
        dossier,
        calls,
        'audit_error',
        'AUDIT_INVALID_AFTER_RETRY',
      );
    let decision = decideEvaluation(audited.audit, {
      revisionUsed: false,
      researchUsed,
      finalAudit: false,
      requiredAxisIds: plan.axes
        .filter(({ importance }) => importance === 'required')
        .map(({ id }) => id),
    });
    if (decision === 'research' && !researchUsed) {
      const missingAxisIds = new Set(
        audited.audit.axes
          .filter(({ coverage }) => coverage !== 'covered')
          .map(({ axisId }) => axisId),
      );
      const missingAssignments = assignments.filter(({ axis }) =>
        missingAxisIds.has(axis.id),
      );
      const extra = await this.discoverPages(
        (missingAssignments.length
          ? missingAssignments.map(({ axis }) => axis.query)
          : audited.audit.missingAspects
        ).slice(0, 2),
        input.signal,
        pages.length,
        plan.intent === 'recent',
      ).catch((error: unknown) => {
        if (input.signal.aborted) throw error;
        return [];
      });
      pages = [...pages, ...extra].slice(0, 16);
      dossier = await this.select(
        input.content,
        plan.axes.map(({ question }) => question),
        pages,
        input.signal,
      );
      assignments = mergeRedundantAxes(assignEvidenceToAxes(plan, dossier));
      answer = await this.write(input, dossier, generate, plan, assignments);
      audited = await this.audit(
        input,
        answer,
        dossier,
        generate,
        plan.axes,
        calls < 5 ? 2 : 1,
      );
      decision = audited.auditError
        ? 'partial'
        : decideEvaluation(audited.audit, {
            revisionUsed: false,
            researchUsed: true,
            finalAudit: true,
            requiredAxisIds: plan.axes
              .filter(({ importance }) => importance === 'required')
              .map(({ id }) => id),
          });
    } else if (decision === 'revise') {
      input.updateStage('writing');
      answer = validateMarkdown(
        await generate({
          model: this.writerModel,
          prompt: revisionPrompt({
            question: input.content,
            answer,
            audit: audited.audit,
            passages: dossier.passages,
            axes: plan.axes,
          }),
          seed: this.seed,
          maxTokens: 1_500,
          temperature: 0.2,
          signal: input.signal,
        }),
        dossier.passages,
      );
      audited = await this.audit(
        input,
        answer,
        dossier,
        generate,
        plan.axes,
        calls < 5 ? 2 : 1,
      );
      decision = audited.auditError
        ? 'partial'
        : decideEvaluation(audited.audit, {
            revisionUsed: true,
            researchUsed,
            finalAudit: true,
            requiredAxisIds: plan.axes
              .filter(({ importance }) => importance === 'required')
              .map(({ id }) => id),
          });
    }
    if (audited.auditError)
      return this.evidenceFallback(
        plan,
        assignments,
        dossier,
        calls,
        'audit_error',
        'FINAL_AUDIT_INVALID',
      );

    const segments = splitAuditSegments(answer);
    const compiled = compileAuditedAnswer(
      segments,
      audited.audit,
      decision === 'partial',
    );
    const requiredAxisCount = plan.axes.filter(
      ({ importance }) => importance === 'required',
    ).length;
    const coveredAxisCount = requiredAxesCovered(plan.axes, audited.audit);
    if (compiled.retainedUnitCount === 0 || compiled.passageIds.length === 0)
      return this.evidenceFallback(
        plan,
        assignments,
        dossier,
        calls,
        'abstained',
        'AUDIT_REJECTED_ALL',
        audited.audit,
      );
    input.updateStage('finalizing');
    const resolved = resolveAnswer(compiled.markdown, dossier);
    const verified =
      decision === 'pass' &&
      coveredAxisCount === requiredAxisCount &&
      compiled.rejectedUnitCount === 0;
    return {
      ...resolved,
      status: verified ? 'verified' : 'partial',
      route: 'web_verified',
      retrievalMode: dossier.retrievalMode,
      modelCalls: calls,
      passageCount: dossier.passages.length,
      axisCount: plan.axes.length,
      requiredAxisCount,
      coveredAxisCount,
      rejectedUnitCount: compiled.rejectedUnitCount,
      fallbackCode: verified ? null : 'PARTIAL_AUDIT',
    };
  }

  private async routeAndPlan(
    input: ChatEngineInput,
    generate: (
      request: Parameters<OllamaClient['generate']>[0],
    ) => Promise<string>,
  ): Promise<{ route: 'local' | 'web'; plan: AnswerPlan | null }> {
    const forced = routeForcedByMode(input.mode, input.content);
    const deterministic = forced ?? routeDeterministically(input.content);
    if (deterministic?.route === 'local') return { route: 'local', plan: null };
    if (deterministic?.route === 'web') {
      const raw = await generate({
        model: this.auditorModel,
        prompt: answerPlanPrompt(input.content),
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
        .trim()
        .slice(0, 420);
      if (!excerpt) continue;
      const doubt = auditAxes.get(assignment.axis.id)?.coverage ?? 'missing';
      sections.push(
        `### ${assignment.axis.label}`,
        `> « ${excerpt} » [${passage.id}]`,
        `*Doute de l’audit : axe ${doubt === 'partial' ? 'partiellement couvert' : 'non confirmé'}.*`,
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
      requiredAxisCount: plan.axes.filter(
        ({ importance }) => importance === 'required',
      ).length,
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
      requiredAxisCount: plan.axes.filter(
        ({ importance }) => importance === 'required',
      ).length,
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
    return selectEvidencePassagesHybrid({
      question,
      queries,
      pages,
      embeddings: {
        embed: (input, embedSignal) =>
          this.ollama.embed({
            model: this.embeddingModel,
            input,
            ...(embedSignal ? { signal: embedSignal } : {}),
          }),
      },
      signal,
    });
  }

  private async write(
    input: ChatEngineInput,
    dossier: EvidenceDossier,
    generate: (
      request: Parameters<OllamaClient['generate']>[0],
    ) => Promise<string>,
    plan?: AnswerPlan,
    assignments?: AxisEvidence[],
  ): Promise<string> {
    input.updateStage('writing');
    return validateMarkdown(
      await generate({
        model: this.writerModel,
        prompt: writerPrompt({
          question: input.content,
          priorTurns: input.priorTurns,
          passages: dossier.passages,
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
        maxTokens: 1_500,
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
    maxAttempts = 2,
  ): Promise<{ units: AuditUnit[]; audit: AnswerAudit; auditError: boolean }> {
    input.updateStage('auditing');
    const units = splitAuditUnits(answer);
    const promptInput = {
      question: input.content,
      units,
      passages: dossier.passages,
      axes,
    };
    const prompt = auditorPrompt(promptInput);
    let failureCode = 'AUDIT_VALIDATION_FAILED';
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const raw = await generate({
        model: this.auditorModel,
        prompt:
          attempt === 0
            ? prompt
            : auditorRetryPrompt({ ...promptInput, failureCode }),
        seed: this.seed,
        format: AnswerAuditJsonSchema,
        maxTokens: 2_500,
        temperature: 0,
        signal: input.signal,
      });
      try {
        return {
          units,
          audit: parseAudit(raw, units, dossier.passages, axes),
          auditError: false,
        };
      } catch (error) {
        failureCode = safeAuditFailureCode(error);
        /* one bounded retry */
      }
    }
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

  private async discoverPages(
    queries: string[],
    signal: AbortSignal,
    sourceOffset = 0,
    recent = false,
  ): Promise<FrozenPage[]> {
    const discoveries = await Promise.all(
      queries
        .slice(0, 3)
        .map((query) => this.search.search(query, 'advanced', signal)),
    );
    const unique = new Map<
      string,
      { title: string; url: string; publishedAt: string | null }
    >();
    for (const item of discoveries.flatMap(({ evidence }) => evidence))
      if (!unique.has(item.url)) unique.set(item.url, item);
    const entries = [...unique.values()]
      .sort((left, right) => {
        const listing = (value: string) =>
          /\/(?:tag|tags|category|categories|archive|search)(?:\/|$)/iu.test(
            new URL(value).pathname,
          );
        return (
          Number(listing(left.url)) - Number(listing(right.url)) ||
          (recent
            ? Number(Boolean(right.publishedAt)) -
              Number(Boolean(left.publishedAt))
            : 0) ||
          (right.publishedAt ?? '').localeCompare(left.publishedAt ?? '')
        );
      })
      .slice(0, 8);
    const settled = await Promise.allSettled(
      entries.map(async (item, index): Promise<FrozenPage> => {
        const document = await this.pageReader.fetchArticleDocument(
          item.url,
          signal,
        );
        const text = document.text;
        const paragraphs = text
          .split(/\n{2,}/u)
          .map((value) => value.trim())
          .filter((value) => value.length >= 35)
          .slice(0, 500);
        if (!paragraphs.length) throw new Error('EMPTY_PAGE');
        return {
          source: {
            id: `S${(sourceOffset + index + 1).toString()}`,
            title: item.title,
            url: item.url,
            ...((document.publishedAt ?? item.publishedAt)
              ? { publishedAt: document.publishedAt ?? item.publishedAt! }
              : {}),
            retrievedAt: new Date().toISOString(),
          },
          sections: [{ paragraphs }],
        };
      }),
    );
    return settled.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    );
  }
}

export const CHAT_RUNTIME_VERSIONS = {
  prompts: PROMPT_VERSIONS,
  writerModel: 'gemma4:e4b-it-qat',
  auditorModel: 'qwen3.5:9b-q4_K_M',
  embeddingModel: 'qwen3-embedding:0.6b',
} as const;
