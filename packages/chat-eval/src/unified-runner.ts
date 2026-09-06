import {
  PROMPT_VERSIONS,
  SharedChatEngine,
  splitAuditUnits,
  type AnswerAudit,
  type EvidenceDossier,
  type RuntimeObservation,
} from '@friday/assistant-core';
import type { ChatEvalCase } from './contracts.js';
import type {
  EvaluationResult,
  EvaluationRunnerOptions,
  ModelPair,
} from './evaluation-types.js';
import { computeAutomatedMetrics } from './metrics.js';

/** Replay frozen original documents through the production orchestration. No network search. */
export async function runUnifiedCase(
  evalCase: ChatEvalCase,
  pair: ModelPair,
  seed: number,
  signal: AbortSignal,
  options: EvaluationRunnerOptions,
): Promise<EvaluationResult> {
  const startedAt = performance.now();
  let dossier: EvidenceDossier | undefined;
  const audits: RuntimeObservation[] = [];
  const pagesByUrl = new Map(
    evalCase.pages.map((page) => [page.source.url, page]),
  );
  const engine = new SharedChatEngine({
    pipeline: 'unified',
    retrieval: options.embeddings ? 'hybrid' : 'lexical',
    writerModel: pair.writerModel,
    auditorModel: pair.auditorModel,
    ...(pair.profiles ? { profiles: pair.profiles } : {}),
    ...(pair.modelsByRole ? { modelsByRole: pair.modelsByRole } : {}),
    seed,
    ollama: {
      generate: (request) => options.ollama.generate(request),
      embed: (request) =>
        options.embeddings!.embed(request.input, request.signal),
    },
    search: {
      search: async () => ({
        creditsUsed: 0,
        evidence: evalCase.pages.map(({ source }) => ({
          title: source.title,
          url: source.url,
          publishedAt: source.publishedAt ?? null,
          content: '',
        })),
      }),
    },
    pageReader: {
      fetchArticleDocument: async (url) => {
        const page = pagesByUrl.get(url);
        if (!page) throw new Error('UNFROZEN_URL');
        return {
          text: page.sections
            .flatMap(({ paragraphs }) => paragraphs)
            .join('\n\n'),
          publishedAt: page.source.publishedAt ?? null,
          sections: page.sections,
          retrievedAt: page.source.retrievedAt,
        };
      },
    },
    observe: (event) => {
      if (event.kind === 'evidence') dossier = event.dossier;
      else audits.push(event);
    },
  });
  const result = await engine.answer({
    content: evalCase.question,
    mode: 'web',
    priorTurns: evalCase.priorTurns,
    signal,
    updateStage: () => undefined,
  });
  const lastValid = audits.findLast(
    (event) => event.kind === 'publication' && event.valid,
  );
  const extractive =
    result.fallbackCode?.includes('EXTRACTIVE') ||
    result.fallbackCode === 'WRITER_UNAVAILABLE' ||
    result.markdown.startsWith('Les sources consultées donnent');
  const publication =
    result.fallbackCode === 'CLARIFICATION_REQUIRED'
      ? 'clarification'
      : result.status === 'abstained'
        ? 'abstained'
        : result.route === 'local_unverified'
          ? 'unverified'
          : extractive || (!lastValid && dossier?.passages.length)
            ? 'extractive'
            : result.fallbackCode === 'DISCOVERY_ONLY'
              ? 'discovery'
              : 'synthesis';
  const auditAvailable = publication === 'synthesis' && Boolean(lastValid);
  const units = auditAvailable
    ? lastValid!.units!
    : splitAuditUnits(result.markdown);
  const audit: AnswerAudit = auditAvailable
    ? lastValid!.audit!
    : {
        units: units.map(({ id }) => ({
          unitId: id,
          verdict: 'unsupported',
          passageIds: [],
        })),
        axes: [],
        usefulness: 'misses',
        missingAspects: ['Vérification factuelle indisponible'],
        evidenceSufficiency: 'insufficient',
      };
  const outcome =
    result.status === 'verified' || result.status === 'unverified'
      ? 'answered'
      : result.status === 'abstained'
        ? 'abstained'
        : 'partial';
  const originalIds = new Map(
    (dossier?.sources ?? []).map((source) => [
      source.id,
      pagesByUrl.get(source.url)!.source.id,
    ]),
  );
  const selected = new Set(
    (dossier?.diagnostics.selectedParagraphKeys ?? []).map((key) => {
      const [id, ...coordinates] = key.split(':');
      return `${originalIds.get(id!)!}:${coordinates.join(':')}`;
    }),
  );
  const references = evalCase.criteria.referenceEvidence ?? [];
  const keys = (paragraphs: (typeof references)[number]['paragraphs']) =>
    paragraphs.map(
      (p) => `${p.sourceId}:${p.sectionIndex}:${p.paragraphIndex}`,
    );
  const allKeys = [
    ...new Set(references.flatMap(({ paragraphs }) => keys(paragraphs))),
  ];
  return {
    pipeline: 'unified',
    publication,
    auditAvailable,
    fallbackCode: result.fallbackCode ?? null,
    caseId: evalCase.id,
    pairId: pair.id,
    seed,
    answer: result.markdown,
    publishedSources: result.sources.map((source) => ({
      id: source.id,
      sourceId: pagesByUrl.get(source.url)?.source.id ?? null,
      title: source.title,
      url: source.url,
    })),
    decision:
      result.status === 'verified' || result.status === 'unverified'
        ? 'pass'
        : 'partial',
    audit,
    metrics: computeAutomatedMetrics(
      auditAvailable ? lastValid!.answer! : result.markdown,
      units,
      audit,
      outcome,
    ),
    sourceIds: [...originalIds.values()],
    calls: result.modelCalls,
    researchUsed: result.route === 'web_verified',
    revisionUsed:
      new Set(audits.filter((a) => a.kind === 'audit').map((a) => a.answer))
        .size > 1,
    auditFallbacks: audits.filter((a) => a.kind === 'audit' && !a.valid).length,
    outcome,
    retrievalMode:
      result.retrievalMode === 'none'
        ? 'lexical_fallback'
        : result.retrievalMode,
    retrievalDiagnostics: dossier
      ? { ...dossier.diagnostics, selectedParagraphKeys: [...selected] }
      : {
          candidateWindows: 0,
          queryCount: 0,
          lexicalCandidates: 0,
          semanticCandidates: 0,
          selectedParagraphKeys: [],
          queryPassageIds: [],
          queries: [],
        },
    referenceParagraphRecall: allKeys.length
      ? allKeys.filter((key) => selected.has(key)).length / allKeys.length
      : null,
    retrievalDimensionCoverage: references.length
      ? references.filter(({ paragraphs }) =>
          keys(paragraphs).some((key) => selected.has(key)),
        ).length / references.length
      : null,
    elapsedMs: Math.round(performance.now() - startedAt),
    plannedAxisCount: result.axisCount ?? 0,
    requiredAxisCount: result.requiredAxisCount ?? 0,
    coveredAxisCount: result.coveredAxisCount ?? 0,
    promptVersions: PROMPT_VERSIONS,
  };
}
