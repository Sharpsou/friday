import { describe, expect, it } from 'vitest';

import {
  decideEvaluation,
  splitAuditUnits,
  suppressUnsupportedUnits,
} from '../src/audit.js';
import { validateAuditReferences, type AnswerAudit } from '../src/contracts.js';

const audit: AnswerAudit = {
  units: [
    { unitId: 'U1', verdict: 'supported', passageIds: ['P1'] },
    { unitId: 'U2', verdict: 'unsupported', passageIds: [] },
  ],
  usefulness: 'partial',
  missingAspects: ['autonomie réelle'],
  evidenceSufficiency: 'sufficient',
};

describe('audit decisions', () => {
  it('splits and numbers units after drafting without inventing citations', () => {
    expect(splitAuditUnits('Fait un [P1]. Fait deux [P2] [P2].')).toEqual([
      { id: 'U1', text: 'Fait un [P1].', citedPassageIds: ['P1'] },
      { id: 'U2', text: 'Fait deux [P2] [P2].', citedPassageIds: ['P2'] },
    ]);
  });

  it('allows one revision then falls back to deterministic suppression', () => {
    expect(
      decideEvaluation(audit, {
        revisionUsed: false,
        researchUsed: false,
        finalAudit: false,
      }),
    ).toBe('revise');
    expect(
      decideEvaluation(audit, {
        revisionUsed: true,
        researchUsed: false,
        finalAudit: true,
      }),
    ).toBe('partial');

    const units = splitAuditUnits('Conservé [P1]. Retiré sans preuve.');
    const partial = suppressUnsupportedUnits(units, audit);
    expect(partial).toContain('Conservé [P1].');
    expect(partial).not.toContain('Retiré sans preuve.');
    expect(partial).toContain('autonomie réelle');
  });

  it('requests research once when evidence is insufficient', () => {
    expect(
      decideEvaluation(
        { ...audit, evidenceSufficiency: 'insufficient' },
        { revisionUsed: false, researchUsed: false, finalAudit: false },
      ),
    ).toBe('research');
  });

  it('marks an omitted audit unit unsupported instead of trusting it', () => {
    const units = splitAuditUnits('Fait soutenu [P1]. Second fait [P1].');
    const normalized = validateAuditReferences(
      {
        units: [{ unitId: 'U1', verdict: 'supported', passageIds: ['P1'] }],
        usefulness: 'answers',
        missingAspects: [],
        evidenceSufficiency: 'sufficient',
      },
      units,
      [{ id: 'P1', sourceId: 'S1', text: 'Deux faits vérifiables.' }],
    );
    expect(normalized.units[1]).toMatchObject({
      unitId: 'U2',
      verdict: 'unsupported',
      passageIds: [],
    });
  });
});
