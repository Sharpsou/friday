import { describe, expect, it } from 'vitest';

import {
  UnitAuditJsonSchema,
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
    expect(JSON.stringify(UnitAuditJsonSchema)).not.toContain('axes');
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
