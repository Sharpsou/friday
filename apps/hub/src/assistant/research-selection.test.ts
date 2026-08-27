import { describe, expect, it } from 'vitest';

import {
  areDuplicateResearchEvidence,
  canonicalResearchUrlKey,
  cleanResearchUrl,
  correctiveResearchQuery,
  describeResearchEvidence,
  normalizeTemporalResearchQueries,
  questionNeedsFreshness,
  researchTemporalContext,
  selectPageReadCandidates,
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
      source('https://third.example/a', 'batterie vélo autonomie durée de vie'),
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

  it('uses the same relevance rule for unrelated subject areas', () => {
    const cases = [
      [
        'Quelle étude évalue le sommeil adolescent ?',
        'étude sommeil adolescent',
      ],
      [
        'Comment configurer cette bibliothèque TypeScript ?',
        'configurer bibliothèque TypeScript',
      ],
      ['Comment entretenir un vélo électrique ?', 'entretenir vélo électrique'],
    ];

    for (const [question, relevantText] of cases) {
      const result = selectResearchEvidence(
        question!,
        [relevantText!],
        [
          source('https://noise.example/a', 'recette de cuisine sans rapport', {
            relevanceScore: 1,
          }),
          source('https://relevant.example/a', relevantText!, {
            relevanceScore: 0.2,
          }),
        ],
        'web_light',
      );
      expect(result.selected[0]?.url).toBe('https://relevant.example/a');
    }
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

  it('classifies temporal intent without forcing dates on general questions', () => {
    const now = new Date(2026, 7, 26, 14, 30);

    expect(
      researchTemporalContext(
        'Cherche les dernières découvertes du télescope James Webb',
        now,
      ),
    ).toEqual({
      explicitYears: [],
      freshness: 'recent',
      referenceDate: '2026-08-26',
    });
    expect(
      researchTemporalContext('Pourquoi le ciel est-il bleu ?', now),
    ).toEqual({ explicitYears: [], freshness: 'none' });
    expect(
      researchTemporalContext('Écris une nouvelle explication simple', now),
    ).toEqual({ explicitYears: [], freshness: 'none' });
  });

  it('repairs stale planner years only for temporal research', () => {
    const now = new Date(2026, 7, 26, 14, 30);

    expect(
      normalizeTemporalResearchQueries(
        'Cherche les dernières découvertes du télescope James Webb',
        [
          'dernières découvertes James Webb',
          'nouveaux résultats scientifiques James Webb 2024',
        ],
        3,
        now,
      ),
    ).toEqual([
      'dernières découvertes James Webb',
      'nouveaux résultats scientifiques James Webb 2026',
    ]);
    expect(
      normalizeTemporalResearchQueries(
        'Explique le fonctionnement du télescope James Webb',
        ['fonctionnement télescope James Webb 2024'],
        2,
        now,
      ),
    ).toEqual(['fonctionnement télescope James Webb 2024']);
    expect(
      normalizeTemporalResearchQueries(
        'Quelles découvertes ont été publiées en 2024 ?',
        ['découvertes scientifiques publiées en 2024'],
        2,
        now,
      ),
    ).toEqual(['découvertes scientifiques publiées en 2024']);
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

  it('does not require six sources when three diverse sources answer the question', () => {
    const queries = ['cause ciel bleu', 'diffusion lumière atmosphère'];
    const candidates = [
      source(
        'https://one.example/ciel',
        'La diffusion de la lumière dans atmosphère explique la cause du ciel bleu.',
      ),
      source(
        'https://two.example/lumiere',
        'La lumière bleue est davantage diffusée par les molécules de atmosphère.',
      ),
      source(
        'https://three.example/explication',
        'Une explication de la diffusion atmosphérique et du ciel bleu.',
      ),
    ];

    expect(
      selectResearchEvidence(
        'Pourquoi le ciel est-il bleu ?',
        queries,
        candidates,
        'web_deep',
      ).assessment.status,
    ).toBe('sufficient');
  });

  it('keeps the relevant passage even when it appears near the end', () => {
    const content = `${'Introduction générique sans rapport. '.repeat(520)}\n\nLe télescope James Webb a identifié le fait précis recherché dans cette observation récente.`;
    const result = selectResearchEvidence(
      'Quel fait précis le télescope James Webb a-t-il identifié ?',
      ['fait précis télescope James Webb identifié'],
      [source('https://science.example/article', content)],
      'web_deep',
    );

    expect(content.indexOf('Le télescope')).toBeGreaterThan(10_000);
    expect(result.selected[0]?.content).toContain(
      'Le télescope James Webb a identifié le fait précis',
    );
    expect(result.documents[0]).toMatchObject({
      originalCharacters: content.length,
      truncated: true,
    });
    expect(result.documents[0]!.retainedCharacters).toBeLessThan(
      content.length,
    );
  });

  it('reports explicit evidence gaps and builds one corrective query', () => {
    const result = selectResearchEvidence(
      'Quelles études scientifiques récentes évaluent ce traitement ?',
      ['études scientifiques traitement', 'résultats récents traitement'],
      [
        source(
          'https://blog.example/article',
          'Le traitement est mentionné sans étude ni résultat.',
        ),
      ],
      'web_deep',
    );

    expect(result.assessment).toMatchObject({
      diversityGap: true,
      freshnessGap: true,
      relevanceGap: true,
      status: 'partial',
    });
    expect(correctiveResearchQuery('traitement', result.assessment)).toContain(
      'confirmation indépendante',
    );
  });

  it('canonicalizes public URLs without changing their useful identity', () => {
    expect(
      cleanResearchUrl(
        'https://WWW.Example.com/article/?utm_source=test&b=2&a=1#section',
      ),
    ).toBe('https://www.example.com/article?a=1&b=2');
    expect(
      canonicalResearchUrlKey('https://www.example.com/article/?b=2&a=1'),
    ).toBe('example.com/article?a=1&b=2');
    expect(cleanResearchUrl('http://user:secret@example.com/private')).toBe(
      null,
    );
  });

  it('keeps old sources as context and requires enough current, diverse evidence', () => {
    const now = new Date('2026-08-26T12:00:00.000Z');
    const oldOfficial = source(
      'https://science.nasa.gov/missions/webb/background',
      'James Webb découverte atmosphère exoplanète récente.',
      { publishedAt: '2022-08-25T00:00:00.000Z' },
    );
    const recentIndependent = source(
      'https://science-news.example/webb-atmosphere',
      'James Webb découverte atmosphère exoplanète récente.',
      { publishedAt: '2026-08-20T00:00:00.000Z' },
    );
    const secondRecentDomain = source(
      'https://astronomy-news.example/webb-atmosphere',
      'James Webb découverte atmosphère exoplanète récente.',
      { publishedAt: '2026-08-21T00:00:00.000Z' },
    );

    expect(
      describeResearchEvidence(
        'Quelle est la dernière découverte de James Webb ?',
        [oldOfficial, recentIndependent],
        now,
      ).map(({ freshness }) => freshness),
    ).toEqual(['background', 'current']);

    const partial = selectResearchEvidence(
      'Quelle est la dernière découverte de James Webb ?',
      ['James Webb découverte atmosphère exoplanète récente'],
      [oldOfficial, recentIndependent],
      'web_deep',
    );
    expect(partial.assessment).toMatchObject({
      freshnessGap: false,
      relevanceGap: true,
    });
    expect(partial.complete).toBe(false);

    const supported = selectResearchEvidence(
      'Quelle est la dernière découverte de James Webb ?',
      ['James Webb découverte atmosphère exoplanète récente'],
      [oldOfficial, recentIndependent, secondRecentDomain],
      'web_deep',
    );
    expect(supported.complete).toBe(true);
  });

  it('removes technical URL duplicates but keeps distinct reporting', () => {
    const tracked = source(
      'https://www.science.example/article?utm_campaign=mail',
      'Une analyse détaillée apporte une information utile et vérifiable sur le sujet. '.repeat(
        3,
      ),
    );
    const canonical = source(
      'https://science.example/article',
      tracked.content,
    );
    const independent = source(
      'https://news.example/analysis',
      'Une publication indépendante apporte une information utile et vérifiable avec un éclairage différent sur le sujet. '.repeat(
        3,
      ),
    );

    expect(areDuplicateResearchEvidence(tracked, canonical)).toBe(true);
    expect(areDuplicateResearchEvidence(tracked, independent)).toBe(false);
    const selection = selectResearchEvidence(
      'Quelle information utile est vérifiable sur ce sujet ?',
      ['information utile vérifiable sujet'],
      [tracked, canonical, independent],
      'web_light',
    );
    expect(selection.documents).toHaveLength(2);
  });

  it('selects at most two public HTML candidates for targeted reading', () => {
    const candidates = [
      source('https://one.example/a', 'question réponse courte'),
      source('https://two.example/a', 'question autre réponse courte'),
      source('https://three.example/a', 'question troisième réponse courte'),
    ];
    const selection = selectResearchEvidence(
      'question réponse',
      ['question réponse'],
      candidates,
      'web_deep',
    );

    expect(selectPageReadCandidates(selection, candidates)).toHaveLength(2);
  });
});
