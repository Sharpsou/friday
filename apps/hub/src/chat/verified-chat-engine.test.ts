import { describe, expect, it } from 'vitest';

import {
  dedupeResolvedSourceCitations,
  extractReadableParagraphs,
  explicitResourceSearchQueries,
  highRiskNotice,
  normalizeGeneratedMarkdown,
  routeForcedByMode,
  VerifiedChatEngine,
} from './verified-chat-engine.js';

const readableAgenticArticle = [
  'Cette formation consacrée à l’IA agentique présente les principes de conception des agents, leur orchestration et leur supervision dans des applications concrètes.',
  'Le podcast associé examine des retours d’expérience, la validation des sorties, la limitation des outils et les bonnes pratiques nécessaires pour conserver un contrôle humain.',
].join('\n\n');

function auditFixture(raw: string, prompt: string) {
  if (!prompt.startsWith('VERIFICATION=') || !raw.startsWith('{"units"'))
    return raw;
  const docs = JSON.parse(prompt.split('ORIGINAUX=')[1]!) as Array<{
    id: string;
    excerpts: Array<{ id: string; text: string }>;
  }>;
  return JSON.stringify({
    units: JSON.parse(raw).units.map(
      (u: {
        unitId: string;
        verdict: string;
        addressedAxisIds?: string[];
      }) => ({
        unitId: u.unitId,
        verdict: u.verdict,
        addressedAxisIds: u.addressedAxisIds ?? ['A1'],
        evidence: [
          { passageId: docs[0]!.id, quoteId: docs[0]!.excerpts[0]!.id },
        ],
        reason: 'Support examiné.',
      }),
    ),
  });
}

function unifiedEngine(responses: string[], searchFails = false) {
  return new VerifiedChatEngine({
    pipeline: 'unified',
    ollama: {
      generate: async ({ prompt }: { prompt: string }) => ({
        response: auditFixture(responses.shift()!, prompt),
        durationMs: 1,
      }),
      embed: async ({ input }: { input: string[] }) => input.map(() => [1, 0]),
    } as never,
    search: {
      search: async () => {
        if (searchFails) throw new Error('TAVILY_UNAVAILABLE');
        return {
          creditsUsed: 2,
          evidence: [
            {
              title: 'Formation et podcast sur l’IA agentique',
              url: 'https://example.com/article-agentique',
              content: '',
              publishedAt: '2026-09-03T00:00:00.000Z',
            },
            {
              title: 'Podcast agentique en vidéo',
              url: 'https://youtube.com/watch?v=podcast',
              content: '',
              publishedAt: '2026-09-03T00:00:00.000Z',
            },
          ],
        };
      },
    } as never,
    pageReader: {
      fetchArticleDocument: async (url: string) => ({
        text: url.includes('youtube.com')
          ? 'Présentation Presse Droits d’auteur Nous contacter Créateurs Publicité Conditions d’utilisation Confidentialité © Google LLC'
          : readableAgenticArticle,
        publishedAt: '2026-09-03T00:00:00.000Z',
      }),
    } as never,
  });
}

describe('normalizeGeneratedMarkdown', () => {
  it('deduplicates adjacent citations resolved to the same source', () => {
    expect(dedupeResolvedSourceCitations('Fait [S1] [S1] [S2].')).toBe(
      'Fait [S1] [S2].',
    );
  });

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
    expect(normalizeGeneratedMarkdown('Version [P1, P3; P8].')).toBe(
      'Version [P1] [P3] [P8].',
    );
  });

  it('retire les rubriques qui exposent la hiérarchie interne des axes', () => {
    expect(
      normalizeGeneratedMarkdown(
        '### Axes Requise\n\nPodcast utile.\n\n**Axes Useful**\n\nBonnes pratiques.',
      ),
    ).toBe('Podcast utile.\n\n\nBonnes pratiques.');
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

describe('unified evidence pipeline', () => {
  it('rejects a platform footer as evidence while accepting a relevant article', () => {
    expect(
      extractReadableParagraphs(
        'Présentation Presse Droits d’auteur Nous contacter Créateurs Publicité Conditions d’utilisation Confidentialité © Google LLC',
        ['podcast agentique'],
      ),
    ).toEqual([]);
    expect(
      extractReadableParagraphs(readableAgenticArticle, [
        'podcast formation agentique',
      ]),
    ).toHaveLength(2);
  });

  it.each(['cookies', 'navigation', 'confidentialité'])(
    'does not discard substantive documentation because its subject is %s',
    (subject) => {
      const paragraph = `Cette documentation explique la ${subject} et ses conditions de fonctionnement. Elle décrit les limites du mécanisme et les précautions nécessaires pour comprendre son comportement.`;
      expect(extractReadableParagraphs(paragraph, [subject])).toEqual([
        paragraph,
      ]);
    },
  );

  it('preserves each explicitly requested resource type before model topics', () => {
    expect(
      explicitResourceSearchQueries(
        'Trouve des podcasts et des formations courtes sur l’agentique',
      ).map((query) => query.split(' ')[0]),
    ).toEqual(['podcast', 'formation']);
  });

  it('abstains without publishing excerpts when audit JSON fails', async () => {
    const engine = unifiedEngine([
      plan,
      'Le podcast et la formation présentent des pratiques de supervision [P1].',
      '{broken',
      '{broken-again',
    ]);
    const result = await engine.answer({
      content:
        'Trouve des podcasts et formations sur l’agentique et leurs bonnes pratiques',
      mode: 'web',
      priorTurns: [],
      signal: new AbortController().signal,
      updateStage: () => undefined,
    });
    expect(result).toMatchObject({
      status: 'abstained',
      fallbackCode: 'SYNTHESIS_INVALID_AUDIT',
      readablePageCount: 1,
      rejectedPageCount: 1,
      leadCount: 0,
    });
    expect(result.markdown).not.toContain(
      'Le podcast et la formation présentent des pratiques de supervision',
    );
    expect(result.markdown).toContain('vérification');
    expect(result.markdown).not.toContain('Axes');
    expect(result.sources).toEqual([]);
  });

  it('abstains when every drafted fact is rejected', async () => {
    const rejected = JSON.stringify({
      units: [
        {
          unitId: 'U1',
          verdict: 'unsupported',
          passageIds: [],
          addressedAxisIds: [],
        },
      ],
    });
    const engine = unifiedEngine([
      plan,
      'Affirmation trop large [P1].',
      rejected,
      'Affirmation encore trop large [P1].',
      rejected,
      'Affirmation encore trop large [P1].',
    ]);
    const result = await engine.answer({
      content: 'Trouve des podcasts et formations sur l’agentique',
      mode: 'web',
      priorTurns: [],
      signal: new AbortController().signal,
      updateStage: () => undefined,
    });
    expect(result.status).toBe('abstained');
    expect(result.fallbackCode).toBe('SYNTHESIS_NOT_VERIFIED');
    expect(result.markdown).toContain('vérification');
    expect(result.markdown).not.toContain('Affirmation encore');
    expect(
      result.sources.some(({ evidenceLevel }) => evidenceLevel === 'readable'),
    ).toBe(false);
  });

  it('does not substitute model knowledge when required Web evidence fails', async () => {
    const engine = unifiedEngine(
      [plan, 'Voici une réponse locale prudente.'],
      true,
    );
    const result = await engine.answer({
      content: 'Donne une information actuelle',
      mode: 'web',
      priorTurns: [],
      signal: new AbortController().signal,
      updateStage: () => undefined,
    });
    expect(result).toMatchObject({
      status: 'abstained',
      route: 'web_verified',
      fallbackCode: 'WEB_SEARCH_UNAVAILABLE',
    });
    expect(result.markdown).toContain('recherche');
  });

  it('keeps a professional warning visible for an AVC question', () => {
    expect(
      highRiskNotice(
        'Quels signes évoquent un AVC et quand appeler les secours ?',
      ),
    ).toContain('professionnel qualifié');
  });

  it('reads candidates round-robin across search topics before limiting pages', async () => {
    const responses = [
      JSON.stringify({
        intent: 'recommend',
        axes: [
          {
            id: 'A1',
            label: 'Podcasts',
            question: 'Quels podcasts agentiques écouter ?',
            role: 'primary',
            query: 'podcasts agentiques',
          },
          {
            id: 'A2',
            label: 'Formations',
            question: 'Quelles formations agentiques suivre ?',
            role: 'primary',
            query: 'formations agentiques',
          },
        ],
      }),
      'Le podcast et la formation sont deux ressources distinctes [P1] [P2].',
      '{broken',
      '{broken-again',
    ];
    const titles: string[] = [];
    const engine = new VerifiedChatEngine({
      observe: (event) => {
        if (event.dossier)
          titles.push(...event.dossier.sources.map((s) => s.title));
      },
      pipeline: 'unified',
      ollama: {
        generate: async ({ prompt }: { prompt: string }) => ({
          response: auditFixture(responses.shift()!, prompt),
          durationMs: 1,
        }),
        embed: async ({ input }: { input: string[] }) =>
          input.map(() => [1, 0]),
      } as never,
      search: {
        search: async (query: string) => ({
          creditsUsed: 2,
          evidence: Array.from({ length: 5 }, (_, index) => ({
            title: `${query.includes('podcast') ? 'Podcast' : 'Formation'} ${index.toString()}`,
            url: `https://example.com/${encodeURIComponent(query)}/${index.toString()}`,
            content: '',
            publishedAt: null,
          })),
        }),
      } as never,
      pageReader: {
        fetchArticleDocument: async (url: string) => ({
          text: url.includes('podcast')
            ? `${readableAgenticArticle}\n\nCe programme audio est bien un podcast consacré aux agents.`
            : `${readableAgenticArticle}\n\nCette session est une formation courte consacrée aux agents.`,
          publishedAt: null,
        }),
      } as never,
    });
    await engine.answer({
      content: 'Trouve des podcasts et des formations sur l’agentique',
      mode: 'web',
      priorTurns: [],
      signal: new AbortController().signal,
      updateStage: () => undefined,
    });
    expect(titles.some((title) => title.startsWith('Podcast'))).toBe(true);
    expect(titles.some((title) => title.startsWith('Formation'))).toBe(true);
  });

  it('revises once when an explicitly requested resource available in evidence was omitted', async () => {
    const supported = JSON.stringify({
      units: [
        {
          unitId: 'U1',
          verdict: 'supported',
          passageIds: ['P1'],
        },
      ],
    });
    const prompts: string[] = [];
    const responses = [
      plan,
      'La formation propose des applications et des pratiques concrètes [P1].',
      supported.replace(
        '"passageIds":["P1"]',
        '"passageIds":["P1"],"addressedAxisIds":[]',
      ),
      'Le podcast et la formation proposent des applications et des pratiques concrètes [P1].',
      supported,
    ];
    const engine = new VerifiedChatEngine({
      pipeline: 'unified',
      ollama: {
        generate: async ({ prompt }: { prompt: string }) => {
          prompts.push(prompt);
          return {
            response: auditFixture(responses.shift()!, prompt),
            durationMs: 1,
          };
        },
        embed: async ({ input }: { input: string[] }) =>
          input.map(() => [1, 0]),
      } as never,
      search: {
        search: async () => ({
          creditsUsed: 2,
          evidence: [
            {
              title: 'Podcast et formation sur l’IA agentique',
              url: 'https://example.com/ressources-agentiques',
              content: '',
              publishedAt: null,
            },
          ],
        }),
      } as never,
      pageReader: {
        fetchArticleDocument: async () => ({
          text: readableAgenticArticle,
          publishedAt: null,
        }),
      } as never,
    });
    const result = await engine.answer({
      content: 'Trouve des podcasts et des formations sur l’agentique',
      mode: 'web',
      priorTurns: [],
      signal: new AbortController().signal,
      updateStage: () => undefined,
    });
    expect(result.status).toBe('verified');
    expect(result.markdown).toContain('podcast');
    expect(prompts.some((prompt) => prompt.includes('BESOINS='))).toBe(true);
  });
});

function axesEngine(responses: string[]) {
  return new VerifiedChatEngine({
    axesEnabled: true,
    pipeline: 'axes',
    ollama: {
      generate: async () => ({
        response: responses.shift()!,
        durationMs: 1,
      }),
      embed: async ({ input }: { input: string[] }) => input.map(() => [1, 0]),
    } as never,
    search: {
      search: async () => ({
        creditsUsed: 2,
        evidence: [
          {
            title: 'Protocole',
            url: 'https://example.com/protocole',
            content: '',
            publishedAt: '2026-08-31T00:00:00.000Z',
          },
        ],
      }),
    } as never,
    pageReader: {
      fetchArticleDocument: async () => ({
        text: 'L’autonomie mesurée par le protocole est de dix heures.',
        publishedAt: '2026-08-31T00:00:00.000Z',
      }),
    } as never,
  });
}

const plan = JSON.stringify({
  intent: 'explain',
  axes: [
    {
      id: 'A1',
      label: 'Autonomie mesurée',
      question: 'Quelle autonomie a été mesurée ?',
      role: 'primary',
      query: 'autonomie mesurée protocole',
    },
  ],
});

const compositionPlan = JSON.stringify({
  intent: 'recommend',
  axes: [
    {
      id: 'A1',
      label: 'Podcast agentique',
      question: 'Quel podcast agentique écouter ?',
      role: 'primary',
      query: 'podcast agentique',
    },
    {
      id: 'A2',
      label: 'Bonnes pratiques',
      question: 'Quelles bonnes pratiques agentiques sont enseignées ?',
      role: 'cross_cutting',
      query: 'bonnes pratiques agentiques',
    },
  ],
});

function compositionEngine(responses: string[]) {
  return new VerifiedChatEngine({
    axesEnabled: true,
    pipeline: 'axes',
    ollama: {
      generate: async () => ({
        response: responses.shift()!,
        durationMs: 1,
      }),
      embed: async ({ input }: { input: string[] }) => input.map(() => [1, 0]),
    } as never,
    search: {
      search: async () => ({
        creditsUsed: 2,
        evidence: [
          {
            title: 'Podcast agentique et pratiques',
            url: 'https://example.com/podcast-agentique',
            content: '',
            publishedAt: '2026-08-31T00:00:00.000Z',
          },
        ],
      }),
    } as never,
    pageReader: {
      fetchArticleDocument: async () => ({
        text: 'Ce podcast agentique présente des applications concrètes et enseigne les bonnes pratiques agentiques de supervision.',
        publishedAt: '2026-08-31T00:00:00.000Z',
      }),
    } as never,
  });
}

describe('axis verified pipeline', () => {
  it('uses six deep queries and refills unreadable pages before keeping eight', async () => {
    const searched: string[] = [];
    const read: string[] = [];
    const engine = new VerifiedChatEngine({
      axesEnabled: true,
      pipeline: 'axes',
      search: {
        search: async (query: string) => {
          searched.push(query);
          const queryIndex = Number(query.replace('query-', ''));
          return {
            creditsUsed: 2,
            evidence: Array.from({ length: 3 }, (_, resultIndex) => {
              const index = queryIndex * 3 + resultIndex;
              return {
                title: `Source ${index.toString()}`,
                url: `https://example.com/source-${index.toString()}`,
                content: '',
                publishedAt: '2026-08-31T00:00:00.000Z',
              };
            }),
          };
        },
      } as never,
      pageReader: {
        fetchArticleDocument: async (url: string) => {
          read.push(url);
          const index = Number(url.match(/source-(\d+)/u)?.[1]);
          if (index < 4) throw new Error('UNREADABLE');
          return {
            text: `Contenu exploitable de la source ${index.toString()}. Ce paragraphe est suffisamment long pour être retenu.`,
            publishedAt: '2021-12-25T00:00:00.000Z',
          };
        },
      } as never,
    });
    const pages = await (
      engine as unknown as {
        discoverPages(
          queries: string[],
          signal: AbortSignal,
          sourceOffset: number,
          recent: boolean,
          budget?: { remaining: number },
        ): Promise<
          Array<{ source: { publishedAt?: string }; sections: unknown[] }>
        >;
      }
    ).discoverPages(
      Array.from({ length: 6 }, (_, index) => `query-${index.toString()}`),
      new AbortController().signal,
      0,
      true,
    );
    expect(searched).toHaveLength(6);
    expect(read.length).toBeGreaterThan(8);
    expect(pages).toHaveLength(8);
    expect(pages[0]?.source.publishedAt).toBe('2026-08-31T00:00:00.000Z');
  });

  it('caps all discovery passes of one run to six deep searches', async () => {
    const searched: string[] = [];
    const engine = new VerifiedChatEngine({
      search: {
        search: async (query: string) => {
          searched.push(query);
          return { creditsUsed: 2, evidence: [] };
        },
      } as never,
    });
    const discover = (
      engine as unknown as {
        discoverPages(
          queries: string[],
          signal: AbortSignal,
          sourceOffset: number,
          recent: boolean,
          budget: { remaining: number },
        ): Promise<unknown[]>;
      }
    ).discoverPages.bind(engine);
    const budget = { remaining: 6 };
    const signal = new AbortController().signal;
    await discover(['q1', 'q2', 'q3', 'q4'], signal, 0, false, budget);
    await discover(['q5', 'q6', 'q7', 'q8'], signal, 0, false, budget);
    expect(searched).toEqual(['q1', 'q2', 'q3', 'q4', 'q5', 'q6']);
    expect(budget.remaining).toBe(0);
  });

  it('resolves a conversational follow-up before planning and Web search', async () => {
    const searched: string[] = [];
    const prompts: string[] = [];
    const responses = [
      JSON.stringify({
        standaloneQuestion:
          'Quelles découvertes le télescope James Webb a-t-il faites en 2026 ?',
      }),
      JSON.stringify({
        intent: 'recent',
        axes: [
          {
            id: 'A1',
            label: 'Découvertes 2026',
            question:
              'Quelles découvertes de James Webb ont été publiées en 2026 ?',
            role: 'primary',
            query: 'James Webb découvertes 2026',
          },
        ],
      }),
      'Une découverte de James Webb a été publiée en 2026 [P1].',
      JSON.stringify({
        units: [
          {
            unitId: 'U1',
            verdict: 'supported',
            passageIds: ['P1'],
            addressedAxisIds: ['A1'],
          },
        ],
      }),
    ];
    const engine = new VerifiedChatEngine({
      axesEnabled: true,
      pipeline: 'axes',
      ollama: {
        generate: async ({ prompt }: { prompt: string }) => {
          prompts.push(prompt);
          return { response: responses.shift()!, durationMs: 1 };
        },
        embed: async ({ input }: { input: string[] }) =>
          input.map(() => [1, 0]),
      } as never,
      search: {
        search: async (query: string) => {
          searched.push(query);
          return {
            creditsUsed: 2,
            evidence: [
              {
                title: 'Résultat James Webb 2026',
                url: 'https://example.com/jwst-2026',
                content: '',
                publishedAt: '2026-08-31T00:00:00.000Z',
              },
            ],
          };
        },
      } as never,
      pageReader: {
        fetchArticleDocument: async () => ({
          text: 'Une découverte de James Webb a été publiée en 2026.',
          publishedAt: '2026-08-31T00:00:00.000Z',
        }),
      } as never,
    });
    const result = await engine.answer({
      content: 'Et en 2026 ? Quelles sont les découvertes ?',
      mode: 'web',
      priorTurns: [
        {
          role: 'user',
          content:
            'Donne-moi les dernières découvertes du télescope James Webb.',
        },
        { role: 'assistant', content: 'Réponse précédente.' },
      ],
      signal: new AbortController().signal,
      updateStage: () => undefined,
    });
    expect(result.status).toBe('verified');
    expect(result.modelCalls).toBe(4);
    expect(searched[0]).toContain(
      'Quelles découvertes le télescope James Webb a-t-il faites en 2026 ?',
    );
    expect(
      prompts.slice(1).every((prompt) => prompt.includes('James Webb')),
    ).toBe(true);
  });

  it('publishes only auditor-approved citations and exposes no passage ids', async () => {
    const engine = axesEngine([
      plan,
      'Le protocole mesure dix heures [P1].',
      JSON.stringify({
        units: [
          {
            unitId: 'U1',
            verdict: 'supported',
            passageIds: ['P1'],
            addressedAxisIds: ['A1'],
          },
        ],
      }),
    ]);
    const stages: string[] = [];
    const result = await engine.answer({
      content: 'Quelle autonomie est mesurée ?',
      mode: 'web',
      priorTurns: [],
      signal: new AbortController().signal,
      updateStage: (stage) => stages.push(stage),
    });
    expect(result).toMatchObject({
      status: 'verified',
      axisCount: 1,
      requiredAxisCount: 1,
      coveredAxisCount: 1,
    });
    expect(result.markdown).toContain('[S1]');
    expect(result.markdown).not.toMatch(/\[P\d+/u);
    expect(result.sources).toHaveLength(1);
    expect(stages).toContain('auditing');
  });

  it('accepts sourced composition across sections without an unnecessary revision', async () => {
    const isolatedAudit = JSON.stringify({
      units: [
        {
          unitId: 'U1',
          verdict: 'not_factual',
          passageIds: [],
          addressedAxisIds: ['A1'],
        },
        {
          unitId: 'U2',
          verdict: 'supported',
          passageIds: ['P1'],
          addressedAxisIds: ['A1'],
        },
        {
          unitId: 'U3',
          verdict: 'not_factual',
          passageIds: [],
          addressedAxisIds: ['A2'],
        },
        {
          unitId: 'U4',
          verdict: 'supported',
          passageIds: ['P1'],
          addressedAxisIds: ['A2'],
        },
      ],
    });
    const engine = compositionEngine([
      compositionPlan,
      '### Podcast\nLe podcast présente des applications [P1].\n### Bonnes pratiques\nIl recommande une supervision [P1].',
      isolatedAudit,
    ]);
    const result = await engine.answer({
      content: 'Trouve un podcast sur l’agentique et ses bonnes pratiques.',
      mode: 'web',
      priorTurns: [],
      signal: new AbortController().signal,
      updateStage: () => undefined,
    });
    expect(result).toMatchObject({
      status: 'verified',
      modelCalls: 3,
      axisCount: 2,
      requiredAxisCount: 2,
      coveredAxisCount: 2,
    });
    expect(result.markdown).toContain('Il recommande une supervision');
    expect(result.markdown).not.toMatch(/axes?\s+(?:requis|utile)/iu);
  });

  it('keeps supported content partial when an audited need remains uncovered', async () => {
    const isolatedAnswer =
      '### Podcast\nLe podcast présente des applications [P1].\n### Bonnes pratiques\nIl recommande une supervision [P1].';
    const isolatedAudit = JSON.stringify({
      units: [
        {
          unitId: 'U1',
          verdict: 'not_factual',
          passageIds: [],
          addressedAxisIds: ['A1'],
        },
        {
          unitId: 'U2',
          verdict: 'supported',
          passageIds: ['P1'],
          addressedAxisIds: ['A1'],
        },
        {
          unitId: 'U3',
          verdict: 'not_factual',
          passageIds: [],
          addressedAxisIds: ['A2'],
        },
        {
          unitId: 'U4',
          verdict: 'supported',
          passageIds: ['P1'],
          addressedAxisIds: [],
        },
      ],
    });
    const engine = compositionEngine([
      compositionPlan,
      isolatedAnswer,
      isolatedAudit,
      isolatedAnswer,
      isolatedAudit,
    ]);
    const result = await engine.answer({
      content: 'Trouve un podcast sur l’agentique et ses bonnes pratiques.',
      mode: 'web',
      priorTurns: [],
      signal: new AbortController().signal,
      updateStage: () => undefined,
    });
    expect(result).toMatchObject({
      status: 'partial',
      fallbackCode: 'PARTIAL_AUDIT',
      rejectedUnitCount: 0,
    });
    expect(result.markdown).toContain('podcast présente des applications');
    expect(result.markdown).toContain('certains besoins restent incomplets');
    expect(result.markdown).not.toContain('brouillon a été masqué');
    expect(result.markdown).not.toMatch(/A[1-5]/u);
  });

  it('masks a fully rejected draft and shows only a sourced doubt dossier', async () => {
    const rejectedAudit = JSON.stringify({
      units: [{ unitId: 'U1', verdict: 'unsupported', passageIds: [] }],
    });
    const engine = axesEngine([
      plan,
      'Le brouillon affirme douze heures [P1].',
      rejectedAudit,
      'Le brouillon affirme encore douze heures [P1].',
      rejectedAudit,
    ]);
    const result = await engine.answer({
      content: 'Quelle autonomie est mesurée ?',
      mode: 'web',
      priorTurns: [],
      signal: new AbortController().signal,
      updateStage: () => undefined,
    });
    expect(result.status).toBe('abstained');
    expect(result.markdown).toContain('brouillon a été masqué');
    expect(result.markdown).toContain('dix heures');
    expect(result.markdown).not.toContain('douze heures');
    expect(result.markdown).not.toMatch(/\[P\d+/u);
    expect(result.fallbackCode).toBe('AUDIT_REJECTED_ALL');
  });

  it('shows sourced excerpts instead of the draft after two invalid audits', async () => {
    const engine = axesEngine([
      plan,
      'Le brouillon non vérifié affirme douze heures [P1].',
      '{invalid',
      '{still-invalid',
    ]);
    const result = await engine.answer({
      content: 'Quelle autonomie est mesurée ?',
      mode: 'web',
      priorTurns: [],
      signal: new AbortController().signal,
      updateStage: () => undefined,
    });
    expect(result.status).toBe('audit_error');
    expect(result.markdown).toContain('vérification structurée');
    expect(result.markdown).toContain('dix heures');
    expect(result.markdown).not.toContain('douze heures');
    expect(result.markdown).not.toMatch(/\[P\d+/u);
    expect(result.sources).toHaveLength(1);
  });

  it('abstains instead of silently falling back to local when Web is unavailable', async () => {
    const engine = new VerifiedChatEngine({
      axesEnabled: true,
      pipeline: 'axes',
      ollama: {
        generate: async () => ({ response: plan, durationMs: 1 }),
      } as never,
      search: {
        search: async () => Promise.reject(new Error('TAVILY_UNAVAILABLE')),
      } as never,
    });
    const result = await engine.answer({
      content: 'Quelle autonomie est mesurée ?',
      mode: 'web',
      priorTurns: [],
      signal: new AbortController().signal,
      updateStage: () => undefined,
    });
    expect(result).toMatchObject({
      status: 'abstained',
      route: 'web_verified',
      fallbackCode: 'WEB_SEARCH_UNAVAILABLE',
      sources: [],
    });
    expect(result.markdown).toContain('ne revient pas silencieusement');
  });
});
