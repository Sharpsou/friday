import { describe, expect, it } from 'vitest';

import {
  compileAuditedAnswer,
  decideEvaluation,
  deriveAnswerAudit,
  fallbackAnswerPlan,
  parseAnswerPlan,
  searchQueriesForPlan,
  splitAuditSegments,
  validateUnitAuditReferences,
  validateAuditReferences,
  type AnswerAudit,
} from '../src/index.js';

describe('answer axes and recoverable audits', () => {
  it('restores up to six distinct queries for deep Web research', () => {
    const plan = parseAnswerPlan(
      JSON.stringify({
        intent: 'recent',
        axes: Array.from({ length: 5 }, (_, index) => ({
          id: `A${(index + 1).toString()}`,
          label: `Axe ${(index + 1).toString()}`,
          question: `Quelle est la dimension ${(index + 1).toString()} ?`,
          importance: index < 2 ? 'required' : 'useful',
          query: `requête distincte ${(index + 1).toString()}`,
        })),
      }),
      'Quelles sont les découvertes récentes ?',
    );
    expect(
      searchQueriesForPlan('Quelles sont les découvertes récentes ?', plan),
    ).toHaveLength(6);
  });

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

  it('derives axis coverage and revision need in code from approved passages', () => {
    const axes = [
      {
        id: 'A1' as const,
        label: 'Mesure',
        question: 'Quelle mesure ?',
        importance: 'required' as const,
        query: 'mesure',
      },
      {
        id: 'A2' as const,
        label: 'Limites',
        question: 'Quelles limites ?',
        importance: 'required' as const,
        query: 'limites',
      },
    ];
    const audit = deriveAnswerAudit(
      {
        units: [{ unitId: 'U1', verdict: 'supported', passageIds: ['P1'] }],
      },
      axes,
      [
        { axis: axes[0]!, passageIds: ['P1'] },
        { axis: axes[1]!, passageIds: ['P2'] },
      ],
    );
    expect(audit).toMatchObject({
      usefulness: 'partial',
      missingAspects: ['Limites'],
      evidenceSufficiency: 'sufficient',
      axes: [
        { axisId: 'A1', coverage: 'covered', passageIds: ['P1'] },
        { axisId: 'A2', coverage: 'missing', passageIds: [] },
      ],
    });
    expect(
      decideEvaluation(audit, {
        revisionUsed: false,
        researchUsed: false,
        finalAudit: false,
        requiredAxisIds: ['A1', 'A2'],
      }),
    ).toBe('revise');
  });

  it('requests research only when a required axis has no selected evidence', () => {
    const axis = {
      id: 'A1' as const,
      label: 'Limites',
      question: 'Quelles limites ?',
      importance: 'required' as const,
      query: 'limites',
    };
    const audit = deriveAnswerAudit(
      {
        units: [{ unitId: 'U1', verdict: 'not_factual', passageIds: [] }],
      },
      [axis],
      [{ axis, passageIds: [] }],
    );
    expect(audit.evidenceSufficiency).toBe('insufficient');
    expect(
      decideEvaluation(audit, {
        revisionUsed: false,
        researchUsed: false,
        finalAudit: false,
        requiredAxisIds: ['A1'],
      }),
    ).toBe('research');
  });

  it('rejects incomplete or invented model audit identifiers', () => {
    const units = splitAuditSegments(
      'Premier fait [P1]. Second fait [P1].',
    ).map(({ unit }) => unit);
    expect(() =>
      validateUnitAuditReferences(
        {
          units: [{ unitId: 'U99', verdict: 'supported', passageIds: ['P1'] }],
        },
        units,
        [{ id: 'P1', sourceId: 'S1', text: 'Preuve.' }],
      ),
    ).toThrow('AUDIT_UNKNOWN_UNIT');
  });
});
