import { describe, expect, it } from 'vitest';

import {
  normalizeGeneratedMarkdown,
  routeForcedByMode,
} from './verified-chat-engine.js';

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

describe('routeForcedByMode', () => {
  it('leaves Friday automatic and forces the two explicit modes', () => {
    expect(routeForcedByMode('friday', 'Question ambiguë')).toBeNull();
    expect(routeForcedByMode('local', 'Donne les actualités')).toMatchObject({
      route: 'local',
      queries: [],
    });
    expect(
      routeForcedByMode('web', 'Explique un concept stable'),
    ).toMatchObject({
      route: 'web',
      queries: ['Explique un concept stable'],
    });
  });
});
