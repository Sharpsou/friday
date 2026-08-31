import { describe, expect, it } from 'vitest';

import type { FrozenPage } from '../src/contracts.js';
import {
  resolvePassageSources,
  selectEvidencePassages,
} from '../src/passages.js';

function page(
  id: 'S1' | 'S2',
  title: string,
  paragraphs: string[],
): FrozenPage {
  return {
    source: {
      id,
      title,
      url: `https://example.com/${id}`,
      retrievedAt: '2026-08-30T00:00:00.000Z',
    },
    sections: [{ heading: 'Batterie', paragraphs }],
  };
}

describe('selectEvidencePassages', () => {
  it('ranks continuous paragraphs while preserving source diversity and bounds', () => {
    const dossier = selectEvidencePassages(
      'Quelle batterie dure le plus longtemps ?',
      [
        page('S1', 'Essai batterie Alpha', [
          'La batterie Alpha dure dix heures selon le protocole publié.',
          'Le boîtier est disponible en bleu.',
        ]),
        page('S2', 'Essai batterie Beta', [
          'La batterie Beta dure huit heures dans le même protocole.',
        ]),
      ],
      { maxSources: 2, maxPassages: 2, maxCharacters: 1_000 },
    );

    expect(dossier.passages).toHaveLength(2);
    expect(new Set(dossier.passages.map(({ sourceId }) => sourceId))).toEqual(
      new Set(['S1', 'S2']),
    );
    expect(
      dossier.passages.some(({ text }) => text.includes('dix heures')),
    ).toBe(true);
    expect(dossier.characterCount).toBeLessThanOrEqual(1_000);
  });

  it('resolves URLs only through validated passage and source identifiers', () => {
    const dossier = selectEvidencePassages(
      'batterie',
      [page('S1', 'Alpha', ['Batterie testée.'])],
      { maxSources: 1, maxPassages: 1, maxCharacters: 1_000 },
    );
    expect(resolvePassageSources(['P1'], dossier)[0]?.url).toBe(
      'https://example.com/S1',
    );
    expect(() => resolvePassageSources(['P9'], dossier)).toThrow(
      'UNKNOWN_PASSAGE_REFERENCE',
    );
  });
});
