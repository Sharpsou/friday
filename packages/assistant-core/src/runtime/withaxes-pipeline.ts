import {
  assignEvidenceToAxes,
  compileAuditedAnswer,
  decideEvaluation,
  fallbackAnswerPlan,
  localPrompt,
  mergeRedundantAxes,
  OllamaClient,
  requiredAxesCovered,
  revisionPrompt,
  searchQueriesForPlan,
  splitAuditSegments,
  type FrozenPage,
} from '../foundation.js';
import type {
  ChatEngineInput,
  ChatEngineResult,
} from '../runtime-contracts.js';
import type { PipelineServices } from './pipeline-services.js';
import { resolveAnswer, validateMarkdown } from './publication.js';
export async function runAxesPipeline(
  services: Pick<
    PipelineServices,
    | 'ollama'
    | 'contextualizeInput'
    | 'routeAndPlan'
    | 'writerModel'
    | 'seed'
    | 'discoverPages'
    | 'noEvidenceFallback'
    | 'select'
    | 'write'
    | 'audit'
    | 'evidenceFallback'
  >,
  input: ChatEngineInput,
): Promise<ChatEngineResult> {
  let calls = 0;
  const researchBudget = { remaining: 6 };
  const generate = async (
    request: Parameters<OllamaClient['generate']>[0],
  ): Promise<string> => {
    calls += 1;
    if (calls > 6) throw new Error('MODEL_CALL_LIMIT_REACHED');
    return (await services.ollama.generate(request)).response;
  };
  input.updateStage('routing');
  input = await services.contextualizeInput(input, generate);
  const routed = await services.routeAndPlan(input, generate);
  if (routed.route === 'local') {
    input.updateStage('writing');
    const markdown = validateMarkdown(
      await generate({
        model: services.writerModel,
        prompt: localPrompt({
          question: input.content,
          priorTurns: input.priorTurns,
        }),
        seed: services.seed,
        maxTokens: 2_000,
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
    pages = await services.discoverPages(
      searchQueriesForPlan(input.content, plan),
      input.signal,
      0,
      plan.intent === 'recent',
      researchBudget,
    );
  } catch (error) {
    if (input.signal.aborted) throw error;
    return services.noEvidenceFallback(plan, calls, 'WEB_SEARCH_UNAVAILABLE');
  }
  if (pages.length === 0)
    return services.noEvidenceFallback(plan, calls, 'WEB_EVIDENCE_UNAVAILABLE');
  let dossier = await services.select(
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
    const extra = await services
      .discoverPages(
        uncoveredBeforeWriting.map(({ axis }) => axis.query).slice(0, 2),
        input.signal,
        pages.length,
        plan.intent === 'recent',
        researchBudget,
      )
      .catch((error: unknown) => {
        if (input.signal.aborted) throw error;
        return [];
      });
    pages = [...pages, ...extra].slice(0, 16);
    dossier = await services.select(
      input.content,
      plan.axes.map(({ question }) => question),
      pages,
      input.signal,
    );
    assignments = mergeRedundantAxes(assignEvidenceToAxes(plan, dossier));
    plan = { ...plan, axes: assignments.map(({ axis }) => axis) };
  }

  let answer = await services.write(
    input,
    dossier,
    generate,
    plan,
    assignments,
  );
  let audited = await services.audit(
    input,
    answer,
    dossier,
    generate,
    plan.axes,
    assignments,
  );
  if (audited.auditError)
    return services.evidenceFallback(
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
    const extra = await services
      .discoverPages(
        (missingAssignments.length
          ? missingAssignments.map(({ axis }) => axis.query)
          : audited.audit.missingAspects
        ).slice(0, 2),
        input.signal,
        pages.length,
        plan.intent === 'recent',
        researchBudget,
      )
      .catch((error: unknown) => {
        if (input.signal.aborted) throw error;
        return [];
      });
    pages = [...pages, ...extra].slice(0, 16);
    dossier = await services.select(
      input.content,
      plan.axes.map(({ question }) => question),
      pages,
      input.signal,
    );
    assignments = mergeRedundantAxes(assignEvidenceToAxes(plan, dossier));
    answer = await services.write(input, dossier, generate, plan, assignments);
    audited = await services.audit(
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
        model: services.writerModel,
        prompt: revisionPrompt({
          question: input.content,
          answer,
          audit: audited.audit,
          passages: dossier.passages,
          sources: dossier.sources,
          axes: plan.axes,
          axisPassages: assignments,
        }),
        seed: services.seed,
        maxTokens: 2_000,
        temperature: 0.2,
        signal: input.signal,
      }),
      dossier.passages,
    );
    audited = await services.audit(
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
    return services.evidenceFallback(
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
    return services.evidenceFallback(
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
