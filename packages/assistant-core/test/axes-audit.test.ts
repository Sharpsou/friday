import { describe, expect, it } from 'vitest';

import {
  compileAuditedAnswer,
  fallbackAnswerPlan,
  parseAnswerPlan,
  splitAuditSegments,
  validateAuditReferences,
  type AnswerAudit,
} from '../src/index.js';

describe('answer axes and recoverable audits', () => {
  it('falls back to one required fact-free axis when planning JSON is invalid', () => {
    expect(parseAnswerPlan('{broken', 'Pourquoi le ciel est bleu ?')).toEqual(
      fallbackAnswerPlan('Pourquoi le ciel est bleu ?'),
    );
  });

  it('rejects semantic holes instead of silently rejecting or trusting units', () => {
    const units = splitAuditSegments('Fait un [P1]. Fait deux [P1].').map(
      ({ unit }) => unit,
    );
    expect(() =>
      validateAuditReferences(
        {
          axes: [],
          units: [{ unitId: 'U1', verdict: 'supported', passageIds: ['P1'] }],
          usefulness: 'answers',
          missingAspects: [],
          evidenceSufficiency: 'sufficient',
        },
        units,
        [{ id: 'P1', sourceId: 'S1', text: 'Preuve.' }],
      ),
    ).toThrow('AUDIT_INCOMPLETE_UNITS');
    expect(() =>
      validateAuditReferences(
        {
          axes: [],
          units: units.map(({ id }) => ({
            unitId: id,
            verdict: 'supported' as const,
            passageIds: [],
          })),
          usefulness: 'answers',
          missingAspects: [],
          evidenceSufficiency: 'sufficient',
        },
        units,
        [{ id: 'P1', sourceId: 'S1', text: 'Preuve.' }],
      ),
    ).toThrow('AUDIT_SUPPORTED_WITHOUT_PASSAGE');
  });

  it('keeps supported clauses and rebuilds citations from the audit', () => {
    const segments = splitAuditSegments(
      '- Proposition soutenue [P9] ; Proposition douteuse [P1].',
    );
    const audit: AnswerAudit = {
      axes: [{ axisId: 'A1', coverage: 'covered', passageIds: ['P2'] }],
      units: [
        { unitId: 'U1', verdict: 'supported', passageIds: ['P2'] },
        { unitId: 'U2', verdict: 'unsupported', passageIds: [] },
      ],
      usefulness: 'partial',
      missingAspects: [],
      evidenceSufficiency: 'sufficient',
    };
    const result = compileAuditedAnswer(segments, audit, true);
    expect(result.markdown).toContain('- Proposition soutenue [P2]');
    expect(result.markdown).not.toContain('P9');
    expect(result.markdown).not.toContain('Proposition douteuse');
    expect(result.rejectedUnitCount).toBe(1);
  });
});
