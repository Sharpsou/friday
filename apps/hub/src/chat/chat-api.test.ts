import { afterEach, describe, expect, it } from 'vitest';

import { buildHub } from '../app.js';

const apps: Awaited<ReturnType<typeof buildHub>>[] = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

function cookieFrom(response: {
  headers: Record<string, number | string | string[] | undefined>;
}): string {
  const value = response.headers['set-cookie'];
  const values = Array.isArray(value) ? value : [String(value ?? '')];
  return values.map((cookie) => cookie.split(';')[0]).join('; ');
}

async function authenticatedApp(chatEnabled: boolean) {
  const app = await buildHub({
    databasePath: ':memory:',
    chatEnabled,
    chatEngine: {
      answer: async () => ({
        markdown: 'Réponse.',
        status: 'unverified',
        route: 'local_unverified',
        retrievalMode: 'none',
        sources: [],
        modelCalls: 1,
        passageCount: 0,
      }),
    },
  });
  apps.push(app);
  const owner = await app.inject({
    method: 'POST',
    url: '/api/auth/bootstrap',
    payload: {
      deviceId: '5945057a-0b59-4d3b-814f-9581be697098',
      deviceName: 'PC',
      identifier: 'adulte1',
      name: 'Adulte 1',
      password: 'phrase-secrete-friday',
    },
  });
  return { app, cookie: cookieFrom(owner) };
}

describe('Chat v2 API', () => {
  it('fails closed behind FRIDAY_CHAT_ENABLED', async () => {
    const { app } = await authenticatedApp(false);
    const response = await app.inject({
      method: 'GET',
      url: '/api/chat/conversations',
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'chat_disabled' });
  });

  it('creates, enqueues and exposes a completed result when enabled', async () => {
    const { app, cookie } = await authenticatedApp(true);
    const created = await app.inject({
      method: 'POST',
      url: '/api/chat/conversations',
      headers: { cookie },
      payload: {},
    });
    expect(created.statusCode).toBe(201);
    const conversationId = created.json().id as string;
    const sent = await app.inject({
      method: 'POST',
      url: `/api/chat/conversations/${conversationId}/messages`,
      headers: { cookie },
      payload: {
        clientRequestId: '60f2ae49-ad7b-4768-a444-a1e0d0e74464',
        content: 'Bonjour',
      },
    });
    expect(sent.statusCode).toBe(202);
    const runId = sent.json().runId as string;
    let status = 'queued';
    for (let index = 0; index < 100 && status !== 'completed'; index += 1) {
      const run = await app.inject({
        method: 'GET',
        url: `/api/chat/runs/${runId}`,
        headers: { cookie },
      });
      status = run.json().status as string;
      if (status !== 'completed')
        await new Promise((resolve) => setTimeout(resolve, 2));
    }
    expect(status).toBe('completed');
    const messages = await app.inject({
      method: 'GET',
      url: `/api/chat/conversations/${conversationId}/messages`,
      headers: { cookie },
    });
    expect(messages.json().messages).toHaveLength(2);
    expect(messages.json().messages[1]).toMatchObject({
      answerStatus: 'unverified',
      content: 'Réponse.',
    });
  });
});
