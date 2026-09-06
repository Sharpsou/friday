import {
  boundedConversationTurns,
  compileAuditedAnswer,
  deriveAnswerAudit,
  fallbackAnswerPlan,
  fallbackContextualQuestion,
  localPrompt,
  OllamaClient,
  requiredAxesCovered,
  searchQueriesForPlan,
  splitAuditSegments,
  splitAuditUnits,
  stripPassageCitations,
  type AnswerAudit,
  type FrozenPage,
} from '../foundation.js';
import { defaultModelProfile, modelRole } from '../model-profiles.js';
import {
  ContinuationJsonSchema,
  ContinuationSchema,
  memoryDossier,
  ResearchMemorySchema,
} from '../research-memory.js';
import type {
  ChatEngineInput,
  ChatEngineResult,
} from '../runtime-contracts.js';
import {
  auditSynthesis,
  normalizeSynthesisCitations,
  prepareSynthesis,
  SOURCE_SYSTEM,
  synthesisPrompt,
  type SynthesisCorrection,
} from '../synthesis.js';
import type { PipelineServices } from './pipeline-services.js';
import {
  highRiskNotice,
  resolveAnswer,
  validateMarkdown,
} from './publication.js';
import type { DiscoveryBundle } from './runtime-types.js';
export async function runUnifiedPipeline(
  services: Pick<
    PipelineServices,
    | 'options'
    | 'ollama'
    | 'auditorModel'
    | 'seed'
    | 'contextualizeInput'
    | 'routeAndPlan'
    | 'writerModel'
    | 'discoverBundle'
    | 'pageReader'
    | 'select'
  >,
  input: ChatEngineInput,
): Promise<ChatEngineResult> {
  let calls = 0;
  const originalQuestion = input.content;
  const saved = ResearchMemorySchema.safeParse(input.priorResearch);
  const memory = saved.success ? saved.data : undefined;
  const availableMemory = memory ? structuredClone(memory) : undefined;
  let continuation: 'reuse' | 'links' | 'research' = 'research';
  const generate = async (
    request: Parameters<OllamaClient['generate']>[0],
  ): Promise<string> => {
    input.signal.throwIfAborted();
    if (calls >= 12) throw new Error('MODEL_CALL_LIMIT_REACHED');
    calls += 1;
    const role = modelRole(request.prompt);
    const model = services.options.modelsByRole?.[role] ?? request.model;
    const result = await services.ollama.generate({
      ...request,
      model,
      system: request.system ?? SOURCE_SYSTEM,
      ...defaultModelProfile(model, role),
      ...services.options.profiles?.[role],
    });
    services.options.observe?.({
      kind: 'generation',
      generation: {
        model,
        role,
        profile: {
          ...defaultModelProfile(model, role),
          ...services.options.profiles?.[role],
        },
        durationMs: result.durationMs,
        ...(result.promptTokens === undefined
          ? {}
          : { promptTokens: result.promptTokens }),
        ...(result.outputTokens === undefined
          ? {}
          : { outputTokens: result.outputTokens }),
      },
    });
    return result.response;
  };
  const base = (): ChatEngineResult => ({
    markdown: '',
    sources: [],
    status: 'abstained',
    route: 'web_verified',
    retrievalMode: 'none',
    modelCalls: calls,
    passageCount: 0,
  });
  input.updateStage('routing');
  if (memory?.sources.length && input.mode !== 'local') {
    try {
      const choice = ContinuationSchema.parse(
        JSON.parse(
          await generate({
            model: services.auditorModel,
            seed: services.seed,
            signal: input.signal,
            maxTokens: 512,
            format: ContinuationJsonSchema,
            prompt: [
              'CONTINUATION=research-v1',
              'Analyse la demande actuelle dans la conversation. question doit la rendre autonome sans élargir son périmètre. action=links uniquement pour restituer des liens déjà cités (sans nouvelle affirmation), reuse pour réfléchir/rédiger avec les extraits existants, research pour un nouveau sujet, une actualisation ou des preuves manquantes. Si seuls les liens sont conservés, reuse permet de relire ces pages. sourceIds sélectionne les sources pertinentes parmi les identifiants fournis ; liste vide pour un nouveau sujet. Ne prends jamais une ancienne réponse pour une preuve. Les dates de collecte ne garantissent pas une information actuelle.',
              `DEMANDE_PRIORITAIRE=${JSON.stringify(originalQuestion)}`,
              `HISTORIQUE_NON_FIABLE=${JSON.stringify(boundedConversationTurns(input.priorTurns))}`,
              `RECHERCHE_PRECEDENTE=${JSON.stringify(memory)}`,
            ].join('\n'),
          }),
        ),
      );
      if (
        choice.sourceIds.some((id) => !memory.sources.some((s) => s.id === id))
      )
        throw new Error('UNKNOWN_CONTINUATION_SOURCE');
      continuation = choice.action;
      input = {
        ...input,
        content: `Demande actuelle (prioritaire) : ${originalQuestion}\nContexte : ${choice.question}`,
      };
      const ids = new Set(choice.sourceIds);
      memory.sources = memory.sources.filter((s) => ids.has(s.id));
      memory.passages = memory.passages.filter((p) => ids.has(p.sourceId));
      if (!memory.sources.length) continuation = 'research';
    } catch (error) {
      if (input.signal.aborted) throw error;
      // Invalid routing cannot invent a source or promote an earlier answer.
      input = {
        ...input,
        content: fallbackContextualQuestion(originalQuestion, input.priorTurns),
      };
    }
    if (continuation === 'links') {
      const sources = memory.sources.map((s) => ({
        ...s,
        domain: new URL(s.url).hostname,
        publishedAt: s.publishedAt ?? null,
        evidenceLevel: 'readable' as const,
      }));
      return {
        ...base(),
        markdown:
          'Voici les liens retenus dans la recherche précédente :\n\n' +
          sources
            .map((s) => `- ${s.title.replace(/[[\]<>\r\n]/gu, ' ')} [${s.id}]`)
            .join('\n'),
        sources,
        status: 'verified',
        researchMemory: availableMemory!,
        fallbackCode: 'PREVIOUS_SOURCE_LINKS',
      };
    }
  } else input = await services.contextualizeInput(input, generate);
  const routed = await services.routeAndPlan(
    continuation === 'reuse' ? { ...input, mode: 'web' } : input,
    generate,
  );
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
        maxTokens: 2000,
        signal: input.signal,
      }),
      [],
    );
    return {
      ...base(),
      markdown,
      status: 'unverified',
      route: 'local_unverified',
    };
  }
  const plan = routed.plan ?? fallbackAnswerPlan(input.content);
  if (plan.clarification?.endsWith('?'))
    return {
      ...base(),
      markdown: validateMarkdown(plan.clarification, []),
      status: 'partial',
      fallbackCode: 'CLARIFICATION_REQUIRED',
      axisCount: plan.axes.length,
      requiredAxisCount: plan.axes.length,
      coveredAxisCount: 0,
    };
  const queries = [
    ...new Set([input.content, ...searchQueriesForPlan(input.content, plan)]),
  ];
  const researchBudget = {
    remaining: 6,
    remainingPages:
      16 -
      (memory?.sources.filter(
        (s) => !memory.passages.some((p) => p.sourceId === s.id),
      ).length ?? 0),
    visited: new Set<string>(),
  };
  input.updateStage('research');
  let discovery: DiscoveryBundle;
  try {
    discovery =
      continuation === 'reuse'
        ? { pages: [], leads: [], discoveredCount: 0, rejectedPageCount: 0 }
        : await services.discoverBundle(
            queries.slice(0, 6),
            input.signal,
            memory?.sources.length ? 32 : 0,
            plan.intent === 'recent',
            researchBudget,
          );
  } catch (error) {
    if (input.signal.aborted) throw error;
    return {
      ...base(),
      markdown:
        'Je ne peux pas vérifier cette demande : la recherche est indisponible. Réessayez lorsque les sources seront accessibles.',
      fallbackCode: 'WEB_SEARCH_UNAVAILABLE',
    };
  }
  // Older conversations have URLs but no stored excerpts: read those originals.
  const previousPages: FrozenPage[] = [];
  if (memory?.sources.length) {
    for (const source of memory.sources) {
      const passages = memory.passages.filter((p) => p.sourceId === source.id);
      if (passages.length)
        previousPages.push({
          source,
          sections: passages.map((p) => ({
            ...(p.heading ? { heading: p.heading } : {}),
            paragraphs: [p.text],
          })),
        });
      else {
        try {
          const page = await services.pageReader.fetchArticleDocument(
            source.url,
            input.signal,
          );
          previousPages.push({
            source: {
              ...source,
              retrievedAt: page.retrievedAt ?? new Date().toISOString(),
            },
            sections: page.sections ?? [
              {
                paragraphs: page.text
                  .split(/\n{2,}/u)
                  .filter(Boolean)
                  .slice(0, 500),
              },
            ],
          });
        } catch (error) {
          if (input.signal.aborted) throw error;
        }
      }
    }
  }
  const dossier =
    continuation === 'reuse' && memory?.passages.length
      ? memoryDossier(memory)
      : await services.select(
          input.content,
          queries.slice(1),
          [
            ...previousPages.filter(
              (p) =>
                !discovery.pages.some(
                  (fresh) => fresh.source.url === p.source.url,
                ),
            ),
            ...discovery.pages,
          ],
          input.signal,
        );
  const resultBase = (): ChatEngineResult => ({
    ...base(),
    researchMemory: { sources: dossier.sources, passages: dossier.passages },
    retrievalMode: dossier.retrievalMode,
    passageCount: dossier.passages.length,
    axisCount: plan.axes.length,
    requiredAxisCount: plan.axes.length,
    coveredAxisCount: 0,
    discoveredPageCount: discovery.discoveredCount,
    readablePageCount: discovery.pages.length,
    rejectedPageCount: discovery.rejectedPageCount,
    leadCount: 0,
  });
  if (!dossier.passages.length)
    return {
      ...resultBase(),
      markdown:
        'Les pages trouvées ne donnent pas de contenu exploitable pour répondre de façon fiable.',
      fallbackCode: 'WEB_EVIDENCE_UNAVAILABLE',
    };
  const brief = prepareSynthesis(plan, dossier);
  services.options.observe?.({ kind: 'preparation', synthesisDossier: brief });
  let accepted: ReturnType<typeof compileAuditedAnswer> | undefined;
  let lastAudit: AnswerAudit | undefined;
  let draft = '';
  let corrections: SynthesisCorrection[] = [];
  let revisionAudit: AnswerAudit | undefined;
  const rejectedTexts = new Set<string>();
  const drafts = new Set<string>();
  let failureCode: string | undefined;
  for (let attempt = 0; attempt < 4; attempt++) {
    // Reserve an independent audit before allowing any further writing.
    const maxUnits = Math.min(18, (12 - calls - 1) * 6);
    if (maxUnits < 6) break;
    let auditing = false;
    try {
      input.updateStage('writing');
      draft = validateMarkdown(
        normalizeSynthesisCitations(
          await generate({
            model: services.writerModel,
            seed: services.seed + attempt,
            signal: input.signal,
            maxTokens: 2000,
            temperature: 0.2,
            prompt:
              synthesisPrompt(input.content, plan, brief, maxUnits) +
              `\nHISTORIQUE_NON_FIABLE (contexte seulement, jamais une preuve ; les identifiants des anciennes réponses ne désignent pas le dossier actuel)=${JSON.stringify(boundedConversationTurns(input.priorTurns))}` +
              (attempt
                ? `\nREVISION: corrige les omissions et rejets suivants sans répéter une affirmation rejetée.\n${JSON.stringify({ corrections, audit: revisionAudit })}\nBROUILLON_NON_FIABLE=${JSON.stringify(draft)}`
                : ''),
          }),
          brief,
        ),
        dossier.passages,
      );
      const draftKey = draft.replace(/\s+/gu, ' ').trim();
      if (drafts.has(draftKey)) break;
      drafts.add(draftKey);
      input.updateStage('auditing');
      auditing = true;
      corrections = [];
      let audit = await auditSynthesis(
        input.content,
        draft,
        plan,
        dossier,
        generate,
        services.auditorModel,
        input.signal,
        services.seed,
        (correction) => corrections.push(correction),
      );
      revisionAudit = audit;
      const draftUnits = splitAuditUnits(draft);
      for (const unit of draftUnits) {
        const verdict = audit.units.find((a) => a.unitId === unit.id);
        const key = stripPassageCitations(unit.text).toLowerCase();
        if (verdict?.verdict === 'contradicted') rejectedTexts.add(key);
        if (verdict && rejectedTexts.has(key)) verdict.verdict = 'contradicted';
      }
      if (
        accepted?.units.some((unit) =>
          rejectedTexts.has(stripPassageCitations(unit.text).toLowerCase()),
        )
      ) {
        // A newly established contradiction also invalidates an earlier accepted draft.
        accepted = undefined;
      }
      services.options.observe?.({
        kind: 'audit',
        answer: draft,
        units: splitAuditUnits(draft),
        audit,
        valid: true,
      });
      const compiled = compileAuditedAnswer(
        splitAuditSegments(draft),
        audit,
        false,
        true,
      );
      // Compare only retained, audited content; never reward rejected claims.
      if (compiled.retainedUnitCount) {
        const retained = new Set(compiled.units.map((u) => u.id));
        audit = deriveAnswerAudit(
          { units: audit.units.filter((u) => retained.has(u.unitId)) },
          plan.axes,
          plan.axes.map((axis) => ({
            axis,
            passageIds: dossier.passages.map((p) => p.id),
          })),
        );
        const coverage = requiredAxesCovered(plan.axes, audit);
        const previousCoverage = lastAudit
          ? requiredAxesCovered(plan.axes, lastAudit)
          : 0;
        if (
          !accepted ||
          coverage > previousCoverage ||
          (coverage === previousCoverage &&
            (compiled.retainedUnitCount > accepted.retainedUnitCount ||
              (compiled.retainedUnitCount === accepted.retainedUnitCount &&
                compiled.rejectedUnitCount < accepted.rejectedUnitCount)))
        ) {
          accepted = compiled;
          lastAudit = audit;
        }
      } else if (!accepted) lastAudit = audit;
      if (
        accepted &&
        !accepted.rejectedUnitCount &&
        lastAudit &&
        requiredAxesCovered(plan.axes, lastAudit) === plan.axes.length
      )
        break;
    } catch (error) {
      if (input.signal.aborted) throw error;
      // Keep stable technical codes, never raw model output or exception payloads.
      failureCode =
        auditing &&
        (error instanceof SyntaxError ||
          (error instanceof Error && error.name === 'ZodError'))
          ? 'SYNTHESIS_INVALID_AUDIT'
          : error instanceof Error &&
              /^(?:OLLAMA_|MODEL_OUTPUT_|MODEL_ANSWER_|MODEL_CALL_|AUDIT_)[A-Z0-9_]{1,64}$/u.test(
                error.message,
              )
            ? error.message
            : 'SYNTHESIS_UNEXPECTED_FAILURE';
      services.options.observe?.({
        kind: 'failure',
        failure: {
          stage: auditing ? 'auditing' : 'writing',
          attempt: attempt + 1,
          code: failureCode,
        },
      });
      if (auditing)
        services.options.observe?.({
          kind: 'audit',
          answer: draft,
          units: splitAuditUnits(draft),
          valid: false,
        });
      break;
    }
  }
  if (!accepted?.passageIds.length || !lastAudit)
    return {
      ...resultBase(),
      markdown:
        'La vérification n’a pas confirmé une synthèse fiable. Je préfère signaler cette limite plutôt que transformer les extraits en réponse.',
      fallbackCode: failureCode ?? 'SYNTHESIS_NOT_VERIFIED',
    };
  const covered = requiredAxesCovered(plan.axes, lastAudit);
  const complete = !accepted.rejectedUnitCount && covered === plan.axes.length;
  const ids = new Set(accepted.units.map((u) => u.id));
  services.options.observe?.({
    kind: 'publication',
    answer: accepted.markdown,
    units: accepted.units,
    audit: {
      ...lastAudit,
      units: lastAudit.units.filter((u) => ids.has(u.unitId)),
    },
    valid: true,
  });
  input.updateStage('finalizing');
  const notice = complete
    ? ''
    : '\n\n_Certains points de la demande restent insuffisamment établis par les sources._';
  const resolved = resolveAnswer(
    accepted.markdown + notice + highRiskNotice(originalQuestion),
    dossier,
  );
  // Preserve the S identifiers visible in this answer for the next turn.
  const orderedSources = [...dossier.sources].sort((a, b) => {
    const position = (url: string) => {
      const index = resolved.sources.findIndex((s) => s.url === url);
      return index < 0 ? 99 : index;
    };
    return position(a.url) - position(b.url);
  });
  const sourceIds = new Map(orderedSources.map((s, i) => [s.id, `S${i + 1}`]));
  return {
    ...resultBase(),
    ...resolved,
    researchMemory: {
      sources: orderedSources.map((s) => ({
        ...s,
        id: sourceIds.get(s.id)!,
      })),
      passages: dossier.passages.map((p) => ({
        ...p,
        sourceId: sourceIds.get(p.sourceId)!,
      })),
    },
    status: complete ? 'verified' : 'partial',
    coveredAxisCount: covered,
    rejectedUnitCount: accepted.rejectedUnitCount,
    fallbackCode: complete ? null : 'PARTIAL_SYNTHESIS',
  };
}
