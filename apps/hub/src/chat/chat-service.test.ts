import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../db/database.js';
import {
  ChatNotFoundError,
  ChatService,
  type ChatEngine,
} from './chat-service.js';

const databases: ReturnType<typeof openDatabase>[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

function fixture(engine?: ChatEngine) {
  const database = openDatabase(':memory:');
  databases.push(database);
  const service = new ChatService(
    database,
    engine ?? {
      answer: async ({ updateStage }) => {
        updateStage('writing');
        return {
          markdown: 'Réponse locale.',
          status: 'unverified',
          route: 'local_unverified',
          retrievalMode: 'none',
          sources: [],
          modelCalls: 1,
          passageCount: 0,
        };
      },
    },
  );
  return { database, service };
}

async function waitCompleted(
  service: ChatService,
  profileId: string,
  runId: string,
) {
  for (let index = 0; index < 100; index += 1) {
    const run = service.getRun(profileId, runId);
    if (['completed', 'failed', 'cancelled'].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error('TEST_RUN_TIMEOUT');
}

describe('ChatService', () => {
  it('keeps conversations private and enqueues idempotently', async () => {
    const { service } = fixture();
    const conversation = service.createConversation('profile-a');
    expect(() => service.getMessages('profile-b', conversation.id)).toThrow(
      ChatNotFoundError,
    );
    const clientRequestId = '3696c79f-e213-4cd3-8aaa-b7582109a7b2';
    const first = service.enqueue(
      'profile-a',
      conversation.id,
      clientRequestId,
      'Bonjour',
    );
    const second = service.enqueue(
      'profile-a',
      conversation.id,
      clientRequestId,
      'Ignoré',
    );
    expect(second).toBe(first);
    service.start();
    expect((await waitCompleted(service, 'profile-a', first)).status).toBe(
      'completed',
    );
    expect(
      service.getMessages('profile-a', conversation.id).messages,
    ).toHaveLength(2);
    service.stop();
  });

  it('recovers interrupted runs once without duplicating the user message', async () => {
    const { database, service } = fixture();
    const conversation = service.createConversation('profile-a');
    const runId = service.enqueue(
      'profile-a',
      conversation.id,
      '9bf498ea-0c55-44de-adb1-0d6e7591f22d',
      'Reprise',
    );
    database
      .prepare("UPDATE chat_runs SET status = 'running' WHERE id = ?")
      .run(runId);
    const recovered = new ChatService(database, {
      answer: async () => ({
        markdown: 'Repris.',
        status: 'unverified',
        route: 'local_unverified',
        retrievalMode: 'none',
        sources: [],
        modelCalls: 1,
        passageCount: 0,
      }),
    });
    recovered.start();
    expect((await waitCompleted(recovered, 'profile-a', runId)).status).toBe(
      'completed',
    );
    expect(
      recovered
        .getMessages('profile-a', conversation.id)
        .messages.map(({ role }) => role),
    ).toEqual(['user', 'assistant']);
    service.stop();
    recovered.stop();
  });

  it('cancels an active inference through AbortSignal', async () => {
    let started: (() => void) | undefined;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const { service } = fixture({
      answer: async ({ signal }) => {
        started?.();
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Cancelled', 'AbortError')),
            { once: true },
          );
        });
        throw new Error('UNREACHABLE');
      },
    });
    const conversation = service.createConversation('profile-a');
    const runId = service.enqueue(
      'profile-a',
      conversation.id,
      '00a7464b-e626-4487-a2fb-5d24fe51bcdc',
      'Annule',
    );
    service.start();
    await running;
    service.cancelRun('profile-a', runId);
    expect((await waitCompleted(service, 'profile-a', runId)).status).toBe(
      'cancelled',
    );
    service.stop();
  });
});
