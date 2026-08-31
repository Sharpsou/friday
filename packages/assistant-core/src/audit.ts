import type { AnswerAudit, AuditUnit, EvidencePassage } from './contracts.js';

const PASSAGE_CITATION = /\[(P[1-9]\d*)\]/gu;
export type EvaluationDecision = 'pass' | 'revise' | 'research' | 'partial';
export type FunctionalOutcome =
  'answered' | 'partial' | 'abstained' | 'audit_error';

export function citedPassageIds(markdown: string): EvidencePassage['id'][] {
  return [
    ...new Set(
      [...markdown.matchAll(PASSAGE_CITATION)].map(
        (match) => match[1] as EvidencePassage['id'],
      ),
    ),
  ];
}

export function splitAuditUnits(markdown: string): AuditUnit[] {
  const blocks = markdown
    .trim()
    .split(/\n+/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const fragments = blocks.flatMap((block) => {
    const normalized = block
      .replace(/^[-*+]\s+/u, '')
      .replace(/^#{1,6}\s+/u, '');
    if (!normalized) return [];
    return normalized
      .split(/(?<=[.!?])\s+/u)
      .map((text) => text.trim())
      .filter(Boolean);
  });
  return fragments.slice(0, 100).map((text, index) => ({
    id: `U${(index + 1).toString()}` as AuditUnit['id'],
    text,
    citedPassageIds: citedPassageIds(text),
  }));
}

export function decideEvaluation(
  audit: AnswerAudit,
  state: { revisionUsed: boolean; researchUsed: boolean; finalAudit: boolean },
): EvaluationDecision {
  const rejected = audit.units.some(
    ({ verdict }) => verdict === 'unsupported' || verdict === 'contradicted',
  );
  if (
    !rejected &&
    audit.usefulness === 'answers' &&
    audit.missingAspects.length === 0
  )
    return 'pass';
  if (state.finalAudit) return 'partial';
  if (
    audit.evidenceSufficiency === 'insufficient' &&
    !state.researchUsed &&
    !state.revisionUsed
  )
    return 'research';
  if (
    audit.evidenceSufficiency === 'sufficient' &&
    !state.revisionUsed &&
    !state.researchUsed
  )
    return 'revise';
  return 'partial';
}

export function suppressUnsupportedUnits(
  units: AuditUnit[],
  audit: AnswerAudit,
): string {
  const verdicts = new Map(
    audit.units.map(({ unitId, verdict }) => [unitId, verdict]),
  );
  const retained = units
    .filter(({ id }) =>
      ['supported', 'not_factual'].includes(verdicts.get(id) ?? ''),
    )
    .map(({ text }) => text);
  const missing = audit.missingAspects.length
    ? ` Les preuves disponibles ne permettent pas de couvrir : ${audit.missingAspects.join('; ')}.`
    : '';
  if (retained.length === 0)
    return `Je ne peux pas fournir de réponse factuelle fiable avec les preuves disponibles.${missing}`;
  return `${retained.join('\n\n')}\n\n_Réponse partielle : certaines affirmations insuffisamment étayées ont été retirées._${missing}`;
}

export function functionalOutcome(
  answer: string,
  decision: EvaluationDecision,
  auditError = false,
): FunctionalOutcome {
  if (auditError) return 'audit_error';
  if (/^Je ne peux pas fournir/u.test(answer.trim())) return 'abstained';
  if (decision === 'partial') return 'partial';
  return 'answered';
}
