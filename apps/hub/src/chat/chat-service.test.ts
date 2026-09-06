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
  it('persists research across service restart, isolates conversations and deletes it with the conversation', async () => {
    const snapshot = {
      sources: [
        {
          id: 'S1',
          title: 'Source originale',
          url: 'https://example.com/source',
          retrievedAt: '2026-09-05T20:00:00Z',
        },
      ],
      passages: [
        {
          id: 'P1',
          sourceId: 'S1',
          text: 'Un extrait original conservé avec sa source.',
        },
      ],
    };
    const received: unknown[] = [];
    const adapter: ChatEngine = {
      answer: async ({ priorResearch }) => {
        received.push(priorResearch);
        return {
          markdown: 'Réponse sourcée.',
          status: 'verified',
          route: 'web_verified',
          retrievalMode: 'hybrid',
          sources: [],
          modelCalls: 1,
          passageCount: 1,
          researchMemory: snapshot,
        };
      },
    };
    const { service, database } = fixture(adapter);
    const conversation = service.createConversation('profile-a');
    service.start();
    const first = service.enqueue(
      'profile-a',
      conversation.id,
      '8c191f93-e9d5-4b59-a345-0b8a1905e010',
      'Recherche initiale',
    );
    expect((await waitCompleted(service, 'profile-a', first)).status).toBe(
      'completed',
    );
    service.stop();
    const resumed = new ChatService(database, adapter);
    resumed.start();
    const second = resumed.enqueue(
      'profile-a',
      conversation.id,
      '8c191f93-e9d5-4b59-a345-0b8a1905e011',
      'Précision',
    );
    await waitCompleted(resumed, 'profile-a', second);
    expect(received[1]).toEqual(snapshot);
    for (const [index, profile] of ['profile-a', 'profile-b'].entries()) {
      const other = resumed.createConversation(profile);
      const id = resumed.enqueue(
        profile,
        other.id,
        `8c191f93-e9d5-4b59-a345-0b8a1905e02${index}`,
        'Autre sujet',
      );
      await waitCompleted(resumed, profile, id);
      expect(received.at(-1)).toBeUndefined();
    }
    const messageIds = database
      .prepare('SELECT id FROM chat_messages WHERE conversation_id=?')
      .all(conversation.id) as { id: string }[];
    resumed.deleteConversation('profile-a', conversation.id);
    for (const message of messageIds)
      expect(
        database
          .prepare('SELECT * FROM chat_research_memory WHERE message_id=?')
          .get(message.id),
      ).toBeUndefined();
    resumed.stop();
  });
  it('recovers legacy source URLs without turning the old answer into evidence', async () => {
    const received: unknown[] = [];
    const { service } = fixture({
      answer: async ({ priorResearch }) => {
        received.push(priorResearch);
        return {
          markdown: 'Ancienne réponse non fiable.',
          status: 'verified',
          route: 'web_verified',
          retrievalMode: 'hybrid',
          modelCalls: 1,
          passageCount: 1,
          sources: [
            {
              id: 'S1',
              title: 'Source',
              url: 'https://example.com/source',
              domain: 'example.com',
              publishedAt: null,
              retrievedAt: '2026-09-05T20:00:00Z',
              evidenceLevel: 'readable',
            },
          ],
        };
      },
    });
    const conversation = service.createConversation('profile-a');
    service.start();
    for (let i = 0; i < 2; i++) {
      const id = service.enqueue(
        'profile-a',
        conversation.id,
        `8c191f93-e9d5-4b59-a345-0b8a1905e03${i}`,
        'Donne les liens',
      );
      await waitCompleted(service, 'profile-a', id);
    }
    expect(received[1]).toMatchObject({
      sources: [{ url: 'https://example.com/source' }],
      passages: [],
    });
    expect(JSON.stringify(received[1])).not.toContain('Ancienne réponse');
    service.stop();
  });
  it('expires an old queued request on restart without calling the model', async () => {
    let calls = 0;
    const { database, service } = fixture({
      answer: async () => {
        calls++;
        throw new Error('MUST_NOT_RUN');
      },
    });
    const conversation = service.createConversation('profile-a');
    const id = service.enqueue(
      'profile-a',
      conversation.id,
      '0b7797e0-b156-476b-bc77-5de0a91aac11',
      'Question en attente',
    );
    database
      .prepare('UPDATE chat_runs SET created_at=? WHERE id=?')
      .run(new Date(Date.now() - 301000).toISOString(), id);
    service.start();
    const result = await waitCompleted(service, 'profile-a', id);
    expect(result).toMatchObject({
      status: 'failed',
      errorCode: 'CHAT_DEADLINE_EXCEEDED',
      outcome: 'interrupted',
    });
    expect(calls).toBe(0);
    service.stop();
  });
  it('provides up to three prior exchanges to resolve follow-ups', async () => {
    let receivedTurns = 0;
    const { service } = fixture({
      answer: async ({ priorTurns }) => {
        receivedTurns = priorTurns.length;
        return {
          markdown: 'Réponse.',
          status: 'unverified',
          route: 'local_unverified',
          retrievalMode: 'none',
          sources: [],
          modelCalls: 1,
          passageCount: 0,
        };
      },
    });
    const conversation = service.createConversation('profile-a');
    service.start();
    for (let index = 0; index < 4; index += 1) {
      const runId = service.enqueue(
        'profile-a',
        conversation.id,
        `8c191f93-e9d5-4b59-a345-0b8a1905e00${index.toString()}`,
        `Question ${index.toString()}`,
      );
      await waitCompleted(service, 'profile-a', runId);
    }
    expect(receivedTurns).toBe(6);
    service.stop();
  });

  it('snapshots the selected mode and derives the title from the first message', async () => {
    let receivedMode: string | undefined;
    const { service } = fixture({
      answer: async ({ mode }) => {
        receivedMode = mode;
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
    });
    const conversation = service.createConversation(
      'profile-a',
      undefined,
      'local',
    );
    const runId = service.enqueue(
      'profile-a',
      conversation.id,
      '2872410c-96a4-48eb-8ae8-2e2a1ff35bc5',
      'Explique le fonctionnement de Friday',
    );
    expect(service.getRun('profile-a', runId).requestedMode).toBe('local');
    expect(service.listConversations('profile-a')[0]).toMatchObject({
      mode: 'local',
      title: 'Explique le fonctionnement de Friday',
    });
    service.start();
    await waitCompleted(service, 'profile-a', runId);
    expect(receivedMode).toBe('local');
    service.stop();
  });

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

  it('restores the active run for a conversation without crossing profiles', async () => {
    const { service } = fixture();
    const conversation = service.createConversation('profile-a');
    const runId = service.enqueue(
      'profile-a',
      conversation.id,
      '1b9bc583-57b4-4160-aebe-14fd580e624d',
      'Relance en cours',
    );
    expect(service.getActiveRun('profile-a', conversation.id)?.id).toBe(runId);
    expect(() => service.getActiveRun('profile-b', conversation.id)).toThrow(
      ChatNotFoundError,
    );
    service.start();
    await waitCompleted(service, 'profile-a', runId);
    expect(service.getActiveRun('profile-a', conversation.id)).toBeNull();
    service.stop();
  });

  it('persists only bounded axis counters and a safe fallback code', async () => {
    const { service } = fixture({
      answer: async () => ({
        markdown: 'Extraits non conclusifs.',
        status: 'abstained',
        route: 'web_verified',
        retrievalMode: 'hybrid',
        sources: [],
        modelCalls: 4,
        passageCount: 6,
        axisCount: 3,
        requiredAxisCount: 2,
        coveredAxisCount: 1,
        rejectedUnitCount: 4,
        discoveredPageCount: 12,
        readablePageCount: 5,
        rejectedPageCount: 7,
        leadCount: 3,
        fallbackCode: 'AUDIT_REJECTED_ALL',
      }),
    });
    const conversation = service.createConversation('profile-a');
    const runId = service.enqueue(
      'profile-a',
      conversation.id,
      'd94743f5-0a53-4e16-ae50-f370ed96cacb',
      'Question Web',
    );
    service.start();
    expect(await waitCompleted(service, 'profile-a', runId)).toMatchObject({
      status: 'completed',
      errorCode: 'AUDIT_REJECTED_ALL',
      axisCount: 3,
      requiredAxisCount: 2,
      coveredAxisCount: 1,
      rejectedUnitCount: 4,
      discoveredPageCount: 12,
      readablePageCount: 5,
      rejectedPageCount: 7,
      leadCount: 3,
    });
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

it('excludes future queued questions while pairing earlier replies causally', async () => {
  const inputs: Array<{
    content: string;
    priorTurns: Array<{ role: string; content: string }>;
  }> = [];
  const { service } = fixture({
    answer: async (input) => {
      inputs.push(input);
      return {
        markdown: `Réponse ${input.content}`,
        status: 'unverified',
        route: 'local_unverified',
        retrievalMode: 'none',
        sources: [],
        modelCalls: 1,
        passageCount: 0,
      };
    },
  });
  const conversation = service.createConversation('profile-a');
  const first = service.enqueue(
    'profile-a',
    conversation.id,
    '3696c79f-e213-4cd3-8aaa-b7582109a7b1',
    'Question 1',
  );
  const second = service.enqueue(
    'profile-a',
    conversation.id,
    '3696c79f-e213-4cd3-8aaa-b7582109a7b2',
    'Question 2',
  );
  service.start();
  await waitCompleted(service, 'profile-a', first);
  await waitCompleted(service, 'profile-a', second);
  expect(inputs[0]?.priorTurns).toEqual([]);
  expect(inputs[1]?.priorTurns.map(({ content }) => content)).toEqual([
    'Question 1',
    'Réponse Question 1',
  ]);
  service.stop();
});
