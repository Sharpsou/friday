import { afterEach, describe, expect, it } from 'vitest';

import { buildHub } from '../app.js';

const apps: Awaited<ReturnType<typeof buildHub>>[] = [];

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

async function authenticatedApp() {
  const app = await buildHub({ databasePath: ':memory:' });
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

describe('Chat archive API', () => {
  it('exposes an authenticated archive and no creation endpoint', async () => {
    const { app, cookie } = await authenticatedApp();
    const listed = await app.inject({
      method: 'GET',
      url: '/api/assistant/conversations',
      headers: { cookie },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual({ conversations: [] });

    const creation = await app.inject({
      method: 'POST',
      url: '/api/assistant/conversations',
      headers: { cookie },
      payload: { title: 'Nouveau Chat' },
    });
    expect(creation.statusCode).toBe(404);
  });

  it('returns a stable reconstruction response instead of invoking an LLM', async () => {
    const { app, cookie } = await authenticatedApp();
    const submitted = await app.inject({
      method: 'POST',
      url: '/api/assistant/conversations/legacy/messages',
      headers: { cookie },
      payload: { content: 'Question' },
    });

    expect(submitted.statusCode).toBe(410);
    expect(submitted.json()).toEqual({
      error: 'chat_reconstruction',
      message:
        'Le moteur Chat a été retiré pour être reconstruit. Les conversations existantes restent consultables.',
    });
  });
});
