import { afterEach, describe, expect, it } from 'vitest';

import type { AssistantEngine } from './assistant-engine.js';
import { buildHub } from '../app.js';

const apps: Awaited<ReturnType<typeof buildHub>>[] = [];
const engine: AssistantEngine = {
  generateTitle: async () => 'Titre automatique',
  answer: async () => ({ content: 'Bonjour' }),
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

function cookieFrom(response: {
  headers: Record<string, number | string | string[] | undefined>;
}): string {
  const values = Array.isArray(response.headers['set-cookie'])
    ? response.headers['set-cookie']
    : [String(response.headers['set-cookie'] ?? '')];
  return values.map((cookie) => cookie.split(';')[0]).join('; ');
}

describe('Assistant API profile isolation', () => {
  it('keeps conversations and run identifiers private to the authenticated profile', async () => {
    const app = await buildHub({
      databasePath: ':memory:',
      assistantEngine: engine,
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
    const ownerCookie = cookieFrom(owner);
    const pairing = await app.inject({
      method: 'POST',
      url: '/api/auth/pairing-code',
      headers: { cookie: ownerCookie },
    });
    const adult = await app.inject({
      method: 'POST',
      url: '/api/auth/pair',
      payload: {
        code: pairing.json().code,
        deviceId: '51c048d0-17c7-4c43-8706-1727d16f2bd7',
        deviceName: 'iPhone',
        identifier: 'adulte2',
        name: 'Adulte 2',
        password: 'autre-phrase-secrete',
      },
    });
    const adultCookie = cookieFrom(adult);
    const created = await app.inject({
      method: 'POST',
      url: '/api/assistant/conversations',
      headers: { cookie: ownerCookie },
      payload: { title: 'Strictement privé' },
    });
    expect(created.statusCode, created.body).toBe(200);
    const conversationId = created.json().id as string;
    const submitted = await app.inject({
      method: 'POST',
      url: `/api/assistant/conversations/${conversationId}/messages`,
      headers: { cookie: ownerCookie },
      payload: {
        clientRequestId: '71bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
        content: 'Mon secret',
        mode: 'local',
      },
    });
    expect(submitted.statusCode, submitted.body).toBe(200);
    const runId = submitted.json().run.id as string;
    const rejectedWebMode = await app.inject({
      method: 'POST',
      url: `/api/assistant/conversations/${conversationId}/messages`,
      headers: { cookie: ownerCookie },
      payload: {
        clientRequestId: '81bc3ea7-e269-46b3-9ac7-1c8cb7b310bb',
        content: 'Cherche sur Internet',
        mode: 'web',
      },
    });
    expect(rejectedWebMode.statusCode).toBe(400);
    expect(rejectedWebMode.json()).toEqual({
      error: 'invalid_assistant_message',
    });

    const adultList = await app.inject({
      method: 'GET',
      url: '/api/assistant/conversations',
      headers: { cookie: adultCookie },
    });
    const adultConversation = await app.inject({
      method: 'GET',
      url: `/api/assistant/conversations/${conversationId}/messages`,
      headers: { cookie: adultCookie },
    });
    const adultRun = await app.inject({
      method: 'GET',
      url: `/api/assistant/runs/${runId}`,
      headers: { cookie: adultCookie },
    });

    expect(adultList.json()).toEqual({ conversations: [] });
    expect(adultConversation.statusCode).toBe(404);
    expect(adultRun.statusCode).toBe(404);
  });
});
