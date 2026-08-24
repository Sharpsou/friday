import { afterEach, describe, expect, it } from 'vitest';

import type { AssistantEngine } from './assistant-engine.js';
import {
  AssistantNotFoundError,
  AssistantService,
} from './assistant-service.js';
import { openDatabase } from '../db/database.js';
import { ExaMcpSearchClient } from './exa-mcp-search.js';
import { TavilySearchClient } from './tavily-search.js';

const PROFILE_ONE = 'f61f8f8b-8d09-4575-8e83-357618e881ac';
const PROFILE_TWO = '6b0db27d-443d-4dd2-9a21-b809384f2f13';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitFor(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs)
      throw new Error('Test Assistant expiré.');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function fakeEngine(overrides: Partial<AssistantEngine> = {}): AssistantEngine {
  return {
    generateTitle: async () => 'Titre automatique',
    answer: async (history) => ({
      content: `Réponse: ${history.at(-1)?.content ?? ''}`,
    }),
    ...overrides,
  };
}

describe('AssistantService', () => {
  const services: AssistantService[] = [];
  const databases: ReturnType<typeof openDatabase>[] = [];

  afterEach(async () => {
    await Promise.all(
      services.splice(0).map(async (service) => service.stop()),
    );
    for (const database of databases.splice(0)) database.close();
  });

  function createService(
    engine = fakeEngine(),
    tavily = new TavilySearchClient(undefined),
    exa = new ExaMcpSearchClient(),
  ) {
    const database = openDatabase(':memory:');
    databases.push(database);
    const service = new AssistantService(database, engine, tavily, exa);
    services.push(service);
    return service;
  }

  it('persists a classic conversation and handles duplicate requests idempotently', async () => {
    let selectedModel: string | undefined;
    const service = createService(
      fakeEngine({
        answer: async (history, _signal, options) => {
          selectedModel = options?.model;
          return { content: `Réponse: ${history.at(-1)?.content ?? ''}` };
        },
      }),
    );
    const conversation = service.createConversation(PROFILE_ONE, 'Privé');
    const input = {
      clientRequestId: '71bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
      content: 'Bonjour Gemma',
      mode: 'classic' as const,
      model: 'qwen3.5' as const,
      thinkingPolicy: 'forced' as const,
    };

    const first = service.submit(PROFILE_ONE, conversation.id, input);
    const duplicate = service.submit(PROFILE_ONE, conversation.id, input);
    expect(duplicate.run.id).toBe(first.run.id);
    expect(first.run.thinkingPolicy).toBe('auto');

    await waitFor(
      () => service.getRun(PROFILE_ONE, first.run.id).status === 'completed',
    );
    const state = service.getMessages(PROFILE_ONE, conversation.id);
    expect(state.messages.map((item) => item.role)).toEqual([
      'user',
      'assistant',
    ]);
    expect(state.messages[1]).toMatchObject({
      content: 'Réponse: Bonjour Gemma',
      effectiveMode: 'classic',
      model: 'qwen3.5',
      thinkingPolicy: 'auto',
      sources: [],
    });
    expect(selectedModel).toBe('qwen3.5');
  });

  it('uses the light Web budget, persists sources and verifies the answer', async () => {
    let verifyCalls = 0;
    let verifiedQuestion = '';
    const fetcher = async (input: Parameters<typeof fetch>[0]) =>
      new Response(
        String(input).endsWith('/usage')
          ? JSON.stringify({
              account: { plan_usage: 0, plan_limit: 1_000 },
            })
          : JSON.stringify({
              results: [
                {
                  title: 'Source officielle',
                  url: 'https://example.com/fait',
                  content: 'Fait vérifié',
                },
              ],
              usage: { credits: 1 },
            }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    const service = createService(
      fakeEngine({
        planResearch: async () => ({
          searchNeeded: true,
          queries: ['fait récent', 'confirmation indépendante'],
        }),
        answer: async (_history, _signal, options) => ({
          content: `Brouillon ${options?.evidence?.length.toString()}`,
          thinkingUsed: true,
        }),
        verifyAnswer: async (question) => {
          verifyCalls += 1;
          verifiedQuestion = question;
          return { content: 'Réponse vérifiée [S1]', thinkingUsed: true };
        },
      }),
      new TavilySearchClient('test', fetcher),
    );
    const conversation = service.createConversation(
      PROFILE_ONE,
      'Actualité',
      'web_light',
    );
    const submission = service.submit(PROFILE_ONE, conversation.id, {
      clientRequestId: '91bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
      content: 'Quel est le fait récent ?',
      mode: 'web_light',
      thinkingPolicy: 'auto',
    });

    await waitFor(
      () =>
        service.getRun(PROFILE_ONE, submission.run.id).status === 'completed',
    );
    const state = service.getMessages(PROFILE_ONE, conversation.id);
    expect(state.messages.at(-1)).toMatchObject({
      content: 'Réponse vérifiée [S1]',
      effectiveMode: 'web',
      mode: 'web_light',
      thinkingUsed: true,
      researchOutcome: 'partial',
      creditsUsed: 2,
    });
    expect(state.messages.at(-1)?.sources).toHaveLength(1);
    expect(
      state.messages.at(-1)?.progressEvents.map((event) => event.label),
    ).toEqual(
      expect.arrayContaining([
        'Analyse de la demande et décision Web',
        'Plan Web prêt · 2 recherche(s) ciblée(s)',
        'Tavily 1/2 · basic · fait récent',
        'Tavily terminé · 1 nouvelle(s) source(s)',
        'Lecture et rapprochement de 1 source(s)',
        'Synthèse de 1 source(s)',
        'Réflexion approfondie utilisée',
        'Vérification des affirmations',
        'Terminé',
      ]),
    );
    expect((await service.webUsage()).creditsUsed).toBe(2);
    expect((await service.webUsage()).remainingBasicSearches).toBe(948);
    expect(verifyCalls).toBe(1);
    expect(verifiedQuestion).toBe('Quel est le fait récent ?');
  });

  it('forces deep Web and starts Tavily and anonymous Exa MCP in parallel', async () => {
    const bothStarted = deferred();
    let started = 0;
    let exaCalls = 0;
    const gate = async () => {
      started += 1;
      if (started === 2) bothStarted.resolve();
      await bothStarted.promise;
    };
    const tavily = new TavilySearchClient('test', async (input) => {
      if (String(input).endsWith('/usage'))
        return new Response(
          JSON.stringify({ account: { plan_usage: 0, plan_limit: 1_000 } }),
        );
      await gate();
      return new Response(
        JSON.stringify({
          results: [
            {
              title: 'Tavily',
              url: 'https://primary.example/source',
              content: 'primaire',
            },
          ],
          usage: { credits: 1 },
        }),
      );
    });
    const exa = new ExaMcpSearchClient(async () => {
      exaCalls += 1;
      await gate();
      return new Response(
        JSON.stringify({
          result: {
            content: [
              {
                type: 'text',
                text: [
                  'Title: Exa 1\nURL: https://exa-one.example/a\nPublished: N/A\nHighlights:\nun',
                  'Title: Exa 2\nURL: https://exa-two.example/b\nPublished: N/A\nHighlights:\ndeux',
                  'Title: Exa 3\nURL: https://exa-three.example/c\nPublished: N/A\nHighlights:\ntrois',
                ].join('\n\n---\n\n'),
              },
            ],
          },
        }),
      );
    });
    const service = createService(
      fakeEngine({
        planResearch: async () => ({
          searchNeeded: false,
          queries: ['vérification internet explicite'],
        }),
        answer: async (_history, _signal, options) => ({
          content: `Réponse fondée sur ${options?.evidence?.length.toString()} sources`,
        }),
      }),
      tavily,
      exa,
    );
    const conversation = service.createConversation(
      PROFILE_ONE,
      'Recherche profonde',
      'web_deep',
    );
    const submission = service.submit(PROFILE_ONE, conversation.id, {
      clientRequestId: '91919191-e269-46b3-9ac7-1c8cb7b310bb',
      content: 'Regarde sur Internet',
      mode: 'web_deep',
    });

    await waitFor(
      () =>
        service.getRun(PROFILE_ONE, submission.run.id).status === 'completed',
    );
    const answer = service
      .getMessages(PROFILE_ONE, conversation.id)
      .messages.at(-1);
    expect(started).toBe(2);
    expect(exaCalls).toBe(1);
    expect(answer?.content).toBe('Réponse fondée sur 4 sources');
    expect(answer?.sources).toHaveLength(4);
    expect(service.exaUsage()).toMatchObject({ calls: 1, successes: 1 });
    expect(
      service.researchDiagnostics(PROFILE_ONE, conversation.id).diagnostics,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: 'tavily', status: 'success' }),
        expect.objectContaining({
          provider: 'exa',
          status: 'success',
          calls: 1,
        }),
      ]),
    );
  });

  it('stops before a second Exa call after an anonymous rate limit', async () => {
    let exaCalls = 0;
    const exa = new ExaMcpSearchClient(async () => {
      exaCalls += 1;
      return new Response('limited', { status: 429 });
    });
    const tavily = new TavilySearchClient(
      'test',
      async (input) =>
        new Response(
          String(input).endsWith('/usage')
            ? JSON.stringify({
                account: { plan_usage: 0, plan_limit: 1_000 },
              })
            : JSON.stringify({
                results: [
                  {
                    title: 'Tavily seulement',
                    url: 'https://only.example/source',
                    content: 'source',
                  },
                ],
                usage: { credits: 1 },
              }),
        ),
    );
    const service = createService(
      fakeEngine({
        planResearch: async () => ({
          searchNeeded: true,
          queries: ['exploration', 'lacune'],
        }),
      }),
      tavily,
      exa,
    );
    const conversation = service.createConversation(
      PROFILE_ONE,
      'Limite Exa',
      'web_deep',
    );
    const submission = service.submit(PROFILE_ONE, conversation.id, {
      clientRequestId: '92929292-e269-46b3-9ac7-1c8cb7b310bb',
      content: 'Recherche approfondie',
      mode: 'web_deep',
    });

    await waitFor(
      () =>
        service.getRun(PROFILE_ONE, submission.run.id).status === 'completed',
    );
    expect(exaCalls).toBe(1);
    expect(service.exaUsage()).toMatchObject({
      calls: 1,
      rateLimits: 1,
      status: 'rate_limited',
    });
  });

  it('adds one adaptive Exa gap call when the first pass lacks coverage', async () => {
    let exaCalls = 0;
    const exa = new ExaMcpSearchClient(async () => {
      exaCalls += 1;
      const text =
        exaCalls === 1
          ? 'No search results found. Please try a different query.'
          : 'Title: Complément Exa\nURL: https://complement.example/fait\nPublished: N/A\nHighlights:\ncomplément';
      return new Response(
        JSON.stringify({ result: { content: [{ type: 'text', text }] } }),
      );
    });
    const tavily = new TavilySearchClient(
      'test',
      async (input) =>
        new Response(
          String(input).endsWith('/usage')
            ? JSON.stringify({
                account: { plan_usage: 0, plan_limit: 1_000 },
              })
            : JSON.stringify({ results: [], usage: { credits: 1 } }),
        ),
    );
    const service = createService(
      fakeEngine({
        planResearch: async () => ({
          searchNeeded: true,
          queries: ['exploration étroite', 'lacune ciblée'],
        }),
      }),
      tavily,
      exa,
    );
    const conversation = service.createConversation(
      PROFILE_ONE,
      'Complément Exa',
      'web_deep',
    );
    const submission = service.submit(PROFILE_ONE, conversation.id, {
      clientRequestId: '93939393-e269-46b3-9ac7-1c8cb7b310bb',
      content: 'Approfondis',
      mode: 'web_deep',
    });

    await waitFor(
      () =>
        service.getRun(PROFILE_ONE, submission.run.id).status === 'completed',
    );
    expect(exaCalls).toBe(2);
    expect(service.exaUsage()).toMatchObject({
      calls: 2,
      successes: 1,
      emptyResults: 1,
    });
  });

  it('uses the selected model to title only the first exchange', async () => {
    let titleCalls = 0;
    let titleModel: string | undefined;
    const service = createService(
      fakeEngine({
        generateTitle: async (_input, _signal, model) => {
          titleCalls += 1;
          titleModel = model;
          return 'Organisation voyage familial';
        },
      }),
    );
    const conversation = service.createConversation(
      PROFILE_ONE,
      'Nouvelle conversation',
    );
    const submission = service.submit(PROFILE_ONE, conversation.id, {
      clientRequestId: '99999999-9999-4999-8999-999999999999',
      content: 'Aide-moi à organiser notre prochain voyage en famille',
      mode: 'classic',
    });

    await waitFor(
      () =>
        service.getRun(PROFILE_ONE, submission.run.id).status === 'completed',
    );
    expect(service.listConversations(PROFILE_ONE)[0]?.title).toBe(
      'Organisation voyage familial',
    );
    expect(titleCalls).toBe(1);
    expect(titleModel).toBe('qwen3.5');
  });

  it('passes the complete conversation history to every new answer', async () => {
    const histories: string[][] = [];
    const service = createService(
      fakeEngine({
        answer: async (history) => {
          histories.push(history.map((message) => message.content));
          return { content: `réponse ${histories.length.toString()}` };
        },
      }),
    );
    const conversation = service.createConversation(PROFILE_ONE, 'Mémoire');
    const first = service.submit(PROFILE_ONE, conversation.id, {
      clientRequestId: 'a1111111-1111-4111-8111-111111111111',
      content: 'Je préfère le bleu.',
      mode: 'local',
      thinkingPolicy: 'auto',
    });
    await waitFor(
      () => service.getRun(PROFILE_ONE, first.run.id).status === 'completed',
    );
    const second = service.submit(PROFILE_ONE, conversation.id, {
      clientRequestId: 'a2222222-2222-4222-8222-222222222222',
      content: 'Quelle couleur ai-je choisie ?',
      mode: 'local',
      thinkingPolicy: 'auto',
    });
    await waitFor(
      () => service.getRun(PROFILE_ONE, second.run.id).status === 'completed',
    );

    expect(histories[1]).toEqual([
      'Je préfère le bleu.',
      'réponse 1',
      'Quelle couleur ai-je choisie ?',
    ]);
  });

  it('does not expose another profile’s conversations or runs', () => {
    const service = createService();
    const conversation = service.createConversation(PROFILE_ONE, 'Secret');
    const submission = service.submit(PROFILE_ONE, conversation.id, {
      clientRequestId: '61bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
      content: 'Information privée',
      mode: 'classic',
    });

    expect(service.listConversations(PROFILE_TWO)).toEqual([]);
    expect(() => service.getMessages(PROFILE_TWO, conversation.id)).toThrow(
      AssistantNotFoundError,
    );
    expect(() => service.getRun(PROFILE_TWO, submission.run.id)).toThrow(
      AssistantNotFoundError,
    );
  });

  it('alternates profiles while preserving each profile FIFO order', async () => {
    const gate = deferred();
    const order: string[] = [];
    let calls = 0;
    const service = createService(
      fakeEngine({
        answer: async (history) => {
          const content = history.at(-1)?.content ?? '';
          order.push(content);
          calls += 1;
          if (calls === 1) await gate.promise;
          return { content: `ok:${content}` };
        },
      }),
    );
    const oneA = service.createConversation(PROFILE_ONE, '1A');
    const oneB = service.createConversation(PROFILE_ONE, '1B');
    const twoA = service.createConversation(PROFILE_TWO, '2A');
    service.submit(PROFILE_ONE, oneA.id, {
      clientRequestId: '11111111-1111-4111-8111-111111111111',
      content: '1A',
      mode: 'classic',
    });
    await waitFor(() => order.length === 1);
    service.submit(PROFILE_ONE, oneB.id, {
      clientRequestId: '22222222-2222-4222-8222-222222222222',
      content: '1B',
      mode: 'classic',
    });
    service.submit(PROFILE_TWO, twoA.id, {
      clientRequestId: '33333333-3333-4333-8333-333333333333',
      content: '2A',
      mode: 'classic',
    });
    gate.resolve();

    await waitFor(() => order.length === 3);
    expect(order).toEqual(['1A', '2A', '1B']);
  });

  it('cancels an active generation without committing a partial response', async () => {
    const started = deferred();
    const service = createService(
      fakeEngine({
        answer: async (_history, signal) => {
          started.resolve();
          await new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), {
              once: true,
            });
          });
          return { content: 'partiel' };
        },
      }),
    );
    const conversation = service.createConversation(PROFILE_ONE, 'Annulation');
    const submission = service.submit(PROFILE_ONE, conversation.id, {
      clientRequestId: '44444444-4444-4444-8444-444444444444',
      content: 'Long',
      mode: 'classic',
    });
    await started.promise;
    service.cancel(PROFILE_ONE, submission.run.id);

    await waitFor(
      () =>
        service.getRun(PROFILE_ONE, submission.run.id).status === 'cancelled',
    );
    expect(
      service.getMessages(PROFILE_ONE, conversation.id).messages,
    ).toHaveLength(1);
  });

  it('resumes a paused generation with the newly selected conversation mode', async () => {
    const started = deferred();
    let calls = 0;
    let resumedMode: string | undefined;
    const service = createService(
      fakeEngine({
        planResearch: async () => ({
          searchNeeded: false,
          queries: ['réponse reprise'],
        }),
        answer: async (_history, signal, options) => {
          calls += 1;
          if (calls === 1) {
            started.resolve();
            await new Promise((_resolve, reject) => {
              signal.addEventListener('abort', () => reject(signal.reason), {
                once: true,
              });
            });
          }
          resumedMode = options?.mode;
          return { content: 'réponse reprise' };
        },
      }),
      new TavilySearchClient(
        'test',
        async (input) =>
          new Response(
            String(input).endsWith('/usage')
              ? JSON.stringify({
                  account: { plan_usage: 0, plan_limit: 1_000 },
                })
              : JSON.stringify({
                  results: [
                    {
                      title: 'Source reprise',
                      url: 'https://example.com/reprise',
                      content: 'Source disponible',
                    },
                  ],
                  usage: { credits: 1 },
                }),
            { status: 200 },
          ),
      ),
    );
    const conversation = service.createConversation(PROFILE_ONE, 'Reprise');
    const submission = service.submit(PROFILE_ONE, conversation.id, {
      clientRequestId: '55555555-5555-4555-8555-555555555555',
      content: 'Long',
      mode: 'classic',
    });
    await started.promise;
    service.cancel(PROFILE_ONE, submission.run.id);
    await waitFor(
      () =>
        service.getRun(PROFILE_ONE, submission.run.id).status === 'cancelled',
    );

    service.updateConversation(PROFILE_ONE, conversation.id, {
      mode: 'web_light',
    });
    const resumed = service.retry(PROFILE_ONE, submission.run.id);
    expect(resumed).toMatchObject({
      mode: 'web_light',
      requestedMode: 'web',
      webDepth: 'fast',
    });
    await waitFor(
      () =>
        service.getRun(PROFILE_ONE, submission.run.id).status === 'completed',
    );

    const state = service.getMessages(PROFILE_ONE, conversation.id);
    expect(state.messages.at(-1)?.content).toContain('réponse reprise');
    expect(state.messages.at(-1)?.mode).toBe('web_light');
    expect(resumedMode).toBe('web_light');
    expect(
      state.messages.at(-1)?.progressEvents.map((event) => event.status),
    ).toEqual(
      expect.arrayContaining(['cancelled', 'queued', 'writing', 'completed']),
    );
    expect(
      state.messages.at(-1)?.progressEvents.map((event) => event.label),
    ).toContain('Reprise en Web léger · ancien traitement écarté');
    expect(calls).toBe(2);
  });

  it('keeps a failed local run visible when no response was committed', async () => {
    const service = createService(
      fakeEngine({
        answer: async () => {
          throw new Error('Ollama local indisponible');
        },
      }),
    );
    const conversation = service.createConversation(PROFILE_ONE, 'Échec');
    const submission = service.submit(PROFILE_ONE, conversation.id, {
      clientRequestId: '66666666-6666-4666-8666-666666666666',
      content: 'Question',
      mode: 'classic',
    });

    await waitFor(
      () => service.getRun(PROFILE_ONE, submission.run.id).status === 'failed',
    );
    expect(
      service.getMessages(PROFILE_ONE, conversation.id).activeRun,
    ).toMatchObject({
      status: 'failed',
      error: { message: 'Ollama local indisponible' },
    });
  });
});
