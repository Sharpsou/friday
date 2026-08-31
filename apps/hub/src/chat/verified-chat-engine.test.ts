import { describe, expect, it } from 'vitest';

import { normalizeGeneratedMarkdown } from './verified-chat-engine.js';

describe('normalizeGeneratedMarkdown', () => {
  it('retire les URLs produites par le modèle', () => {
    expect(
      normalizeGeneratedMarkdown(
        'Voir [Python](https://example.test/python) et https://invented.test.',
      ),
    ).toBe('Voir Python et');
  });

  it('normalise les groupes de passages avant leur résolution par le code', () => {
    expect(normalizeGeneratedMarkdown('Version stable (P1, P3, P8).')).toBe(
      'Version stable [P1] [P3] [P8].',
    );
  });
});
