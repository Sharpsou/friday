import type {
  AnswerAudit,
  AnswerAxis,
  AuditUnit,
  EvidencePassage,
} from './contracts.js';

const PASSAGE_CITATION = /\[(P[1-9]\d*)\]/gu;
const PASSAGE_GROUP = /[[(]\s*(P[1-9]\d*(?:\s*[,;]\s*P[1-9]\d*)*)\s*[\])]/giu;
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

export function stripPassageCitations(markdown: string): string {
  return markdown
    .replace(PASSAGE_GROUP, '')
    .replace(/\s+([,.;:!?])/gu, '$1')
    .replace(/[ \t]{2,}/gu, ' ')
    .trim();
}

export interface AuditSegment {
  unit: AuditUnit;
  prefix: string;
}

function splitIndependentClauses(value: string): string[] {
  return value
    .split(/(?<=[.!?])\s+|\s*[;]\s+(?=[A-ZÀ-ÖØ-Þ0-9])/u)
    .map((text) => text.trim())
    .filter(Boolean);
}

export function splitAuditSegments(markdown: string): AuditSegment[] {
  const blocks = markdown
    .trim()
    .split(/\n+/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const pending = blocks.flatMap((block) => {
    const prefix = block.match(/^(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)/u)?.[0] ?? '';
    const normalized = block.slice(prefix.length).trim();
    if (!normalized) return [];
    const clauses = prefix.startsWith('#')
      ? [normalized]
      : splitIndependentClauses(normalized);
    return clauses.map((text) => ({ prefix, text }));
  });
  return pending.slice(0, 100).map(({ prefix, text }, index) => ({
    prefix,
    unit: {
      id: `U${(index + 1).toString()}` as AuditUnit['id'],
      text,
      citedPassageIds: citedPassageIds(text),
    },
  }));
}

export function splitAuditUnits(markdown: string): AuditUnit[] {
  return splitAuditSegments(markdown).map(({ unit }) => unit);
}

export function decideEvaluation(
  audit: AnswerAudit,
  state: {
    revisionUsed: boolean;
    researchUsed: boolean;
    finalAudit: boolean;
    requiredAxisIds?: string[];
  },
): EvaluationDecision {
  const rejected = audit.units.some(
    ({ verdict }) => verdict === 'unsupported' || verdict === 'contradicted',
  );
  const requiredAxisIds = new Set(
    state.requiredAxisIds ?? audit.axes.map(({ axisId }) => axisId),
  );
  const missingAxis = audit.axes.some(
    ({ axisId, coverage }) =>
      requiredAxisIds.has(axisId) && coverage !== 'covered',
  );
  if (
    !rejected &&
    !missingAxis &&
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

export interface CompiledAuditAnswer {
  markdown: string;
  passageIds: EvidencePassage['id'][];
  retainedUnitCount: number;
  rejectedUnitCount: number;
}

export function compileAuditedAnswer(
  segments: AuditSegment[],
  audit: AnswerAudit,
  partial: boolean,
): CompiledAuditAnswer {
  const verdicts = new Map(audit.units.map((unit) => [unit.unitId, unit]));
  const passageIds: EvidencePassage['id'][] = [];
  const retained: string[] = [];
  for (const segment of segments) {
    const result = verdicts.get(segment.unit.id);
    if (!result || !['supported', 'not_factual'].includes(result.verdict))
      continue;
    const text = stripPassageCitations(segment.unit.text);
    if (!text) continue;
    const citations =
      result.verdict === 'supported'
        ? result.passageIds.map((id) => `[${id}]`).join(' ')
        : '';
    passageIds.push(...result.passageIds);
    retained.push(
      `${segment.prefix}${text}${citations ? ` ${citations}` : ''}`,
    );
  }
  const rejectedUnitCount = segments.length - retained.length;
  const missingAxes = audit.axes
    .filter(({ coverage }) => coverage !== 'covered')
    .map(({ axisId }) => axisId);
  const notice = partial
    ? `_Réponse partielle : ${rejectedUnitCount.toString()} élément(s) insuffisamment étayé(s) ont été retirés${missingAxes.length ? ` ; axes encore incomplets : ${missingAxes.join(', ')}` : ''}._`
    : '';
  return {
    markdown: [...retained, ...(notice ? [notice] : [])].join('\n\n'),
    passageIds: [...new Set(passageIds)],
    retainedUnitCount: retained.length,
    rejectedUnitCount,
  };
}

export function requiredAxesCovered(
  axes: AnswerAxis[],
  audit: AnswerAudit,
): number {
  const covered = new Set(
    audit.axes
      .filter(({ coverage }) => coverage === 'covered')
      .map(({ axisId }) => axisId),
  );
  return axes.filter(
    ({ importance, id }) => importance === 'required' && covered.has(id),
  ).length;
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
