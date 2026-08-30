import type { AnswerAudit, AuditUnit, EvidencePassage } from './contracts.js';

const PASSAGE_CITATION = /\[(P[1-9]\d*)\]/gu;

export type EvaluationDecision = 'pass' | 'revise' | 'research' | 'partial';

export interface DecisionState {
  revisionUsed: boolean;
  researchUsed: boolean;
  finalAudit: boolean;
}

export function citedPassageIds(markdown: string): EvidencePassage['id'][] {
  const ids: EvidencePassage['id'][] = [];
  const seen = new Set<string>();
  for (const match of markdown.matchAll(PASSAGE_CITATION)) {
    const id = match[1] as EvidencePassage['id'];
    if (!seen.has(id)) {
      ids.push(id);
      seen.add(id);
    }
  }
  return ids;
}

export function splitAuditUnits(markdown: string): AuditUnit[] {
  return markdown
    .trim()
    .split(/(?<=[.!?])\s+|\n{2,}/u)
    .map((text) => text.trim())
    .filter(Boolean)
    .slice(0, 100)
    .map((text, index) => ({
      id: `U${(index + 1).toString()}` as AuditUnit['id'],
      text,
      citedPassageIds: citedPassageIds(text),
    }));
}

export function decideEvaluation(
  audit: AnswerAudit,
  state: DecisionState,
): EvaluationDecision {
  const hasUnsupportedClaim = audit.units.some(({ verdict }) =>
    ['unsupported', 'contradicted'].includes(verdict),
  );
  const complete =
    !hasUnsupportedClaim &&
    audit.usefulness === 'answers' &&
    audit.missingAspects.length === 0;
  if (complete) return 'pass';
  if (state.finalAudit) return 'partial';
  if (audit.evidenceSufficiency === 'insufficient' && !state.researchUsed) {
    return 'research';
  }
  if (audit.evidenceSufficiency === 'sufficient' && !state.revisionUsed) {
    return 'revise';
  }
  return 'partial';
}

export function suppressUnsupportedUnits(
  units: AuditUnit[],
  audit: AnswerAudit,
): string {
  const verdictByUnit = new Map(
    audit.units.map(({ unitId, verdict }) => [unitId, verdict]),
  );
  const retained = units
    .filter((unit) => {
      const verdict = verdictByUnit.get(unit.id);
      return verdict === 'supported' || verdict === 'not_factual';
    })
    .map(({ text }) => text);
  const missing = audit.missingAspects.length
    ? ` Les preuves disponibles ne permettent pas de couvrir : ${audit.missingAspects.join('; ')}.`
    : '';
  if (retained.length === 0) {
    return `Je ne peux pas fournir de réponse factuelle fiable avec les preuves disponibles.${missing}`;
  }
  return `${retained.join('\n\n')}\n\n_Réponse partielle : certaines affirmations insuffisamment étayées ont été retirées._${missing}`;
}
