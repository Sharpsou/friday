import {
  decideEvaluation,
  localPrompt,
  OllamaClient,
  revisionPrompt,
  routeQuestion,
  suppressUnsupportedUnits,
} from '../foundation.js';
import type {
  ChatEngineInput,
  ChatEngineResult,
} from '../runtime-contracts.js';
import type { PipelineServices } from './pipeline-services.js';
import { resolveAnswer, validateMarkdown } from './publication.js';
import { routeForcedByMode } from './retrieval-policy.js';
export async function runLegacyPipeline(
  services: Pick<
    PipelineServices,
    | 'ollama'
    | 'contextualizeInput'
    | 'auditorModel'
    | 'seed'
    | 'writerModel'
    | 'discoverPages'
    | 'select'
    | 'write'
    | 'audit'
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
  const deterministic =
    routeForcedByMode(input.mode, input.content) ??
    (await routeQuestion(input.content, {
      ollama: services.ollama,
      model: services.auditorModel,
      seed: services.seed,
      signal: input.signal,
    }));
  if (deterministic.decidedBy === 'classifier') calls += 1;
  if (deterministic.route === 'local') {
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
    };
  }

  input.updateStage('research');
  let pages = await services.discoverPages(
    deterministic.queries,
    input.signal,
    0,
    false,
    researchBudget,
  );
  if (pages.length === 0) throw new Error('WEB_EVIDENCE_UNAVAILABLE');
  let dossier = await services.select(
    input.content,
    deterministic.queries.slice(1),
    pages,
    input.signal,
  );
  let answer = await services.write(input, dossier, generate);
  let audited = await services.audit(input, answer, dossier, generate);
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
    const extra = await services.discoverPages(
      [query],
      input.signal,
      pages.length,
      false,
      researchBudget,
    );
    pages = [...pages, ...extra].slice(0, 16);
    dossier = await services.select(
      input.content,
      audited.audit.missingAspects.slice(0, 2),
      pages,
      input.signal,
    );
    answer = await services.write(input, dossier, generate);
    audited = await services.audit(input, answer, dossier, generate);
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
        model: services.writerModel,
        prompt: revisionPrompt({
          question: input.content,
          answer,
          audit: audited.audit,
          passages: dossier.passages,
          sources: dossier.sources,
        }),
        seed: services.seed,
        maxTokens: 2_000,
        temperature: 0.2,
        signal: input.signal,
      }),
      dossier.passages,
    );
    audited = await services.audit(input, answer, dossier, generate);
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
