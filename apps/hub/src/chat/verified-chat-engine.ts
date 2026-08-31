import {
  AnswerAuditJsonSchema,
  AnswerAuditSchema,
  OllamaClient,
  PROMPT_VERSIONS,
  auditorPrompt,
  citedPassageIds,
  decideEvaluation,
  localPrompt,
  resolvePassageSources,
  revisionPrompt,
  routeQuestion,
  selectEvidencePassagesHybrid,
  splitAuditUnits,
  suppressUnsupportedUnits,
  validateAuditReferences,
  writerPrompt,
  type AnswerAudit,
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
  return answer;
}

function parseAudit(
  raw: string,
  units: AuditUnit[],
  passages: EvidencePassage[],
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
  );
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
  }

  webUsage(signal: AbortSignal) {
    return this.search.usage(signal);
  }

  async answer(input: ChatEngineInput): Promise<ChatEngineResult> {
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
  ): Promise<string> {
    input.updateStage('writing');
    return validateMarkdown(
      await generate({
        model: this.writerModel,
        prompt: writerPrompt({
          question: input.content,
          priorTurns: input.priorTurns,
          passages: dossier.passages,
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
  ): Promise<{ units: AuditUnit[]; audit: AnswerAudit; auditError: boolean }> {
    input.updateStage('auditing');
    const units = splitAuditUnits(answer);
    const prompt = auditorPrompt({
      question: input.content,
      units,
      passages: dossier.passages,
    });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const raw = await generate({
        model: this.auditorModel,
        prompt,
        seed: this.seed,
        format: AnswerAuditJsonSchema,
        maxTokens: 2_500,
        temperature: 0,
        signal: input.signal,
      });
      try {
        return {
          units,
          audit: parseAudit(raw, units, dossier.passages),
          auditError: false,
        };
      } catch {
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
    const entries = [...unique.values()].slice(0, 8);
    const settled = await Promise.allSettled(
      entries.map(async (item, index): Promise<FrozenPage> => {
        const text = await this.pageReader.fetchArticleText(item.url, signal);
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
            ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
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
