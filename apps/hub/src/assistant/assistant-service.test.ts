import { afterEach, describe, expect, it } from 'vitest';

import type { AssistantEngine } from './assistant-engine.js';
import {
  AssistantNotFoundError,
  AssistantService,
} from './assistant-service.js';
import { openDatabase } from '../db/database.js';
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
  ) {
    const database = openDatabase(':memory:');
    databases.push(database);
    const service = new AssistantService(database, engine, tavily);
    services.push(service);
    return service;
  }

  it('persists a classic conversation and handles duplicate requests idempotently', async () => {
    const service = createService();
    const conversation = service.createConversation(PROFILE_ONE, 'Privé');
    const input = {
      clientRequestId: '71bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
      content: 'Bonjour Gemma',
      mode: 'classic' as const,
    };

    const first = service.submit(PROFILE_ONE, conversation.id, input);
    const duplicate = service.submit(PROFILE_ONE, conversation.id, input);
    expect(duplicate.run.id).toBe(first.run.id);

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
      sources: [],
    });
  });

  it('uses the light Web budget, persists sources and verifies the answer', async () => {
    let verifyCalls = 0;
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
        verifyAnswer: async () => {
          verifyCalls += 1;
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
      researchOutcome: 'completed',
      creditsUsed: 2,
    });
    expect(state.messages.at(-1)?.sources).toHaveLength(1);
    expect(
      state.messages.at(-1)?.progressEvents.map((event) => event.label),
    ).toEqual(
      expect.arrayContaining([
        'Analyse de la demande et décision Web',
        'Plan Web prêt · 2 recherche(s) ciblée(s)',
        'Recherche 1/2 · basic · fait récent',
        'Recherche 1/2 terminée · 1 nouvelle(s) source(s)',
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
  });

  it('uses Gemma to title only the first exchange of a default conversation', async () => {
    let titleCalls = 0;
    const service = createService(
      fakeEngine({
        generateTitle: async () => {
          titleCalls += 1;
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

  it('resumes a paused generation without losing its run history', async () => {
    const started = deferred();
    let calls = 0;
    const service = createService(
      fakeEngine({
        answer: async (_history, signal) => {
          calls += 1;
          if (calls === 1) {
            started.resolve();
            await new Promise((_resolve, reject) => {
              signal.addEventListener('abort', () => reject(signal.reason), {
                once: true,
              });
            });
          }
          return { content: 'réponse reprise' };
        },
      }),
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

    service.retry(PROFILE_ONE, submission.run.id);
    await waitFor(
      () =>
        service.getRun(PROFILE_ONE, submission.run.id).status === 'completed',
    );

    const state = service.getMessages(PROFILE_ONE, conversation.id);
    expect(state.messages.at(-1)?.content).toBe('réponse reprise');
    expect(
      state.messages.at(-1)?.progressEvents.map((event) => event.status),
    ).toEqual(
      expect.arrayContaining(['cancelled', 'queued', 'writing', 'completed']),
    );
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
