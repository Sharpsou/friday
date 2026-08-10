import { afterEach, describe, expect, it } from 'vitest';

import type { AssistantEngine } from './assistant-engine.js';
import {
  AssistantNotFoundError,
  AssistantService,
} from './assistant-service.js';
import { openDatabase } from '../db/database.js';

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
    planQueries: async () => ['requête publique'],
    answerClassic: async (history) => ({
      content: `Réponse: ${history.at(-1)?.content ?? ''}`,
      sources: [],
    }),
    answerWeb: async () => ({ content: 'Réponse Web [S1]', sources: [] }),
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

  function createService(engine = fakeEngine()) {
    const database = openDatabase(':memory:');
    databases.push(database);
    const service = new AssistantService(database, engine);
    services.push(service);
    return service;
  }

  it('persists a classic conversation and handles duplicate client requests idempotently', async () => {
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
    expect(duplicate.message.id).toBe(first.message.id);

    await waitFor(
      () => service.getRun(PROFILE_ONE, first.run.id).status === 'completed',
    );
    const state = service.getMessages(PROFILE_ONE, conversation.id);
    expect(state.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
    ]);
    expect(state.messages[1]?.content).toBe('Réponse: Bonjour Gemma');
  });

  it('generates a semantic title only for the first exchange of a default conversation', async () => {
    let titleCalls = 0;
    const service = createService(
      fakeEngine({
        generateTitle: async (_input, mode, depth) => {
          titleCalls += 1;
          expect(mode).toBe('classic');
          expect(depth).toBeNull();
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
        answerClassic: async (history) => {
          const content = history.at(-1)?.content ?? '';
          order.push(content);
          calls += 1;
          if (calls === 1) await gate.promise;
          return { content: `ok:${content}`, sources: [] };
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
        answerClassic: async (_history, signal) => {
          started.resolve();
          await new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), {
              once: true,
            });
          });
          return { content: 'partiel', sources: [] };
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

  it('releases the worker while a personal Web query waits for consent', async () => {
    let webCalls = 0;
    const service = createService(
      fakeEngine({
        planQueries: async () => ['adresse test@example.com'],
        answerWeb: async () => {
          webCalls += 1;
          return { content: 'Réponse autorisée', sources: [] };
        },
      }),
    );
    const conversation = service.createConversation(
      PROFILE_ONE,
      'Consentement',
    );
    const submission = service.submit(PROFILE_ONE, conversation.id, {
      clientRequestId: '55555555-5555-4555-8555-555555555555',
      content: 'Recherche cette adresse',
      mode: 'web',
      webDepth: 'deep',
    });

    await waitFor(
      () =>
        service.getRun(PROFILE_ONE, submission.run.id).status ===
        'awaiting_search_consent',
    );
    expect(webCalls).toBe(0);
    service.consent(PROFILE_ONE, submission.run.id, true, [
      'requête anonymisée',
    ]);
    await waitFor(
      () =>
        service.getRun(PROFILE_ONE, submission.run.id).status === 'completed',
    );
    expect(webCalls).toBe(1);
  });

  it('uses the direct question for fast Web and plans deep Web queries', async () => {
    const planned: string[] = [];
    const answered: Array<{ depth: string; queries: string[] }> = [];
    const service = createService(
      fakeEngine({
        planQueries: async (input) => {
          planned.push(input);
          return ['requête planifiée'];
        },
        answerWeb: async (_history, queries, _signal, _onStage, depth) => {
          answered.push({ depth, queries });
          return { content: 'Réponse', sources: [] };
        },
      }),
    );
    const fast = service.createConversation(PROFILE_ONE, 'Rapide');
    const deep = service.createConversation(PROFILE_ONE, 'Approfondi');
    const fastRun = service.submit(PROFILE_ONE, fast.id, {
      clientRequestId: '77777777-7777-4777-8777-777777777777',
      content: 'Quel temps fait-il à Paris ?',
      mode: 'web',
      webDepth: 'fast',
    });
    const deepRun = service.submit(PROFILE_ONE, deep.id, {
      clientRequestId: '88888888-8888-4888-8888-888888888888',
      content: 'Compare les prévisions en détail',
      mode: 'web',
      webDepth: 'deep',
    });

    await waitFor(
      () =>
        service.getRun(PROFILE_ONE, fastRun.run.id).status === 'completed' &&
        service.getRun(PROFILE_ONE, deepRun.run.id).status === 'completed',
    );

    expect(planned).toEqual(['Compare les prévisions en détail']);
    expect(answered).toEqual([
      { depth: 'fast', queries: ['Quel temps fait-il à Paris ?'] },
      { depth: 'deep', queries: ['requête planifiée'] },
    ]);
    expect(service.getRun(PROFILE_ONE, fastRun.run.id).webDepth).toBe('fast');
    expect(service.getRun(PROFILE_ONE, deepRun.run.id).webDepth).toBe('deep');
  });

  it('keeps a failed run visible when no assistant response was committed', async () => {
    const service = createService(
      fakeEngine({
        answerClassic: async () => {
          throw new Error('Erreur de génération visible');
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
      error: { message: 'Erreur de génération visible' },
    });
  });
});
