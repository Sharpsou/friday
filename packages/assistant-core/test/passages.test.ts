import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PASSAGE_LIMITS,
  compileAuditedAnswer,
  splitAuditSegments,
  deriveAnswerAudit,
  UnitAuditJsonSchema,
  UnifiedUnitAuditJsonSchema,
  auditorPrompt,
  auditorRetryPrompt,
  selectEvidencePassagesHybrid,
  splitAuditUnits,
  type FrozenPage,
} from '../src/index.js';

describe('bounded audit output', () => {
  const units = [
    { id: 'U1' as const, text: 'Fait [P1].', citedPassageIds: ['P1' as const] },
  ];
  const passages = [
    { id: 'P1' as const, sourceId: 'S1' as const, text: 'Preuve du fait.' },
  ];

  it('keeps the structured response compact and makes the retry corrective', () => {
    expect(JSON.stringify(UnitAuditJsonSchema)).not.toContain('reason');
    expect(JSON.stringify(UnitAuditJsonSchema)).toContain('addressedAxisIds');
    expect(JSON.stringify(UnifiedUnitAuditJsonSchema)).not.toContain(
      'addressedAxisIds',
    );
    expect(JSON.stringify(UnitAuditJsonSchema)).not.toContain('missingAspects');
    const first = auditorPrompt({ question: 'Question ?', units, passages });
    const retry = auditorRetryPrompt({
      question: 'Question ?',
      units,
      passages,
      failureCode: 'AUDIT_UNKNOWN_PASSAGE',
    });
    expect(retry).not.toBe(first);
    expect(retry).toContain('AUDIT_UNKNOWN_PASSAGE');
    expect(retry).toContain('UNIT_IDS_AUTORISES=["U1"]');
    expect(retry).toContain('PASSAGE_IDS_AUTORISES=["P1"]');
    expect(first).not.toContain('addressedAxisIds');
  });
});

const pages: FrozenPage[] = [
  {
    source: {
      id: 'S1',
      title: 'Documentation Python',
      url: 'https://example.com/python',
      retrievedAt: '2026-08-31T00:00:00.000Z',
    },
    sections: [
      {
        paragraphs: [
          'Le ramasse-miettes a reçu plusieurs changements internes sans rapport.',
          'La fonction persist() rend une référence persistante et persisted() indique son état.',
        ],
      },
    ],
  },
  {
    source: {
      id: 'S2',
      title: 'Fiche urgence',
      url: 'https://example.org/avc',
      retrievedAt: '2026-08-31T00:00:00.000Z',
    },
    sections: [
      {
        paragraphs: [
          'En cas de suspicion d’AVC, noter l’heure de début et ne donner ni nourriture ni médicament.',
        ],
      },
    ],
  },
];

describe('ephemeral evidence selection', () => {
  it('uses semantic candidates without persisting an index', async () => {
    const result = await selectEvidencePassagesHybrid({
      question: 'Comment rendre une référence durable ?',
      queries: ['fonction Python durable'],
      pages,
      embeddings: {
        embed: async (input) =>
          input.map((text) =>
            /persist\(\)|durable|fonction Python/iu.test(text)
              ? [1, 0]
              : [0, 1],
          ),
      },
    });
    expect(result.retrievalMode).toBe('hybrid');
    expect(result.passages.some(({ text }) => text.includes('persist()'))).toBe(
      true,
    );
    expect(result.diagnostics.semanticCandidates).toBeGreaterThan(0);
  });

  it('falls back to BM25 when embedding fails', async () => {
    const result = await selectEvidencePassagesHybrid({
      question: 'Que faire en cas AVC heure nourriture médicament ?',
      pages,
      embeddings: { embed: async () => Promise.reject(new Error('offline')) },
    });
    expect(result.retrievalMode).toBe('lexical_fallback');
    expect(
      result.passages.some(({ text }) => text.includes('noter l’heure')),
    ).toBe(true);
  });

  it('batches large ephemeral dossiers for bounded embedding APIs', async () => {
    const calls: number[] = [];
    const manyPages: FrozenPage[] = [
      {
        ...pages[0]!,
        sections: [
          {
            paragraphs: Array.from(
              { length: 70 },
              (_, index) =>
                `Paragraphe technique numéro ${index.toString()} au contenu suffisamment long.`,
            ),
          },
        ],
      },
    ];
    const result = await selectEvidencePassagesHybrid({
      question: 'paragraphe technique',
      pages: manyPages,
      embeddings: {
        embed: async (input) => {
          calls.push(input.length);
          return input.map(() => [1, 0]);
        },
      },
    });
    expect(Math.max(...calls)).toBeLessThanOrEqual(32);
    expect(calls.length).toBeGreaterThan(1);
    expect(result.retrievalMode).toBe('hybrid');
    expect(DEFAULT_PASSAGE_LIMITS.maxPassages).toBe(12);
    expect(result.passages.length).toBeLessThanOrEqual(12);
  });

  it('separates titles, list items and sentences deterministically', () => {
    expect(
      splitAuditUnits('# Titre\n- Première phrase. Deuxième phrase.'),
    ).toEqual([
      { id: 'U1', text: 'Titre', citedPassageIds: [] },
      { id: 'U2', text: 'Première phrase.', citedPassageIds: [] },
      { id: 'U3', text: 'Deuxième phrase.', citedPassageIds: [] },
    ]);
  });
});

describe('synthesis evidence regressions', () => {
  it('keeps a short logical section whole with the last exception and original coordinates', async () => {
    const paragraphs = [
      'La restauration nécessite une sauvegarde validée.',
      'Sélectionnez le fichier à restaurer dans le catalogue.',
      'La restauration remplace les données de travail.',
      'Conservez la copie précédente jusqu’à la validation.',
      'Exception : si la validation échoue, revenez à la copie précédente.',
    ];
    const result = await selectEvidencePassagesHybrid({
      question: 'Comment effectuer une restauration ?',
      pages: [
        { ...pages[0]!, sections: [{ heading: 'Restauration', paragraphs }] },
      ],
    });
    expect(result.passages).toHaveLength(1);
    expect(result.passages[0]?.text).toBe(paragraphs.join('\n'));
    expect(result.passages[0]?.paragraphKeys).toEqual(
      paragraphs.map((_, i) => `S1:0:${i}`),
    );
  });

  it('keeps long paragraphs and their original coordinates after filtering', async () => {
    const long =
      'Le mécanisme utilise des transactions atomiques pour protéger les écritures. '.repeat(
        45,
      );
    const result = await selectEvidencePassagesHybrid({
      question: 'transactions atomiques',
      pages: [{ ...pages[0]!, sections: [{ paragraphs: ['Menu', long] }] }],
    });
    expect(result.passages.length).toBeGreaterThan(0);
    expect(result.passages.every((p) => p.text.length <= 8000)).toBe(true);
    expect(result.diagnostics.selectedParagraphKeys).toContain('S1:0:1');
    expect(result.diagnostics.selectedParagraphKeys).not.toContain('S1:0:0');
  });

  it('ranks evidence beyond the eighth read page', async () => {
    const result = await selectEvidencePassagesHybrid({
      question: 'zèbre magnétique essentiel',
      pages: Array.from({ length: 16 }, (_, i) => ({
        source: {
          ...pages[0]!.source,
          id: `S${i + 1}`,
          url: `https://example.org/${i}`,
        },
        sections: [
          {
            paragraphs: [
              i === 15
                ? 'Le zèbre magnétique essentiel contient la réponse recherchée.'
                : `Le document ${i} raconte une histoire sans lien avec cette question.`,
            ],
          },
        ],
      })),
    });
    expect(result.passages.some((p) => p.sourceId === 'S16')).toBe(true);
    expect(result.sources.length).toBeLessThanOrEqual(8);
  });

  it('retains contradictory negations as distinct evidence', async () => {
    const result = await selectEvidencePassagesHybrid({
      question: 'Le cache est partagé entre les profils',
      pages: [
        {
          ...pages[0]!,
          sections: [
            {
              paragraphs: [
                'Le cache est partagé entre les profils pour conserver les informations de chaque utilisateur.',
              ],
            },
            {
              paragraphs: [
                'Le cache n’est pas partagé entre les profils pour conserver les informations de chaque utilisateur.',
              ],
            },
          ],
        },
      ],
    });
    expect(result.diagnostics.selectedParagraphKeys).toEqual(
      expect.arrayContaining(['S1:0:0', 'S1:1:0']),
    );
  });

  it('keeps paragraphs, headings, list items and post-sentence citations', () => {
    const segments = splitAuditSegments(
      '## Explication\nPremière phrase. [P1] Deuxième phrase [P1].\n\nAutre paragraphe [P1].\n\n- Un point [P1]. Une précision [P1].',
    );
    expect(segments[1]!.unit.text).toBe('Première phrase. [P1]');
    const audit = deriveAnswerAudit({
      units: segments.map(({ unit, prefix }) => ({
        unitId: unit.id,
        verdict: prefix.startsWith('#') ? 'not_factual' : 'supported',
        passageIds: prefix.startsWith('#') ? [] : ['P1'],
      })),
    });
    const compiled = compileAuditedAnswer(segments, audit, false);
    expect(compiled.markdown).toContain(
      '## Explication\nPremière phrase. [P1] Deuxième phrase. [P1]\n\nAutre paragraphe. [P1]',
    );
    expect(compiled.markdown.match(/^- /gm)).toHaveLength(1);
    expect(compiled.markdown).not.toContain('\n\nDeuxième');
  });
});
