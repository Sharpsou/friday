import { describe, expect, it } from 'vitest';
import { buildHub } from './app.js';
import { createHubFixtures } from './http-tests/fixtures.js';
const { apps } = createHubFixtures();
describe('Friday hub health', () => {
  it('reports health without requiring Ollama', async () => {
    const app = await buildHub({ databasePath: ':memory:' });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      database: 'ok',
      ollama: 'not-required',
    });
    expect(response.headers['content-security-policy']).toContain(
      "default-src 'self'",
    );
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['permissions-policy']).toBe(
      'camera=(), geolocation=(), microphone=()',
    );
    expect(response.headers['cache-control']).toBe('no-store');
  });
});
