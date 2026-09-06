import { describe, expect, it } from 'vitest';
import {
  validProofs,
  auditSynthesis,
  sourceExcerptCatalog,
  prepareSynthesis,
  normalizeSynthesisCitations,
  synthesisPrompt,
} from '../src/synthesis.js';
import { fallbackAnswerPlan } from '../src/axes.js';
import { selectEvidencePassages } from '../src/passages.js';

const text =
  'Sans identité de confiance, un attaquant ne peut pas accéder aux sauvegardes.';
const dossier = selectEvidencePassages('sauvegardes', [
  {
    source: {
      id: 'S1',
      title: 'Sauvegardes',
      url: 'https://example.test',
      retrievedAt: '2026-09-05T00:00:00Z',
    },
    sections: [{ paragraphs: [text] }],
  },
]);
const plan = fallbackAnswerPlan('Explique les sauvegardes');
describe('source anchored synthesis', () => {
  it('keeps a prerequisite and its following instruction in one original excerpt', () => {
    const paragraph =
      'La restauration exige une sauvegarde validée. Activez ensuite le mode récupération.';
    const catalog = sourceExcerptCatalog([
      {
        ...dossier.passages[0]!,
        text: paragraph + '\nUn autre paragraphe indépendant.',
      },
    ]);
    expect(catalog[0]!.excerpts.map((e) => e.text)).toEqual([
      paragraph,
      'Un autre paragraphe indépendant.',
    ]);
  });
  it('transmits every selected original once with source identity and conditions, without a model summary', () => {
    const brief = prepareSynthesis(plan, dossier);
    expect(brief.originals).toEqual(sourceExcerptCatalog(dossier.passages));
    expect(brief.originals[0]?.sourceId).toBe('S1');
    expect(brief.sources).toEqual(dossier.sources);
    const prompt = synthesisPrompt('Explique les sauvegardes', plan, brief);
    expect(prompt.split(text)).toHaveLength(2);
    expect(prompt).toContain('Sans identité de confiance');
  });
  it('keeps the dossier even when a need has no retrieval match, without declaring facts missing', () => {
    const brief = prepareSynthesis(plan, {
      ...dossier,
      diagnostics: { ...dossier.diagnostics, queries: [], queryPassageIds: [] },
    });
    expect(brief.needs[0]?.passageIds).toEqual([]);
    expect(brief.originals).toHaveLength(1);
  });
  it('audits references in the full answer context and forwards a precise correction', async () => {
    const corrections: unknown[] = [];
    const answer = 'Sans identité de confiance, l’accès est possible. [P1]';
    const audit = await auditSynthesis(
      'Sauvegardes',
      answer,
      plan,
      dossier,
      async (request) => {
        expect(request.prompt).toContain(
          `REPONSE_COMPLETE_NON_FIABLE=${JSON.stringify(answer)}`,
        );
        return JSON.stringify({
          units: [
            {
              unitId: 'U1',
              verdict: 'contradicted',
              evidence: [{ passageId: 'P1', quoteId: 'P1.Q1' }],
              addressedAxisIds: ['A1'],
              reason: 'La négation de la condition d’accès a été inversée.',
            },
          ],
        });
      },
      'test',
      new AbortController().signal,
      17,
      (correction) => corrections.push(correction),
    );
    expect(audit.units[0]?.verdict).toBe('contradicted');
    expect(corrections).toEqual([
      {
        unitId: 'U1',
        text: expect.any(String),
        passageIds: ['P1'],
        reason: 'La négation de la condition d’accès a été inversée.',
      },
    ]);
  });
  it('resolves known paragraph citations and preserves prose while refusing unknown paragraphs', () => {
    const brief = prepareSynthesis(plan, dossier);
    expect(
      normalizeSynthesisCitations(
        'Condition exacte [P1.Q1, P1]. Suite [P1.Q1].',
        brief,
      ),
    ).toBe('Condition exacte [P1]. Suite [P1].');
    expect(() => normalizeSynthesisCitations('Fait [P1.Q999].', brief)).toThrow(
      'MODEL_OUTPUT_UNKNOWN_EXCERPT',
    );
    expect(() => normalizeSynthesisCitations('Fait [P99.Q1].', brief)).toThrow(
      'MODEL_OUTPUT_UNKNOWN_EXCERPT',
    );
  });
  it('materializes original quotes from identifiers and refuses identifiers from another passage', async () => {
    const catalog = sourceExcerptCatalog(dossier.passages);
    expect(catalog[0]?.excerpts[0]?.text).toBe(text);
    for (const [passageId, verdict] of [
      ['P1', 'supported'],
      ['P2', 'unsupported'],
    ] as const) {
      const audit = await auditSynthesis(
        'Explique les sauvegardes',
        text + ' [P1]',
        plan,
        dossier,
        async () =>
          JSON.stringify({
            units: [
              {
                unitId: 'U1',
                verdict: 'supported',
                evidence: [{ passageId, quoteId: 'P1.Q1' }],
                addressedAxisIds: ['A1'],
                reason: 'Même condition.',
              },
            ],
          }),
        'test',
        new AbortController().signal,
        17,
      );
      expect(audit.units[0]?.verdict).toBe(verdict);
    }
  });
  it('bounds a verbose diagnostic without dropping a valid contradiction', async () => {
    const corrections: Array<{ reason: string }> = [];
    const audit = await auditSynthesis(
      'Sauvegardes',
      'Accès autorisé [P1].',
      plan,
      dossier,
      async () =>
        JSON.stringify({
          units: [
            {
              unitId: 'U1',
              verdict: 'contradicted',
              evidence: [{ passageId: 'P1', quoteId: 'P1.Q1' }],
              addressedAxisIds: ['A1'],
              reason: 'La condition est inversée. '.repeat(40),
            },
          ],
        }),
      'test',
      new AbortController().signal,
      17,
      (correction) => corrections.push(correction),
    );
    expect(audit.units[0]?.verdict).toBe('contradicted');
    expect(corrections[0]?.reason.length).toBeLessThanOrEqual(400);
  });

  it('normalizes typography without accepting a changed negation', () => {
    const passages = [
      {
        ...dossier.passages[0]!,
        text: 'L’accès n’est pas autorisé sans identité.',
      },
    ];
    expect(
      validProofs(
        [
          {
            passageId: 'P1',
            quote: "L'accès n'est pas autorisé sans identité.",
          },
        ],
        passages,
      ),
    ).toHaveLength(1);
    expect(
      validProofs(
        [{ passageId: 'P1', quote: "L'accès est autorisé sans identité." }],
        passages,
      ),
    ).toEqual([]);
  });
  it('rejects invented and unknown proof references', () => {
    expect(
      validProofs(
        [
          {
            passageId: 'P1',
            quote: 'Un attaquant peut accéder aux sauvegardes.',
          },
          { passageId: 'P2', quote: text },
        ],
        dossier.passages,
      ),
    ).toEqual([]);
  });
  it('does not accept a supported verdict with a fabricated quote', async () => {
    const audit = await auditSynthesis(
      'Sauvegardes',
      'Un attaquant peut accéder aux sauvegardes. [P1]',
      plan,
      dossier,
      async () =>
        JSON.stringify({
          units: [
            {
              unitId: 'U1',
              verdict: 'supported',
              evidence: [
                {
                  passageId: 'P1',
                  quote: 'Un attaquant peut accéder aux sauvegardes.',
                },
              ],
              addressedAxisIds: ['A1'],
              reason: 'Erreur du modèle.',
            },
          ],
        }),
      'test',
      new AbortController().signal,
      17,
    );
    expect(audit.units[0]?.verdict).toBe('unsupported');
    expect(audit.axes[0]?.coverage).toBe('missing');
  });
});
