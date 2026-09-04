import {
  AnswerPlanJsonSchema,
  ContextResolutionJsonSchema,
  OllamaClient,
  PROMPT_VERSIONS,
  RoutePlanJsonSchema,
  RoutePlanOutputSchema,
  UnitAuditJsonSchema,
  UnifiedUnitAuditJsonSchema,
  UnitAuditOutputSchema,
  answerPlanPrompt,
  assignEvidenceToAxes,
  auditorPrompt,
  auditorRetryPrompt,
  boundedConversationTurns,
  citedPassageIds,
  compileAuditedAnswer,
  contextualQuestionPrompt,
  decideEvaluation,
  deriveAnswerAudit,
  fallbackAnswerPlan,
  fallbackContextualQuestion,
  localPrompt,
  mergeRedundantAxes,
  needsConversationResolution,
  parseContextResolution,
  parseAnswerPlan,
  requiredAxesCovered,
  resolvePassageSources,
  revisionPrompt,
  routeAnswerPlanPrompt,
  routeDeterministically,
  routeQuestion,
  searchQueriesForPlan,
  searchTopicPlanPrompt,
  selectEvidencePassagesHybrid,
  splitAuditSegments,
  splitAuditUnits,
  stripPassageCitations,
  suppressUnsupportedUnits,
  validateUnitAuditReferences,
  writerPrompt,
  type AnswerAudit,
  type AnswerPlan,
  type AxisEvidence,
  type AuditUnit,
  type EvidenceDossier,
  type EvidencePassage,
  type FrozenPage,
  type RouteDecision,
  type UnitAuditOutput,
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
  pipeline?: 'unified' | 'axes';
}

interface DiscoveryLead {
  title: string;
  url: string;
  publishedAt: string | null;
  retrievedAt: string;
}

interface DiscoveryBundle {
  pages: FrozenPage[];
  leads: DiscoveryLead[];
  discoveredCount: number;
  rejectedPageCount: number;
}

const BOILERPLATE_PARAGRAPH =
  /(?:droits? d['’]auteur|confidentialité|conditions d['’]utilisation|nous contacter|créateurs|publicité|cookies?|copyright|all rights reserved|sign in|se connecter|menu principal|navigation)/iu;
const QUERY_STOP_WORDS = new Set([
  'avec',
  'dans',
  'pour',
  'quels',
  'quelle',
  'quelles',
  'comment',
  'autour',
  'court',
  'courte',
  'courtes',
  'exemple',
  'exemples',
  'trouve',
  'trouves',
]);

function relevanceTokens(value: string): Set<string> {
  return new Set(
    value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/gu, '')
      .toLocaleLowerCase('fr-FR')
      .match(/[a-z0-9]{4,}/gu)
      ?.filter((token) => !QUERY_STOP_WORDS.has(token)) ?? [],
  );
}

export function extractReadableParagraphs(
  text: string,
  queries: string[],
): string[] {
  const seen = new Set<string>();
  const paragraphs = text
    .replace(/[\u200B-\u200F\u2060-\u206F]/gu, '')
    .split(/\n{2,}/u)
    .map((value) => value.replace(/\s+/gu, ' ').trim())
    .filter((value) => value.length >= 35)
    .filter((value) => !BOILERPLATE_PARAGRAPH.test(value))
    .filter((value) => {
      const key = value.toLocaleLowerCase('fr-FR');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 500);
  const body = paragraphs.join(' ');
  if (body.length < 240) return [];
  const expected = relevanceTokens(queries.join(' '));
  if (expected.size === 0) return paragraphs;
  const actual = relevanceTokens(body);
  return [...expected].some((token) => actual.has(token)) ? paragraphs : [];
}

export function explicitResourceTypes(question: string): string[] {
  const resourcePatterns: Array<[RegExp, string]> = [
    [/\bpodcasts?\b/iu, 'podcast'],
    [/\b(?:formations?|cours|bootcamps?)\b/iu, 'formation'],
    [/\b(?:livres?|ouvrages?)\b/iu, 'livre'],
    [/\b(?:vidéos?|cha[iî]nes? youtube)\b/iu, 'vidéo'],
    [/\b(?:produits?|modèles?)\b/iu, 'produit'],
    [/\bservices?\b/iu, 'service'],
    [/\b(?:outils?|logiciels?)\b/iu, 'outil'],
    [/\brestaurants?\b/iu, 'restaurant'],
    [/\b(?:hôtels?|hébergements?)\b/iu, 'hébergement'],
  ];
  return resourcePatterns
    .filter(([pattern]) => pattern.test(question))
    .map(([, label]) => label)
    .slice(0, 4);
}

export function explicitResourceSearchQueries(question: string): string[] {
  return explicitResourceTypes(question).map((label) =>
    `${label} ${question}`.slice(0, 300),
  );
}

function availableRequestedResourceTypes(
  requested: string[],
  dossier: EvidenceDossier,
): string[] {
  const sourceTitles = new Map(
    dossier.sources.map(({ id, title }) => [
      id,
      title.toLocaleLowerCase('fr-FR'),
    ]),
  );
  return requested.filter((resource) => {
    const token = resource.toLocaleLowerCase('fr-FR');
    return dossier.passages.some(
      ({ sourceId, heading, text }) =>
        sourceTitles.get(sourceId)?.includes(token) ||
        heading?.toLocaleLowerCase('fr-FR').includes(token) ||
        text.toLocaleLowerCase('fr-FR').includes(token),
    );
  });
}

function missingRequestedResourceTypes(
  answer: string,
  available: string[],
): string[] {
  const normalized = answer.toLocaleLowerCase('fr-FR');
  return available.filter((resource) => !normalized.includes(resource));
}

export function normalizeGeneratedMarkdown(markdown: string): string {
  return markdown
    .replace(
      /^(?:#{1,6}\s*|\*\*)?(?:axes?\s+)?(?:requis(?:e|es)?|utiles?|required|useful)(?:\*\*)?\s*$/gimu,
      '',
    )
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

export function dedupeResolvedSourceCitations(markdown: string): string {
  return markdown.replace(/(\[S[1-9]\d*\])(?:\s+\1)+/gu, '$1');
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
  axes: AnswerPlan['axes'] = [],
): UnitAuditOutput {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('AUDIT_INVALID_JSON');
  }
  return validateUnitAuditReferences(
    UnitAuditOutputSchema.parse(value),
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
  const markdown = dedupeResolvedSourceCitations(
    answer.replace(/\[(P[1-9]\d*)\]/gu, (_all, passageId: string) => {
      const passage = passageMap.get(passageId as EvidencePassage['id']);
      if (!passage) throw new Error('UNKNOWN_PASSAGE_REFERENCE');
      return `[${exposed.get(passage.sourceId)!}]`;
    }),
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
      evidenceLevel: 'readable',
    })),
  };
}

function appendDiscoveryLeads(
  result: { markdown: string; sources: ChatSource[] },
  leads: DiscoveryLead[],
): { markdown: string; sources: ChatSource[] } {
  const knownUrls = new Set(result.sources.map(({ url }) => url));
  const selected = leads
    .filter(({ url }) => !knownUrls.has(url))
    .slice(0, Math.max(0, 12 - result.sources.length));
  return {
    ...result,
    sources: [
      ...result.sources,
      ...selected.map((lead, index) => ({
        id: `S${(result.sources.length + index + 1).toString()}`,
        title: lead.title,
        url: lead.url,
        domain: new URL(lead.url).hostname,
        publishedAt: lead.publishedAt,
        retrievedAt: lead.retrievedAt,
        evidenceLevel: 'discovery_only' as const,
      })),
    ],
  };
}

export function highRiskNotice(question: string): string {
  return /\b(?:avc|santé|maladie|urgence|secours|médical|médecin|sympt[oô]me|traitement|médicament|juridique|avocat|droit|finance|financier|investir|placement|crédit|impôt)\b/iu.test(
    question,
  )
    ? '\n\n_Information générale : pour une décision médicale, juridique ou financière importante, vérifiez ces éléments auprès d’un professionnel qualifié._'
    : '';
}

function extractiveAnswer(
  dossier: EvidenceDossier,
  leads: DiscoveryLead[],
  question: string,
): { markdown: string; sources: ChatSource[] } {
  const passages = dossier.passages.slice(0, 4);
  const sourceById = new Map(
    dossier.sources.map((source) => [source.id, source]),
  );
  const markdown = [
    'Les sources consultées donnent les éléments suivants :',
    ...passages.map((passage) => {
      const title =
        sourceById.get(passage.sourceId)?.title ?? 'Source consultée';
      const excerpt = stripPassageCitations(passage.text)
        .replace(/[<>]/gu, '')
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, 420);
      return `- **${title.replace(/[[\]<>]/gu, '')}** — ${excerpt} [${passage.id}]`;
    }),
    '_Réponse partielle : la rédaction ou la vérification automatique n’a pas permis une synthèse plus précise._',
  ].join('\n\n');
  return appendDiscoveryLeads(
    resolveAnswer(`${markdown}${highRiskNotice(question)}`, dossier),
    leads,
  );
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
  private readonly pipeline: 'unified' | 'axes';

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
    this.pipeline =
      options.pipeline ??
      (process.env.FRIDAY_CHAT_PIPELINE === 'unified' ? 'unified' : 'axes');
  }

  webUsage(signal: AbortSignal) {
    return this.search.usage(signal);
  }

  async answer(input: ChatEngineInput): Promise<ChatEngineResult> {
    if (this.pipeline === 'unified') return this.answerUnified(input);
    if (this.axesEnabled) return this.answerWithAxes(input);
    return this.answerLegacy(input);
  }

  private async answerLegacy(
    input: ChatEngineInput,
  ): Promise<ChatEngineResult> {
    let calls = 0;
    const researchBudget = { remaining: 6 };
    const generate = async (
      request: Parameters<OllamaClient['generate']>[0],
    ): Promise<string> => {
      calls += 1;
      if (calls > 6) throw new Error('MODEL_CALL_LIMIT_REACHED');
      return (await this.ollama.generate(request)).response;
    };
    input.updateStage('routing');
    input = await this.contextualizeInput(input, generate);
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
    let pages = await this.discoverPages(
      deterministic.queries,
      input.signal,
      0,
      false,
      researchBudget,
    );
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
        false,
        researchBudget,
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
            sources: dossier.sources,
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

  private async answerUnified(
    input: ChatEngineInput,
  ): Promise<ChatEngineResult> {
    let calls = 0;
    const researchBudget = { remaining: 6 };
    const generate = async (
      request: Parameters<OllamaClient['generate']>[0],
    ): Promise<string> => {
      calls += 1;
      if (calls > 6) throw new Error('MODEL_CALL_LIMIT_REACHED');
      return (await this.ollama.generate(request)).response;
    };
    const localAfterWebFailure = async (fallbackCode: string) => {
      input.updateStage('writing');
      try {
        const local = validateMarkdown(
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
          markdown: `_${'La recherche Web n’a pas fourni de page exploitable ; cette réponse est locale et non vérifiée.'}_\n\n${local}${highRiskNotice(input.content)}`,
          status: 'unverified' as const,
          route: 'local_unverified' as const,
          retrievalMode: 'none' as const,
          sources: [],
          modelCalls: calls,
          passageCount: 0,
          axisCount: 0,
          requiredAxisCount: 0,
          coveredAxisCount: 0,
          rejectedUnitCount: 0,
          fallbackCode,
        };
      } catch (error) {
        if (input.signal.aborted) throw error;
        return {
          markdown:
            'Friday n’a pu utiliser ni la recherche Web ni le modèle local. Réessayez lorsque les services seront disponibles.',
          status: 'abstained' as const,
          route: 'web_verified' as const,
          retrievalMode: 'none' as const,
          sources: [],
          modelCalls: calls,
          passageCount: 0,
          axisCount: 0,
          requiredAxisCount: 0,
          coveredAxisCount: 0,
          rejectedUnitCount: 0,
          fallbackCode: 'WEB_AND_LOCAL_UNAVAILABLE',
        };
      }
    };

    input.updateStage('routing');
    input = await this.contextualizeInput(input, generate);
    const routed = await this.routeAndPlan(input, generate, true);
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

    const plan = routed.plan ?? fallbackAnswerPlan(input.content);
    const requestedResourceTypes = explicitResourceTypes(input.content);
    const queries = [
      input.content,
      ...explicitResourceSearchQueries(input.content),
      ...searchQueriesForPlan(input.content, plan),
    ]
      .filter((value, index, all) => all.indexOf(value) === index)
      .slice(0, 6);
    input.updateStage('research');
    let discovery: DiscoveryBundle;
    try {
      discovery = await this.discoverBundle(
        queries,
        input.signal,
        0,
        plan.intent === 'recent',
        researchBudget,
      );
    } catch (error) {
      if (input.signal.aborted) throw error;
      return localAfterWebFailure('WEB_SEARCH_UNAVAILABLE');
    }
    if (discovery.pages.length === 0) {
      if (discovery.leads.length > 0) {
        input.updateStage('finalizing');
        return {
          ...appendDiscoveryLeads(
            {
              markdown:
                'La recherche a trouvé des pistes, mais leur contenu original n’était pas suffisamment lisible pour construire une synthèse fiable. Elles restent accessibles ci-dessous.',
              sources: [],
            },
            discovery.leads,
          ),
          status: 'partial',
          route: 'web_verified',
          retrievalMode: 'lexical_fallback',
          modelCalls: calls,
          passageCount: 0,
          axisCount: plan.axes.length,
          requiredAxisCount: 0,
          coveredAxisCount: 0,
          rejectedUnitCount: 0,
          fallbackCode: 'DISCOVERY_ONLY',
          discoveredPageCount: discovery.discoveredCount,
          readablePageCount: 0,
          rejectedPageCount: discovery.rejectedPageCount,
          leadCount: discovery.leads.length,
        };
      }
      return localAfterWebFailure('WEB_EVIDENCE_UNAVAILABLE');
    }

    const dossier = await this.select(
      input.content,
      queries.slice(1),
      discovery.pages,
      input.signal,
    );
    if (dossier.passages.length === 0)
      return localAfterWebFailure('WEB_EVIDENCE_UNAVAILABLE');

    let answer: string;
    try {
      answer = await this.write(
        input,
        dossier,
        generate,
        undefined,
        undefined,
        requestedResourceTypes,
      );
    } catch (error) {
      if (input.signal.aborted) throw error;
      const extracted = extractiveAnswer(
        dossier,
        discovery.leads,
        input.content,
      );
      return {
        ...extracted,
        status: 'partial',
        route: 'web_verified',
        retrievalMode: dossier.retrievalMode,
        modelCalls: calls,
        passageCount: dossier.passages.length,
        axisCount: plan.axes.length,
        requiredAxisCount: 0,
        coveredAxisCount: 0,
        rejectedUnitCount: 0,
        fallbackCode: 'WRITER_UNAVAILABLE',
        discoveredPageCount: discovery.discoveredCount,
        readablePageCount: discovery.pages.length,
        rejectedPageCount: discovery.rejectedPageCount,
        leadCount: discovery.leads.length,
      };
    }

    let audited = await this.audit(
      input,
      answer,
      dossier,
      generate,
      [],
      [],
      calls < 5 ? 2 : 1,
    );
    const partialDraft = (draft: string, fallbackCode: string) => {
      if (citedPassageIds(draft).length === 0) {
        const extracted = extractiveAnswer(
          dossier,
          discovery.leads,
          input.content,
        );
        return {
          ...extracted,
          status: 'partial' as const,
          route: 'web_verified' as const,
          retrievalMode: dossier.retrievalMode,
          modelCalls: calls,
          passageCount: dossier.passages.length,
          axisCount: plan.axes.length,
          requiredAxisCount: 0,
          coveredAxisCount: 0,
          rejectedUnitCount: 0,
          fallbackCode,
          discoveredPageCount: discovery.discoveredCount,
          readablePageCount: discovery.pages.length,
          rejectedPageCount: discovery.rejectedPageCount,
          leadCount: discovery.leads.length,
        };
      }
      const notice =
        '_Vérification automatique incomplète : consultez les sources pour les points importants._';
      const resolved = appendDiscoveryLeads(
        resolveAnswer(
          `${draft}\n\n${notice}${highRiskNotice(input.content)}`,
          dossier,
        ),
        discovery.leads,
      );
      return {
        ...resolved,
        status: 'partial' as const,
        route: 'web_verified' as const,
        retrievalMode: dossier.retrievalMode,
        modelCalls: calls,
        passageCount: dossier.passages.length,
        axisCount: plan.axes.length,
        requiredAxisCount: 0,
        coveredAxisCount: 0,
        rejectedUnitCount: 0,
        fallbackCode,
        discoveredPageCount: discovery.discoveredCount,
        readablePageCount: discovery.pages.length,
        rejectedPageCount: discovery.rejectedPageCount,
        leadCount: discovery.leads.length,
      };
    };
    if (audited.auditError)
      return partialDraft(answer, 'AUDIT_INCOMPLETE_PUBLISHED');

    const availableResourceTypes = availableRequestedResourceTypes(
      requestedResourceTypes,
      dossier,
    );
    let missingResourceTypes = missingRequestedResourceTypes(
      answer,
      availableResourceTypes,
    );
    let segments = splitAuditSegments(answer);
    let compiled = compileAuditedAnswer(segments, audited.audit, false);
    if (
      (compiled.rejectedUnitCount > 0 || missingResourceTypes.length > 0) &&
      calls <= 3
    ) {
      input.updateStage('writing');
      const revised = validateMarkdown(
        await generate({
          model: this.writerModel,
          prompt: revisionPrompt({
            question: input.content,
            answer,
            audit: audited.audit,
            passages: dossier.passages,
            sources: dossier.sources,
            missingResourceTypes,
          }),
          seed: this.seed,
          maxTokens: 1_500,
          temperature: 0.2,
          signal: input.signal,
        }),
        dossier.passages,
      );
      const finalAudit = await this.audit(
        input,
        revised,
        dossier,
        generate,
        [],
        [],
        1,
      );
      if (finalAudit.auditError)
        return partialDraft(
          citedPassageIds(revised).length > 0 ? revised : answer,
          'FINAL_AUDIT_INCOMPLETE_PUBLISHED',
        );
      answer = revised;
      audited = finalAudit;
      segments = splitAuditSegments(answer);
      compiled = compileAuditedAnswer(segments, audited.audit, false);
      missingResourceTypes = missingRequestedResourceTypes(
        answer,
        availableResourceTypes,
      );
    }

    if (compiled.retainedUnitCount === 0 || compiled.passageIds.length === 0) {
      const extracted = extractiveAnswer(
        dossier,
        discovery.leads,
        input.content,
      );
      return {
        ...extracted,
        status: 'partial',
        route: 'web_verified',
        retrievalMode: dossier.retrievalMode,
        modelCalls: calls,
        passageCount: dossier.passages.length,
        axisCount: plan.axes.length,
        requiredAxisCount: 0,
        coveredAxisCount: 0,
        rejectedUnitCount: compiled.rejectedUnitCount,
        fallbackCode: 'AUDIT_REJECTED_TO_EXTRACTIVE',
        discoveredPageCount: discovery.discoveredCount,
        readablePageCount: discovery.pages.length,
        rejectedPageCount: discovery.rejectedPageCount,
        leadCount: discovery.leads.length,
      };
    }

    input.updateStage('finalizing');
    const resolved = appendDiscoveryLeads(
      resolveAnswer(
        `${compiled.markdown}${highRiskNotice(input.content)}`,
        dossier,
      ),
      discovery.leads,
    );
    const verified =
      compiled.rejectedUnitCount === 0 &&
      discovery.leads.length === 0 &&
      missingResourceTypes.length === 0;
    return {
      ...resolved,
      status: verified ? 'verified' : 'partial',
      route: 'web_verified',
      retrievalMode: dossier.retrievalMode,
      modelCalls: calls,
      passageCount: dossier.passages.length,
      axisCount: plan.axes.length,
      requiredAxisCount: 0,
      coveredAxisCount: 0,
      rejectedUnitCount: compiled.rejectedUnitCount,
      fallbackCode: verified
        ? null
        : missingResourceTypes.length
          ? 'PARTIAL_MISSING_EXPLICIT_RESOURCE'
          : 'PARTIAL_UNIFIED_EVIDENCE',
      discoveredPageCount: discovery.discoveredCount,
      readablePageCount: discovery.pages.length,
      rejectedPageCount: discovery.rejectedPageCount,
      leadCount: discovery.leads.length,
    };
  }

  private async answerWithAxes(
    input: ChatEngineInput,
  ): Promise<ChatEngineResult> {
    let calls = 0;
    const researchBudget = { remaining: 6 };
    const generate = async (
      request: Parameters<OllamaClient['generate']>[0],
    ): Promise<string> => {
      calls += 1;
      if (calls > 6) throw new Error('MODEL_CALL_LIMIT_REACHED');
      return (await this.ollama.generate(request)).response;
    };
    input.updateStage('routing');
    input = await this.contextualizeInput(input, generate);
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
        researchBudget,
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
      ({ passageIds }) => passageIds.length === 0,
    );
    if (uncoveredBeforeWriting.length) {
      researchUsed = true;
      const extra = await this.discoverPages(
        uncoveredBeforeWriting.map(({ axis }) => axis.query).slice(0, 2),
        input.signal,
        pages.length,
        plan.intent === 'recent',
        researchBudget,
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
    let audited = await this.audit(
      input,
      answer,
      dossier,
      generate,
      plan.axes,
      assignments,
    );
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
      requiredAxisIds: plan.axes.map(({ id }) => id),
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
        researchBudget,
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
        assignments,
        calls < 5 ? 2 : 1,
      );
      decision = audited.auditError
        ? 'partial'
        : decideEvaluation(audited.audit, {
            revisionUsed: false,
            researchUsed: true,
            finalAudit: true,
            requiredAxisIds: plan.axes.map(({ id }) => id),
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
            sources: dossier.sources,
            axes: plan.axes,
            axisPassages: assignments,
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
        assignments,
        calls < 5 ? 2 : 1,
      );
      decision = audited.auditError
        ? 'partial'
        : decideEvaluation(audited.audit, {
            revisionUsed: true,
            researchUsed,
            finalAudit: true,
            requiredAxisIds: plan.axes.map(({ id }) => id),
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
    const requiredAxisCount = plan.axes.length;
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
        .trim()
        .slice(0, 420);
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
      const raw = await generate({
        model: this.auditorModel,
        prompt:
          attempt === 0
            ? prompt
            : auditorRetryPrompt({ ...promptInput, failureCode }),
        seed: this.seed,
        format: axes.length ? UnitAuditJsonSchema : UnifiedUnitAuditJsonSchema,
        maxTokens: 4_096,
        temperature: 0,
        signal: input.signal,
      });
      try {
        return {
          units,
          audit: deriveAnswerAudit(
            parseAudit(raw, units, dossier.passages, axes),
            axes,
            assignments,
          ),
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

  private async discoverBundle(
    queries: string[],
    signal: AbortSignal,
    sourceOffset = 0,
    recent = false,
    budget = { remaining: 6 },
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
    const retrievedAt = new Date().toISOString();
    const settled = await Promise.allSettled(
      entries.map(async (item, index): Promise<FrozenPage> => {
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
            retrievedAt,
          },
          sections: [{ paragraphs }],
        };
      }),
    );
    const pages = settled.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    );
    const leads = settled.flatMap((result, index) => {
      if (result.status === 'fulfilled') return [];
      const item = entries[index]!;
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
      pages: pages.slice(0, 8),
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
    budget = { remaining: 6 },
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

export const CHAT_RUNTIME_VERSIONS = {
  prompts: PROMPT_VERSIONS,
  writerModel: 'gemma4:e4b-it-qat',
  auditorModel: 'qwen3.5:9b-q4_K_M',
  embeddingModel: 'qwen3-embedding:0.6b',
} as const;
