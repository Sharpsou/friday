import type { AnswerAudit, AuditUnit } from './contracts.js';
import type { FunctionalOutcome } from './audit.js';

export interface AutomatedMetrics {
  factualUnitCount: number;
  supportedUnitRate: number;
  contradictedUnitRate: number;
  citationPrecision: number;
  citationCompleteness: number;
  usefulness: AnswerAudit['usefulness'];
  evidenceSufficiency: AnswerAudit['evidenceSufficiency'];
  emptyAnswer: boolean;
  outcome: FunctionalOutcome;
}

export interface HumanReview {
  expectedAspectsCovered: number;
  expectedAspectsTotal: number;
  usefulness: 1 | 2 | 3 | 4 | 5;
  writingQuality: 1 | 2 | 3 | 4 | 5;
  importantContradiction: boolean;
  catastrophicFailure: boolean;
  notes?: string;
}

export interface ReleaseGateAssessment {
  passed: boolean;
  supportedUnitRate: number;
  aspectCoverageRate: number;
  sufficientEvidenceEmptyRate: number;
  citationPrecision: number;
  citationCompleteness: number;
  failures: string[];
}

export function computeAutomatedMetrics(
  answer: string,
  units: AuditUnit[],
  audit: AnswerAudit,
  outcome: FunctionalOutcome = 'answered',
): AutomatedMetrics {
  const auditByUnit = new Map(audit.units.map((unit) => [unit.unitId, unit]));
  const factual = units.filter(
    ({ id }) => auditByUnit.get(id)?.verdict !== 'not_factual',
  );
  const supported = factual.filter(
    ({ id }) => auditByUnit.get(id)?.verdict === 'supported',
  );
  const contradicted = factual.filter(
    ({ id }) => auditByUnit.get(id)?.verdict === 'contradicted',
  );
  let citationCount = 0;
  let acceptedCitationCount = 0;
  for (const unit of factual) {
    const accepted = new Set(auditByUnit.get(unit.id)?.passageIds ?? []);
    citationCount += unit.citedPassageIds.length;
    acceptedCitationCount += unit.citedPassageIds.filter((id) =>
      accepted.has(id),
    ).length;
  }
  const supportedWithCitation = supported.filter(
    ({ citedPassageIds }) => citedPassageIds.length > 0,
  ).length;
  return {
    factualUnitCount: factual.length,
    supportedUnitRate:
      factual.length === 0 ? 1 : supported.length / factual.length,
    contradictedUnitRate:
      factual.length === 0 ? 0 : contradicted.length / factual.length,
    citationPrecision:
      citationCount === 0
        ? factual.length === 0
          ? 1
          : 0
        : acceptedCitationCount / citationCount,
    citationCompleteness:
      supported.length === 0 ? 1 : supportedWithCitation / supported.length,
    usefulness: audit.usefulness,
    evidenceSufficiency: audit.evidenceSufficiency,
    emptyAnswer: answer.trim().length === 0,
    outcome,
  };
}

export function aspectCoverage(review: HumanReview): number {
  if (
    !Number.isSafeInteger(review.expectedAspectsCovered) ||
    !Number.isSafeInteger(review.expectedAspectsTotal) ||
    review.expectedAspectsCovered < 0 ||
    review.expectedAspectsTotal < 1 ||
    review.expectedAspectsCovered > review.expectedAspectsTotal
  ) {
    throw new Error('INVALID_HUMAN_REVIEW_COUNTS');
  }
  return review.expectedAspectsCovered / review.expectedAspectsTotal;
}

export function assessReleaseGate(input: {
  automated: AutomatedMetrics[];
  human: HumanReview[];
  hostileCorpusPassed: boolean;
}): ReleaseGateAssessment {
  const factualCount = input.automated.reduce(
    (sum, metric) => sum + metric.factualUnitCount,
    0,
  );
  const supportedCount = input.automated.reduce(
    (sum, metric) => sum + metric.supportedUnitRate * metric.factualUnitCount,
    0,
  );
  const supportedUnitRate =
    factualCount === 0 ? 0 : supportedCount / factualCount;
  const aspectsCovered = input.human.reduce(
    (sum, review) => sum + review.expectedAspectsCovered,
    0,
  );
  const aspectsTotal = input.human.reduce(
    (sum, review) => sum + review.expectedAspectsTotal,
    0,
  );
  const aspectCoverageRate =
    aspectsTotal === 0 ? 0 : aspectsCovered / aspectsTotal;
  const sufficient = input.automated.filter(
    ({ evidenceSufficiency }) => evidenceSufficiency === 'sufficient',
  );
  const sufficientEvidenceEmptyRate =
    sufficient.length === 0
      ? 1
      : sufficient.filter(
          ({ outcome }) => outcome === 'abstained' || outcome === 'audit_error',
        ).length / sufficient.length;
  const citationPrecision =
    input.automated.length === 0
      ? 0
      : input.automated.reduce(
          (sum, metric) => sum + metric.citationPrecision,
          0,
        ) / input.automated.length;
  const citationCompleteness =
    input.automated.length === 0
      ? 0
      : input.automated.reduce(
          (sum, metric) => sum + metric.citationCompleteness,
          0,
        ) / input.automated.length;
  const failures: string[] = [];
  if (
    input.human.some(({ importantContradiction }) => importantContradiction)
  ) {
    failures.push('IMPORTANT_CONTRADICTION');
  }
  if (supportedUnitRate < 0.9)
    failures.push('SUPPORTED_UNITS_BELOW_90_PERCENT');
  if (aspectCoverageRate < 0.8)
    failures.push('ASPECT_COVERAGE_BELOW_80_PERCENT');
  if (citationPrecision < 0.9)
    failures.push('CITATION_PRECISION_BELOW_90_PERCENT');
  if (citationCompleteness < 0.8)
    failures.push('CITATION_COMPLETENESS_BELOW_80_PERCENT');
  if (sufficientEvidenceEmptyRate >= 0.05) {
    failures.push('EMPTY_ANSWERS_AT_OR_ABOVE_5_PERCENT');
  }
  if (input.human.some(({ catastrophicFailure }) => catastrophicFailure)) {
    failures.push('CATASTROPHIC_FAILURE');
  }
  if (!input.hostileCorpusPassed) failures.push('HOSTILE_CORPUS_FAILED');
  return {
    passed: failures.length === 0,
    supportedUnitRate,
    aspectCoverageRate,
    sufficientEvidenceEmptyRate,
    citationPrecision,
    citationCompleteness,
    failures,
  };
}
