import { describe, expect, it } from 'vitest';

import {
  normalizeGeneratedMarkdown,
  routeForcedByMode,
  VerifiedChatEngine,
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
    expect(normalizeGeneratedMarkdown('Version [P1, P3; P8].')).toBe(
      'Version [P1] [P3] [P8].',
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

function axesEngine(responses: string[]) {
  return new VerifiedChatEngine({
    axesEnabled: true,
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
      importance: 'required',
      query: 'autonomie mesurée protocole',
    },
  ],
});

describe('axis verified pipeline', () => {
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
            importance: 'required',
            query: 'James Webb découvertes 2026',
          },
        ],
      }),
      'Une découverte de James Webb a été publiée en 2026 [P1].',
      JSON.stringify({
        units: [{ unitId: 'U1', verdict: 'supported', passageIds: ['P1'] }],
        axes: [{ axisId: 'A1', coverage: 'covered', passageIds: ['P1'] }],
        usefulness: 'answers',
        missingAspects: [],
        evidenceSufficiency: 'sufficient',
      }),
    ];
    const engine = new VerifiedChatEngine({
      axesEnabled: true,
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
    expect(searched[0]).toBe(
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
        units: [{ unitId: 'U1', verdict: 'supported', passageIds: ['P1'] }],
        axes: [{ axisId: 'A1', coverage: 'covered', passageIds: ['P1'] }],
        usefulness: 'answers',
        missingAspects: [],
        evidenceSufficiency: 'sufficient',
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

  it('masks a fully rejected draft and shows only a sourced doubt dossier', async () => {
    const rejectedAudit = JSON.stringify({
      units: [{ unitId: 'U1', verdict: 'unsupported', passageIds: [] }],
      axes: [{ axisId: 'A1', coverage: 'missing', passageIds: [] }],
      usefulness: 'misses',
      missingAspects: ['mesure confirmée'],
      evidenceSufficiency: 'sufficient',
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
