import { createHash } from 'node:crypto';

import {
  decideEvaluation,
  citedPassageIds,
  functionalOutcome,
  splitAuditUnits,
  suppressUnsupportedUnits,
  type EvaluationDecision,
  type FunctionalOutcome,
} from './audit.js';
import {
  AnswerAuditJsonSchema,
  AnswerAuditSchema,
  FrozenPageSchema,
  validateAuditReferences,
  type AnswerAudit,
  type AuditUnit,
  type ChatEvalCase,
  type EvidencePassage,
  type EvidenceSource,
  type FrozenPage,
} from './contracts.js';
import { computeAutomatedMetrics, type AutomatedMetrics } from './metrics.js';
import { type OllamaClient } from './ollama.js';
import {
  DEFAULT_PASSAGE_LIMITS,
  resolvePassageSources,
  selectEvidencePassagesHybrid,
  type EmbeddingProvider,
  type EvidenceDossier,
  type PassageSelectionLimits,
} from './passages.js';
import {
  PROMPT_VERSIONS,
  auditorPrompt,
  revisionPrompt,
  writerPrompt,
} from './prompts.js';

export interface ModelPair {
  id: string;
  writerModel: string;
  auditorModel: string;
}

export const CANDIDATE_MODEL_PAIRS: ModelPair[] = [
  {
    id: 'gemma-writer-qwen-auditor',
    writerModel: 'gemma4:e4b-it-qat',
    auditorModel: 'qwen3.5:9b-q4_K_M',
  },
  {
    id: 'qwen-writer-gemma-auditor',
    writerModel: 'qwen3.5:9b-q4_K_M',
    auditorModel: 'gemma4:e4b-it-qat',
  },
];

export interface TargetedResearch {
  (input: {
    caseId: string;
    question: string;
    missingAspects: string[];
    signal: AbortSignal;
  }): Promise<FrozenPage[]>;
}

export interface EvaluationRunnerOptions {
  ollama: OllamaClient;
  targetedResearch?: TargetedResearch;
  passageLimits?: PassageSelectionLimits;
  maxModelCalls?: number;
  embeddings?: EmbeddingProvider;
}

export interface EvaluationResult {
  caseId: string;
  pairId: string;
  seed: number;
  answer: string;
  decision: EvaluationDecision;
  audit: AnswerAudit;
  metrics: AutomatedMetrics;
  sourceIds: EvidenceSource['id'][];
  calls: number;
  researchUsed: boolean;
  revisionUsed: boolean;
  auditFallbacks: number;
  outcome: FunctionalOutcome;
  retrievalMode: EvidenceDossier['retrievalMode'];
  retrievalDiagnostics: EvidenceDossier['diagnostics'];
  referenceParagraphRecall: number | null;
  retrievalDimensionCoverage: number | null;
  elapsedMs: number;
  promptVersions: typeof PROMPT_VERSIONS;
}

function validateModelMarkdown(
  answer: string,
  passages: EvidencePassage[],
): string {
  if (answer.trim().length === 0 || answer.length > 100_000) {
    throw new Error('MODEL_ANSWER_SIZE_INVALID');
  }
  if (/https?:\/\//iu.test(answer))
    throw new Error('MODEL_OUTPUT_URL_FORBIDDEN');
  if (/<\/?[a-z][^>]*>/iu.test(answer)) {
    throw new Error('MODEL_OUTPUT_HTML_FORBIDDEN');
  }
  const known = new Set(passages.map(({ id }) => id));
  for (const match of answer.matchAll(/\[(P[1-9]\d*)\]/gu)) {
    if (!known.has(match[1] as EvidencePassage['id'])) {
      throw new Error('MODEL_OUTPUT_UNKNOWN_PASSAGE');
    }
  }
  return answer.trim();
}

function parseAudit(
  raw: string,
  units: AuditUnit[],
  passages: EvidencePassage[],
): AnswerAudit {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error('AUDIT_INVALID_JSON');
  }
  const audit = AnswerAuditSchema.parse(json);
  return validateAuditReferences(audit, units, passages);
}

function mergePages(original: FrozenPage[], added: FrozenPage[]): FrozenPage[] {
  const seenIds = new Set(original.map(({ source }) => source.id));
  const seenUrls = new Set(original.map(({ source }) => source.url));
  const merged = [...original];
  for (const page of added) {
    if (seenIds.has(page.source.id) || seenUrls.has(page.source.url)) continue;
    seenIds.add(page.source.id);
    seenUrls.add(page.source.url);
    merged.push(page);
  }
  return merged.slice(0, 20);
}

export class EvaluationRunner {
  private readonly limits: PassageSelectionLimits;
  private readonly maxModelCalls: number;

  constructor(private readonly options: EvaluationRunnerOptions) {
    this.limits = options.passageLimits ?? DEFAULT_PASSAGE_LIMITS;
    this.maxModelCalls = options.maxModelCalls ?? 6;
    if (this.maxModelCalls < 2 || this.maxModelCalls > 6) {
      throw new Error('MODEL_CALL_LIMIT_MUST_BE_2_TO_6');
    }
  }

  async runCase(
    evalCase: ChatEvalCase,
    pair: ModelPair,
    seed: number,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<EvaluationResult> {
    const startedAt = performance.now();
    let calls = 0;
    let researchUsed = false;
    let revisionUsed = false;
    let auditFallbacks = 0;
    let auditError = false;
    let dossier = await selectEvidencePassagesHybrid({
      question: evalCase.question,
      pages: evalCase.pages,
      limits: this.limits,
      ...(this.options.embeddings
        ? { embeddings: this.options.embeddings }
        : {}),
      signal,
    });

    const generate = async (
      model: string,
      prompt: string,
      format?: object,
      maxTokens?: number,
      temperature?: number,
    ): Promise<string> => {
      calls += 1;
      if (calls > this.maxModelCalls)
        throw new Error('MODEL_CALL_LIMIT_REACHED');
      const result = await this.options.ollama.generate({
        model,
        prompt,
        seed,
        ...(format === undefined ? {} : { format }),
        ...(maxTokens === undefined ? {} : { maxTokens }),
        ...(temperature === undefined ? {} : { temperature }),
        signal,
      });
      return result.response;
    };

    const write = async (evidence: EvidenceDossier): Promise<string> =>
      validateModelMarkdown(
        await generate(
          pair.writerModel,
          writerPrompt({
            question: evalCase.question,
            priorTurns: evalCase.priorTurns,
            passages: evidence.passages,
          }),
          undefined,
          1_500,
          0.2,
        ),
        evidence.passages,
      );

    const auditAnswer = async (
      answer: string,
      evidence: EvidenceDossier,
    ): Promise<{ units: AuditUnit[]; audit: AnswerAudit }> => {
      const units = splitAuditUnits(answer);
      const prompt = auditorPrompt({
        question: evalCase.question,
        units,
        passages: evidence.passages,
      });
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const raw = await generate(
          pair.auditorModel,
          prompt,
          AnswerAuditJsonSchema,
          2_500,
          0,
        );
        try {
          return { units, audit: parseAudit(raw, units, evidence.passages) };
        } catch {
          auditFallbacks += 1;
        }
      }
      auditError = true;
      return {
        units,
        audit: {
          units: units.map(({ id }) => ({
            unitId: id,
            verdict: 'unsupported' as const,
            passageIds: [],
            reason: 'Audit structuré invalide après une répétition bornée.',
          })),
          usefulness: 'misses',
          missingAspects: ['Vérification indisponible'],
          evidenceSufficiency: 'insufficient',
        },
      };
    };

    let answer = await write(dossier);
    let audited = await auditAnswer(answer, dossier);
    let decision: EvaluationDecision = auditError
      ? 'partial'
      : decideEvaluation(audited.audit, {
          revisionUsed,
          researchUsed,
          finalAudit: false,
        });

    if (!auditError && decision === 'research') {
      researchUsed = true;
      if (this.options.targetedResearch) {
        const extraPages = FrozenPageSchema.array()
          .max(20)
          .parse(
            await this.options.targetedResearch({
              caseId: evalCase.id,
              question: evalCase.question,
              missingAspects: audited.audit.missingAspects,
              signal,
            }),
          );
        dossier = await selectEvidencePassagesHybrid({
          question: evalCase.question,
          queries: audited.audit.missingAspects,
          pages: mergePages(evalCase.pages, extraPages),
          limits: this.limits,
          ...(this.options.embeddings
            ? { embeddings: this.options.embeddings }
            : {}),
          signal,
        });
        answer = await write(dossier);
        audited = await auditAnswer(answer, dossier);
        decision = auditError
          ? 'partial'
          : decideEvaluation(audited.audit, {
              revisionUsed,
              researchUsed,
              finalAudit: true,
            });
      } else {
        decision = 'partial';
      }
    } else if (!auditError && decision === 'revise') {
      revisionUsed = true;
      answer = validateModelMarkdown(
        await generate(
          pair.writerModel,
          revisionPrompt({
            question: evalCase.question,
            answer,
            audit: audited.audit,
            passages: dossier.passages,
          }),
          undefined,
          1_500,
          0.2,
        ),
        dossier.passages,
      );
      audited = await auditAnswer(answer, dossier);
      decision = auditError
        ? 'partial'
        : decideEvaluation(audited.audit, {
            revisionUsed,
            researchUsed,
            finalAudit: true,
          });
    }

    if (decision === 'partial') {
      answer = suppressUnsupportedUnits(audited.units, audited.audit);
    }
    const citedIds = citedPassageIds(answer);
    const sources = resolvePassageSources([...new Set(citedIds)], dossier);
    const selectedParagraphs = new Set(
      dossier.diagnostics.selectedParagraphKeys,
    );
    const referenceEvidence = evalCase.criteria.referenceEvidence ?? [];
    const referenceParagraphs = referenceEvidence.flatMap(({ paragraphs }) =>
      paragraphs.map(
        ({ sourceId, sectionIndex, paragraphIndex }) =>
          `${sourceId}:${sectionIndex.toString()}:${paragraphIndex.toString()}`,
      ),
    );
    return {
      caseId: evalCase.id,
      pairId: pair.id,
      seed,
      answer,
      decision,
      audit: audited.audit,
      metrics: computeAutomatedMetrics(
        answer,
        audited.units,
        audited.audit,
        functionalOutcome(answer, decision, auditError),
      ),
      sourceIds: sources.map(({ id }) => id),
      calls,
      researchUsed,
      revisionUsed,
      auditFallbacks,
      outcome: functionalOutcome(answer, decision, auditError),
      retrievalMode: dossier.retrievalMode,
      retrievalDiagnostics: dossier.diagnostics,
      referenceParagraphRecall:
        referenceParagraphs.length === 0
          ? null
          : referenceParagraphs.filter((key) => selectedParagraphs.has(key))
              .length / referenceParagraphs.length,
      retrievalDimensionCoverage:
        referenceEvidence.length === 0
          ? null
          : referenceEvidence.filter(({ paragraphs }) =>
              paragraphs.some(({ sourceId, sectionIndex, paragraphIndex }) =>
                selectedParagraphs.has(
                  `${sourceId}:${sectionIndex.toString()}:${paragraphIndex.toString()}`,
                ),
              ),
            ).length / referenceEvidence.length,
      elapsedMs: Math.round(performance.now() - startedAt),
      promptVersions: PROMPT_VERSIONS,
    };
  }
}

export function blindLabel(
  caseId: string,
  seed: number,
  pairId: string,
  pairIds: string[] = CANDIDATE_MODEL_PAIRS.map(({ id }) => id),
): 'A' | 'B' {
  const orderedPairIds = [...pairIds].sort();
  const pairIndex = orderedPairIds.indexOf(pairId);
  if (pairIndex < 0 || orderedPairIds.length !== 2) {
    throw new Error('BLIND_REVIEW_REQUIRES_TWO_KNOWN_PAIRS');
  }
  const digest = createHash('sha256')
    .update(`${caseId}\0${seed.toString()}`)
    .digest();
  return (digest[0]! + pairIndex) % 2 === 0 ? 'A' : 'B';
}
