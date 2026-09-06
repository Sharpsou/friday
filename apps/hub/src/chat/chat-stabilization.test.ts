import { describe, expect, it } from 'vitest';
import {
  VerifiedChatEngine,
  type VerifiedChatEngineOptions,
} from './verified-chat-engine.js';

const plan = JSON.stringify({
  intent: 'explain',
  axes: [
    {
      id: 'A1',
      label: 'Autonomie',
      question: 'Quelle autonomie ?',
      role: 'primary',
      query: 'autonomie mesurée',
    },
  ],
});
const contradicted = JSON.stringify({
  units: [{ unitId: 'U1', verdict: 'contradicted', passageIds: ['P1'] }],
});
const input = {
  content: 'Quelle autonomie mesurée ?',
  mode: 'web' as const,
  priorTurns: [],
  signal: new AbortController().signal,
  updateStage: () => undefined,
};
function engine(
  responses: Array<string | Error>,
  observe?: VerifiedChatEngineOptions['observe'],
  activity = { searches: 0, reads: 0 },
) {
  return new VerifiedChatEngine({
    ...(observe ? { observe } : {}),
    pipeline: 'unified',
    ollama: {
      generate: async ({ prompt }: { prompt: string }) => {
        const value = responses.shift();
        if (value instanceof Error) throw value;
        let response = value!;
        if (
          prompt.startsWith('VERIFICATION=') &&
          response.startsWith('{"units"')
        ) {
          const audit = JSON.parse(response);
          response = JSON.stringify({
            units: audit.units.map(
              (u: {
                unitId: string;
                verdict: string;
                addressedAxisIds?: string[];
              }) => ({
                ...u,
                passageIds: undefined,
                evidence: [
                  {
                    passageId: 'P1',
                    quote:
                      'Le véhicule possède une autonomie mesurée de dix heures dans le protocole normalisé.',
                  },
                ],
                addressedAxisIds: u.addressedAxisIds ?? ['A1'],
                reason: 'Même mesure et même sujet.',
              }),
            ),
          });
        }
        return { response, durationMs: 1 };
      },
      embed: async ({ input }: { input: string[] }) => input.map(() => [1, 0]),
    } as never,
    search: {
      search: async () => {
        activity.searches++;
        return {
          creditsUsed: 2,
          evidence: [
            {
              title: 'Autonomie mesurée',
              url: 'https://example.com/autonomie',
              content: '',
              publishedAt: null,
            },
          ],
        };
      },
    } as never,
    pageReader: {
      fetchArticleDocument: async () => {
        activity.reads++;
        return {
          text: 'Le véhicule possède une autonomie mesurée de dix heures dans le protocole normalisé. Les conditions de mesure sont contrôlées et correspondent à une utilisation continue. Cette durée ne constitue pas une garantie dans toutes les conditions de circulation.',
          publishedAt: null,
        };
      },
    } as never,
  });
}
describe('safe synthesis publication', () => {
  const memory = {
    sources: [
      {
        id: 'S1',
        title: 'Autonomie mesurée',
        url: 'https://example.com/autonomie',
        retrievedAt: '2026-09-05T20:00:00Z',
      },
    ],
    passages: [
      {
        id: 'P1',
        sourceId: 'S1',
        text: 'Le véhicule possède une autonomie mesurée de dix heures dans le protocole normalisé.',
      },
    ],
  };
  it('returns stored links in one call without research or fabricated URLs', async () => {
    const activity = { searches: 0, reads: 0 };
    const result = await engine(
      [
        JSON.stringify({
          question: 'Donne les liens déjà trouvés.',
          action: 'links',
          sourceIds: ['S1'],
        }),
      ],
      undefined,
      activity,
    ).answer({
      ...input,
      content: 'Donne moi les liens que tu as trouvés',
      priorResearch: memory,
    });
    expect(result.modelCalls).toBe(1);
    expect(activity).toEqual({ searches: 0, reads: 0 });
    expect(result.sources[0]?.url).toBe(memory.sources[0]?.url);
    expect(result.markdown).toContain('[S1]');
  });
  it.each([true, false])(
    'reuses research with stored excerpts=%s and still audits new prose',
    async (hasExcerpts) => {
      const activity = { searches: 0, reads: 0 };
      const result = await engine(
        [
          JSON.stringify({
            question: 'Explique la mesure de l’autonomie.',
            action: 'reuse',
            sourceIds: ['S1'],
          }),
          plan,
          'Autonomie dix heures [P1].',
          JSON.stringify({ units: [{ unitId: 'U1', verdict: 'supported' }] }),
        ],
        undefined,
        activity,
      ).answer({
        ...input,
        priorResearch: {
          ...memory,
          passages: hasExcerpts ? memory.passages : [],
        },
      });
      expect(result.status).toBe('verified');
      expect(result.modelCalls).toBe(4);
      expect(activity).toEqual({ searches: 0, reads: hasExcerpts ? 0 : 1 });
      expect(result.researchMemory?.passages.length).toBeGreaterThan(0);
    },
  );
  it('complements earlier research when the continuation requires new evidence', async () => {
    const activity = { searches: 0, reads: 0 };
    const result = await engine(
      [
        JSON.stringify({
          question: 'Quelle autonomie actuelle ?',
          action: 'research',
          sourceIds: ['S1'],
        }),
        plan,
        'Autonomie dix heures [P1].',
        JSON.stringify({ units: [{ unitId: 'U1', verdict: 'supported' }] }),
      ],
      undefined,
      activity,
    ).answer({ ...input, priorResearch: memory });
    expect(activity.searches).toBeGreaterThan(0);
    expect(result.status).toBe('verified');
  });
  it('rejects an unknown source chosen by the continuation model', async () => {
    const activity = { searches: 0, reads: 0 };
    const result = await engine(
      [
        JSON.stringify({
          question: 'Donne les liens.',
          action: 'links',
          sourceIds: ['S999'],
        }),
        plan,
        'Autonomie dix heures [P1].',
        JSON.stringify({ units: [{ unitId: 'U1', verdict: 'supported' }] }),
      ],
      undefined,
      activity,
    ).answer({ ...input, priorResearch: memory });
    expect(activity.searches).toBeGreaterThan(0);
    expect(result.markdown).not.toContain('S999');
  });
  it('keeps the more complete accepted answer after a shorter audited revision', async () => {
    const first =
      'Autonomie dix heures [P1].\n\nMesure normalisée [P1].\n\nGarantie permanente [P1].';
    const shorter = 'Autonomie de dix heures [P1].';
    const result = await engine([
      plan,
      first,
      JSON.stringify({
        units: [
          { unitId: 'U1', verdict: 'supported' },
          { unitId: 'U2', verdict: 'supported' },
          { unitId: 'U3', verdict: 'unsupported' },
        ],
      }),
      shorter,
      JSON.stringify({ units: [{ unitId: 'U1', verdict: 'supported' }] }),
      shorter,
    ]).answer(input);
    expect(result.markdown).toContain('Mesure normalisée');
    expect(result.markdown).not.toContain('Garantie permanente');
    expect(result.status).toBe('partial');
  });
  it('prioritizes verified need coverage over the number of retained units', async () => {
    const twoAxes = JSON.parse(plan);
    twoAxes.axes.push({
      ...twoAxes.axes[0],
      id: 'A2',
      label: 'Conditions',
      question: 'Quelles conditions ?',
      query: 'conditions mesure',
    });
    const shorter =
      'Autonomie mesurée de dix heures [P1].\n\nMesure en continu [P1].\n\nConditions contrôlées [P1].';
    const result = await engine([
      JSON.stringify(twoAxes),
      'Autonomie dix heures [P1].\n\nMesure normalisée [P1].\n\nGarantie permanente [P1].',
      JSON.stringify({
        units: [
          { unitId: 'U1', verdict: 'supported', addressedAxisIds: ['A1'] },
          { unitId: 'U2', verdict: 'supported', addressedAxisIds: ['A2'] },
          { unitId: 'U3', verdict: 'unsupported' },
        ],
      }),
      shorter,
      JSON.stringify({
        units: ['U1', 'U2', 'U3'].map((unitId) => ({
          unitId,
          verdict: 'supported',
          addressedAxisIds: ['A1'],
        })),
      }),
      shorter,
    ]).answer(input);
    expect(result.coveredAxisCount).toBe(2);
    expect(result.markdown).toContain('Mesure normalisée');
  });
  it('audits a citation-only repair instead of treating it as a repeat', async () => {
    const result = await engine([
      plan,
      'Autonomie dix heures.',
      JSON.stringify({ units: [{ unitId: 'U1', verdict: 'unsupported' }] }),
      'Autonomie dix heures [P1].',
      JSON.stringify({ units: [{ unitId: 'U1', verdict: 'supported' }] }),
    ]).answer(input);
    expect(result.modelCalls).toBe(5);
    expect(result.status).toBe('verified');
    expect(result.sources).toHaveLength(1);
  });
  it.each([
    { failure: '{}', stage: 'auditing', code: 'SYNTHESIS_INVALID_AUDIT' },
    {
      failure: new Error('OLLAMA_CONTEXT_BUDGET_EXCEEDED'),
      stage: 'writing',
      code: 'OLLAMA_CONTEXT_BUDGET_EXCEEDED',
    },
    {
      failure: new Error('OLLAMA_UNAVAILABLE'),
      stage: 'auditing',
      code: 'OLLAMA_UNAVAILABLE',
    },
    { failure: '{broken', stage: 'auditing', code: 'SYNTHESIS_INVALID_AUDIT' },
    {
      failure: 'Autonomie dix heures [P99.Q1].',
      stage: 'writing',
      code: 'MODEL_OUTPUT_UNKNOWN_EXCERPT',
    },
    {
      failure: new Error('secret payload'),
      stage: 'writing',
      code: 'SYNTHESIS_UNEXPECTED_FAILURE',
    },
  ])(
    'reports $code at $stage without exposing raw errors',
    async ({ failure, stage, code }) => {
      const events: unknown[] = [];
      const result = await engine(
        [
          plan,
          ...(stage === 'auditing' ? ['Autonomie dix heures [P1].'] : []),
          failure,
        ],
        (event) => events.push(event),
      ).answer(input);
      expect(result.fallbackCode).toBe(code);
      expect(result.status).toBe('abstained');
      expect(events).toContainEqual({
        kind: 'failure',
        failure: { stage, attempt: 1, code },
      });
      expect(JSON.stringify(events)).not.toContain('secret payload');
      expect(result.markdown).not.toContain('secret payload');
    },
  );
  it('asks a resolvable clarification before searching or preparing sources', async () => {
    const clarification = 'Quels deux produits souhaitez-vous comparer ?';
    const candidate = engine([
      JSON.stringify({ ...JSON.parse(plan), clarification }),
    ]);
    const result = await candidate.answer({
      ...input,
      content: 'Compare ces deux produits.',
    });
    expect(result).toMatchObject({
      fallbackCode: 'CLARIFICATION_REQUIRED',
      markdown: clarification,
      modelCalls: 1,
      passageCount: 0,
    });
    expect(result.sources).toEqual([]);
  });
  it('keeps a stable Friday follow-up local after resolving its context', async () => {
    const responses = [
      JSON.stringify({
        standaloneQuestion: 'Explique la gravité simplement en français.',
      }),
      'La gravité est une attraction entre les objets qui ont une masse.',
    ];
    let searches = 0;
    const localEngine = new VerifiedChatEngine({
      pipeline: 'unified',
      ollama: {
        generate: async () => ({ response: responses.shift()!, durationMs: 1 }),
        embed: async () => {
          throw new Error('UNEXPECTED_EMBEDDING');
        },
      } as never,
      search: {
        search: async () => {
          searches++;
          throw new Error('UNEXPECTED_WEB_SEARCH');
        },
      } as never,
      pageReader: {
        fetchArticleDocument: async () => {
          throw new Error('UNEXPECTED_PAGE_READ');
        },
      } as never,
    });
    const result = await localEngine.answer({
      ...input,
      mode: 'friday',
      content: 'En français',
      priorTurns: [
        { role: 'user', content: 'Explique la gravité simplement.' },
      ],
    });
    expect(result.route).toBe('local_unverified');
    expect(result.modelCalls).toBe(2);
    expect(result.markdown).toContain('La gravité');
    expect(searches).toBe(0);
    expect(responses).toHaveLength(0);
  });

  it('reserves revision and final audit after context, plan, writing and first audit', async () => {
    const result = await engine([
      JSON.stringify({ standaloneQuestion: 'Et quelle autonomie mesurée ?' }),
      plan,
      'Autonomie cent heures [P1].',
      contradicted,
      'Autonomie dix heures [P1].',
      JSON.stringify({
        units: [{ unitId: 'U1', verdict: 'supported', passageIds: ['P1'] }],
      }),
    ]).answer({
      ...input,
      content: 'Et quelle autonomie mesurée ?',
      priorTurns: [
        { role: 'user', content: 'Parlons du véhicule et de son autonomie.' },
      ],
    });
    expect(result.modelCalls).toBe(6);
    expect(result.status).toBe('verified');
    expect(result.markdown).not.toContain('cent heures');
  });

  it('allows three useful corrections and audits the fourth draft', async () => {
    const result = await engine([
      plan,
      'Autonomie cent heures [P1].',
      contradicted,
      'Autonomie cinquante heures [P1].',
      contradicted,
      'Autonomie vingt heures [P1].',
      contradicted,
      'Autonomie dix heures [P1].',
      JSON.stringify({
        units: [{ unitId: 'U1', verdict: 'supported', passageIds: ['P1'] }],
      }),
    ]).answer(input);
    expect(result.modelCalls).toBe(9);
    expect(result.status).toBe('verified');
    expect(result.markdown).toContain('dix heures');
  });
  it('stops repeated drafts without spending another audit call', async () => {
    const responses = [
      plan,
      'Autonomie cent heures [P1].',
      contradicted,
      'Autonomie cent heures [P1].',
    ];
    const result = await engine(responses).answer(input);
    expect(result.modelCalls).toBe(4);
    expect(result.status).toBe('abstained');
    expect(responses).toHaveLength(0);
  });

  it('preserves the last accepted text when a contradictory revision cannot be audited', async () => {
    const first = JSON.stringify({
      units: [
        { unitId: 'U1', verdict: 'supported', passageIds: ['P1'] },
        { unitId: 'U2', verdict: 'contradicted', passageIds: ['P1'] },
      ],
    });
    const result = await engine([
      plan,
      'Autonomie dix heures [P1].\n\nAutonomie cent heures [P1].',
      first,
      'Autonomie cent heures [P1].',
      '{broken',
    ]).answer(input);
    expect(result.markdown).toContain('Autonomie dix heures');
    expect(result.markdown).not.toContain('cent heures');
    expect(result.fallbackCode).toBe('PARTIAL_SYNTHESIS');
  });

  it('never republishes a known contradiction after failed final audit', async () => {
    const result = await engine([
      plan,
      'Autonomie cent heures [P1].',
      contradicted,
      'Autonomie cent heures [P1].',
      '{broken',
    ]).answer(input);
    expect(result.status).toBe('abstained');
    expect(result.markdown).not.toContain('cent heures');
    expect(result.markdown).not.toContain('dix heures');
  });
  it('does not publish an unaudited draft after malformed audits', async () => {
    const result = await engine([
      plan,
      'Autonomie cent heures [P1].',
      '{broken',
      '{broken',
    ]).answer(input);
    expect(result.markdown).not.toContain('cent heures');
    expect(result.markdown).not.toContain('dix heures');
  });
  it('reports auditor transport failure without promoting excerpts', async () => {
    const result = await engine([
      plan,
      'Autonomie cent heures [P1].',
      new Error('OLLAMA_UNAVAILABLE'),
      new Error('OLLAMA_UNAVAILABLE'),
    ]).answer(input);
    expect(result.status).toBe('abstained');
    expect(result.markdown).not.toContain('dix heures');
  });
  it('recovers from revision failure without reviving rejected text', async () => {
    const result = await engine([
      plan,
      'Autonomie cent heures [P1].',
      contradicted,
      new Error('OLLAMA_UNAVAILABLE'),
    ]).answer(input);
    expect(result.status).toBe('abstained');
    expect(result.markdown).not.toContain('cent heures');
  });
});
