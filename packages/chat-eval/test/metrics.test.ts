import { describe, expect, it } from 'vitest';

import { assessReleaseGate, computeAutomatedMetrics } from '../src/metrics.js';

describe('separate grounding metrics', () => {
  it('does not collapse support, contradiction and citations into one score', () => {
    const metrics = computeAutomatedMetrics(
      'Un [P1]. Deux [P2].',
      [
        { id: 'U1', text: 'Un [P1].', citedPassageIds: ['P1'] },
        { id: 'U2', text: 'Deux [P2].', citedPassageIds: ['P2'] },
      ],
      {
        axes: [],
        units: [
          { unitId: 'U1', verdict: 'supported', passageIds: ['P1'] },
          { unitId: 'U2', verdict: 'contradicted', passageIds: ['P1'] },
        ],
        usefulness: 'partial',
        missingAspects: [],
        evidenceSufficiency: 'sufficient',
      },
    );
    expect(metrics.supportedUnitRate).toBe(0.5);
    expect(metrics.contradictedUnitRate).toBe(0.5);
    expect(metrics.citationPrecision).toBe(0.5);
    expect(metrics.citationCompleteness).toBe(1);
  });

  it('derives the release gate from fixed independent thresholds', () => {
    const assessment = assessReleaseGate({
      automated: [
        {
          factualUnitCount: 10,
          supportedUnitRate: 0.9,
          contradictedUnitRate: 0,
          citationPrecision: 1,
          citationCompleteness: 1,
          usefulness: 'answers',
          evidenceSufficiency: 'sufficient',
          emptyAnswer: false,
          outcome: 'answered',
        },
      ],
      human: [
        {
          expectedAspectsCovered: 8,
          expectedAspectsTotal: 10,
          usefulness: 4,
          writingQuality: 4,
          importantContradiction: false,
          catastrophicFailure: false,
        },
      ],
      hostileCorpusPassed: true,
    });
    expect(assessment).toMatchObject({ passed: true, failures: [] });
    expect(
      assessReleaseGate({
        automated: [],
        human: [],
        hostileCorpusPassed: false,
      }).passed,
    ).toBe(false);
  });
});
