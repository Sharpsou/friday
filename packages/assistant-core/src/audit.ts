import type {
  AnswerAudit,
  AnswerAxis,
  AuditUnit,
  EvidencePassage,
  UnitAuditOutput,
} from './contracts.js';
import type { AxisEvidence } from './axes.js';

const PASSAGE_CITATION = /\[(P[1-9]\d*)\]/gu;
const PASSAGE_GROUP = /[[(]\s*(P[1-9]\d*(?:\s*[,;]\s*P[1-9]\d*)*)\s*[\])]/giu;
export type EvaluationDecision = 'pass' | 'revise' | 'research' | 'partial';
export type FunctionalOutcome =
  'answered' | 'partial' | 'abstained' | 'audit_error';

export function validateUnitAuditReferences(
  output: UnitAuditOutput,
  units: AuditUnit[],
  passages: EvidencePassage[],
  axes: AnswerAxis[] = [],
): UnitAuditOutput {
  const unitIds = new Set(units.map(({ id }) => id));
  const passageIds = new Set(passages.map(({ id }) => id));
  const axisIds = new Set(axes.map(({ id }) => id));
  const normalized = new Map<
    AuditUnit['id'],
    UnitAuditOutput['units'][number]
  >();
  for (const unit of output.units) {
    if (!unitIds.has(unit.unitId) || normalized.has(unit.unitId)) continue;
    let validPassageIds = [
      ...new Set(unit.passageIds.filter((id) => passageIds.has(id))),
    ];
    let verdict = unit.verdict;
    if (verdict === 'not_factual') validPassageIds = [];
    if (
      (verdict === 'supported' || verdict === 'contradicted') &&
      validPassageIds.length === 0
    )
      verdict = 'unsupported';
    normalized.set(unit.unitId, {
      ...unit,
      verdict,
      passageIds: validPassageIds,
      addressedAxisIds: [
        ...new Set(
          (unit.addressedAxisIds ?? []).filter((axisId) => axisIds.has(axisId)),
        ),
      ],
    });
  }
  return {
    units: units.map(({ id }) => {
      return (
        normalized.get(id) ?? {
          unitId: id,
          verdict: 'unsupported',
          passageIds: [],
          addressedAxisIds: [],
        }
      );
    }),
  };
}

export function deriveAnswerAudit(
  output: UnitAuditOutput,
  axes: AnswerAxis[] = [],
  assignments: AxisEvidence[] = [],
): AnswerAudit {
  const supportedUnits = output.units.filter(
    ({ verdict }) => verdict === 'supported',
  );
  const assignedByAxis = new Map(
    assignments.map(({ axis, passageIds }) => [axis.id, passageIds]),
  );
  const auditAxes = axes.map((axis) => {
    const assigned = new Set(assignedByAxis.get(axis.id) ?? []);
    const addressingUnits = supportedUnits.filter(({ addressedAxisIds }) =>
      addressedAxisIds?.includes(axis.id),
    );
    const passageIds = [
      ...new Set(
        addressingUnits
          .flatMap(({ passageIds: ids }) => ids)
          .filter((id) => assigned.has(id)),
      ),
    ];
    return {
      axisId: axis.id,
      coverage:
        passageIds.length === 0 ? ('missing' as const) : ('covered' as const),
      passageIds,
    };
  });
  const missing = axes.filter(
    ({ id }) =>
      auditAxes.find(({ axisId }) => axisId === id)?.coverage !== 'covered',
  );
  const retained = output.units.filter(({ verdict }) =>
    ['supported', 'not_factual'].includes(verdict),
  ).length;
  const evidenceSufficiency = missing.some(
    ({ id }) => (assignedByAxis.get(id) ?? []).length === 0,
  )
    ? ('insufficient' as const)
    : ('sufficient' as const);
  return {
    units: output.units,
    axes: auditAxes,
    usefulness:
      retained === 0 ? 'misses' : missing.length === 0 ? 'answers' : 'partial',
    missingAspects: missing.map(({ label }) => label),
    evidenceSufficiency,
  };
}

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
    .replace(/(\[P[1-9]\d*\])\s*[,;]\s*(?=\[P[1-9]\d*\])/gu, '$1 ')
    .replace(PASSAGE_GROUP, '')
    .replace(/\s+([,.;:!?])/gu, '$1')
    .replace(/[ \t]{2,}/gu, ' ')
    .trim();
}

export interface AuditSegment {
  unit: AuditUnit;
  prefix: string;
  blockIndex?: number;
  separatorBefore?: string;
}

function splitIndependentClauses(value: string): string[] {
  return value
    .split(
      /(?<=[.!?])\s+(?!\[P[1-9])|(?<=\])\s+(?=[A-ZÀ-ÖØ-Þ])|\s*[;]\s+(?=[A-ZÀ-ÖØ-Þ0-9])/u,
    )
    .map((text) => text.trim())
    .filter(Boolean);
}

export function splitAuditSegments(markdown: string): AuditSegment[] {
  const lines = [...markdown.trim().matchAll(/([^\n]+)(\n*)/gu)];
  const pending = lines.flatMap((match, blockIndex) => {
    const block = match[1]!.trim();
    const prefix = block.match(/^(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)/u)?.[0] ?? '';
    const normalized = block.slice(prefix.length).trim();
    if (!normalized) return [];
    const clauses = prefix.startsWith('#')
      ? [normalized]
      : splitIndependentClauses(normalized);
    return clauses.map((text) => ({
      prefix,
      text,
      blockIndex,
      separatorBefore: blockIndex ? lines[blockIndex - 1]![2] || '\n' : '',
    }));
  });
  if (pending.length > 100) throw new Error('MODEL_ANSWER_TOO_MANY_UNITS');
  return pending.map(
    ({ prefix, text, blockIndex, separatorBefore }, index) => ({
      prefix,
      blockIndex,
      separatorBefore,
      unit: {
        id: `U${(index + 1).toString()}` as AuditUnit['id'],
        text,
        citedPassageIds: citedPassageIds(text),
      },
    }),
  );
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
  units: AuditUnit[];
  rejectedUnitCount: number;
}

export function compileAuditedAnswer(
  segments: AuditSegment[],
  audit: AnswerAudit,
  partial: boolean,
  wholeParagraphs = false,
): CompiledAuditAnswer {
  const verdicts = new Map(audit.units.map((unit) => [unit.unitId, unit]));
  const units: AuditUnit[] = [];
  const unitBlocks = new Map<string, number>();
  const blocks = new Map<
    number,
    { prefix: string; separator: string; texts: string[] }
  >();
  const rejectedBlocks = new Set(
    segments
      .filter(
        (s) =>
          !['supported', 'not_factual'].includes(
            verdicts.get(s.unit.id)?.verdict ?? '',
          ),
      )
      .map((s) => s.blockIndex)
      .filter((id) => id !== undefined),
  );
  for (const segment of segments) {
    if (
      wholeParagraphs &&
      segment.blockIndex !== undefined &&
      rejectedBlocks.has(segment.blockIndex)
    )
      continue;
    const result = verdicts.get(segment.unit.id);
    if (!result || !['supported', 'not_factual'].includes(result.verdict))
      continue;
    const text = stripPassageCitations(segment.unit.text);
    if (!text) continue;
    const citations =
      result.verdict === 'supported'
        ? result.passageIds.map((id) => `[${id}]`).join(' ')
        : '';
    const rendered = `${text}${citations ? ` ${citations}` : ''}`;
    units.push({
      ...segment.unit,
      text: rendered,
      citedPassageIds: result.verdict === 'supported' ? result.passageIds : [],
    });
    const blockId = segment.blockIndex ?? blocks.size;
    unitBlocks.set(segment.unit.id, blockId);
    let block = blocks.get(blockId);
    if (!block) {
      block = {
        prefix: segment.prefix,
        separator: segment.separatorBefore ?? '\n\n',
        texts: [],
      };
      blocks.set(blockId, block);
    }
    block.texts.push(rendered);
  }
  const visibleEntries = [...blocks.entries()].filter(
    ([, block], index, all) =>
      !block.prefix.startsWith('#') ||
      (all[index + 1] && !all[index + 1]![1].prefix.startsWith('#')),
  );
  const visibleIds = new Set(visibleEntries.map(([id]) => id));
  const publishedUnits = units.filter((unit) =>
    visibleIds.has(unitBlocks.get(unit.id)!),
  );
  const visibleBlocks = visibleEntries.map(([, block]) => block);
  const body = visibleBlocks
    .map(
      (block, index) =>
        `${index ? block.separator : ''}${block.prefix}${block.texts.join(' ')}`,
    )
    .join('');
  const rejectedUnitCount = segments.length - publishedUnits.length;
  const missingAxisCount = audit.axes.filter(
    ({ coverage }) => coverage !== 'covered',
  ).length;
  const partialDetails = [
    ...(rejectedUnitCount
      ? [
          `${rejectedUnitCount.toString()} élément(s) insuffisamment étayé(s) ont été retirés`,
        ]
      : []),
    ...(missingAxisCount ? ['certains besoins restent incomplets'] : []),
  ];
  const notice = partial
    ? `_Réponse partielle${partialDetails.length ? ` : ${partialDetails.join(' ; ')}` : ''}._`
    : '';
  return {
    markdown: body + (notice ? `\n\n${notice}` : ''),
    passageIds: [
      ...new Set(publishedUnits.flatMap((unit) => unit.citedPassageIds)),
    ],
    retainedUnitCount: publishedUnits.length,
    units: publishedUnits,
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
  return axes.filter(({ id }) => covered.has(id)).length;
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
