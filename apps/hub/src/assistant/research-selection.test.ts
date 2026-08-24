import { describe, expect, it } from 'vitest';

import {
  questionNeedsFreshness,
  selectResearchEvidence,
  shouldContinueDeepResearch,
} from './research-selection.js';
import type { TavilyEvidence } from './tavily-search.js';

function source(
  url: string,
  content: string,
  options: Partial<TavilyEvidence> = {},
): TavilyEvidence {
  return {
    content,
    publishedAt: null,
    relevanceScore: 0.7,
    title: content.slice(0, 80),
    url,
    ...options,
  };
}

describe('research evidence selection', () => {
  it('keeps a small, diverse light-Web dossier', () => {
    const candidates = [
      source('https://same.example/a', 'batterie vélo autonomie comparatif'),
      source('https://same.example/b', 'batterie vélo durée de vie'),
      source('https://same.example/c', 'batterie vélo recharge'),
      source('https://other.example/a', 'batterie vélo autonomie'),
      source('https://third.example/a', 'batterie vélo autonomie'),
      source('https://fourth.example/a', 'batterie vélo autonomie'),
    ];

    const result = selectResearchEvidence(
      'Comment choisir une batterie de vélo avec une bonne autonomie ?',
      ['batterie vélo autonomie', 'batterie vélo durée de vie'],
      candidates,
      'web_light',
    );

    expect(result.selected).toHaveLength(5);
    const domains = result.selected.map((item) => new URL(item.url).hostname);
    expect(domains.filter((domain) => domain === 'same.example')).toHaveLength(
      2,
    );
    expect(new Set(domains).size).toBeGreaterThanOrEqual(4);
    expect(result.complete).toBe(true);
  });

  it('defines source authority relative to an academic question', () => {
    const result = selectResearchEvidence(
      'Quelles études scientifiques évaluent le sommeil adolescent ?',
      ['études scientifiques sommeil adolescent'],
      [
        source(
          'https://fr.wikipedia.org/wiki/Sommeil',
          'études scientifiques sommeil adolescent',
        ),
        source(
          'https://pubmed.ncbi.nlm.nih.gov/1234/',
          'études scientifiques sommeil adolescent',
        ),
      ],
      'web_light',
    );

    expect(result.selected[0]?.url).toContain('pubmed.ncbi.nlm.nih.gov');
  });

  it('prioritizes relevance over an unrelated high provider score', () => {
    const result = selectResearchEvidence(
      'Comment entretenir un vélo électrique ?',
      ['entretien vélo électrique'],
      [
        source('https://noise.example/a', 'cours de cuisine italienne', {
          relevanceScore: 1,
        }),
        source(
          'https://bike.example/guide',
          'guide entretien batterie et moteur de vélo électrique',
          { relevanceScore: 0.35 },
        ),
      ],
      'web_light',
    );

    expect(result.selected[0]?.url).toBe('https://bike.example/guide');
    expect(result.complete).toBe(false);
  });

  it('uses freshness only for explicitly temporal questions', () => {
    expect(
      questionNeedsFreshness('Quelle est la dernière version publiée ?'),
    ).toBe(true);
    expect(questionNeedsFreshness('Pourquoi le ciel est-il bleu ?')).toBe(
      false,
    );

    const old = source(
      'https://old.example/version',
      'dernière version publiée logiciel',
      { publishedAt: '2020-01-01T00:00:00.000Z' },
    );
    const recent = source(
      'https://recent.example/version',
      'dernière version publiée logiciel',
      { publishedAt: new Date().toISOString() },
    );
    const result = selectResearchEvidence(
      'Quelle est la dernière version publiée du logiciel ?',
      ['dernière version publiée logiciel'],
      [old, recent],
      'web_light',
    );

    expect(result.selected[0]?.url).toBe('https://recent.example/version');
  });

  it('stops deep research only after broad relevant coverage', () => {
    const queries = [
      'pompe chaleur efficacité',
      'pompe chaleur coût',
      'pompe chaleur entretien',
    ];
    const candidates = Array.from({ length: 6 }, (_, index) =>
      source(
        `https://domain-${index % 3}.example/source-${index.toString()}`,
        `pompe chaleur efficacité coût entretien source ${index.toString()}`,
      ),
    );

    const selection = selectResearchEvidence(
      'Quels sont les avantages, le coût et l’entretien d’une pompe à chaleur ?',
      queries,
      candidates,
      'web_deep',
    );
    expect(selection.complete).toBe(true);
    expect(
      shouldContinueDeepResearch(
        'Quels sont les avantages, le coût et l’entretien d’une pompe à chaleur ?',
        queries,
        candidates,
      ),
    ).toBe(false);
    expect(
      shouldContinueDeepResearch(
        'Quels sont les avantages, le coût et l’entretien d’une pompe à chaleur ?',
        queries,
        candidates.slice(0, 2),
      ),
    ).toBe(true);
  });
});
