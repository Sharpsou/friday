import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { ChatEngine, OllamaClient } from '@friday/assistant-core';
import { openDatabase } from '../db/database.js';
import {
  MenuAiService,
  ChatMenuRecipeEngine,
  RECIPE_PROPOSAL_FORMAT,
  type MenuRecipeEngine,
} from './menu-ai-service.js';
import { menuPlugin } from './menu-plugin.js';

const draft = {
  name: 'Pâtes',
  portionsMilli: 2000,
  ingredients: [
    {
      label: 'Pâtes',
      quantity: { milli: 200000, unit: 'g' as const },
      note: '',
    },
  ],
  steps: 'Cuire.',
  durationMinutes: null,
  notes: '',
};
describe('private menu AI proposals', () => {
  it('counts pending jobs beyond the visible history when admitting work', async () => {
    const db = openDatabase(':memory:');
    const propose = vi.fn(async () => ({
      draft,
      sources: [],
      evidence: 'unverified' as const,
    }));
    const service = new MenuAiService(db, { propose });
    const profile = crypto.randomUUID();
    try {
      for (let i = 0; i < 3; i++)
        service.enqueue(profile, crypto.randomUUID(), 'Ancien', 'local');
      for (let i = 0; i < 41; i++) {
        const job = service.enqueue(
          profile,
          crypto.randomUUID(),
          'Annulé',
          'local',
        );
        service.cancel(profile, job.id);
      }
      const id = crypto.randomUUID();
      const last = service.enqueue(profile, id, 'Dernier', 'local');
      expect(service.enqueue(profile, id, 'Dernier', 'local').id).toBe(last.id);
      expect(() =>
        service.enqueue(profile, crypto.randomUUID(), 'En trop', 'local'),
      ).toThrow('MENU_QUEUE_FULL');
      expect(() =>
        service.enqueue(
          crypto.randomUUID(),
          crypto.randomUUID(),
          'Autre profil',
          'local',
        ),
      ).not.toThrow();
      expect(propose).not.toHaveBeenCalled();
    } finally {
      await service.stop();
      db.close();
    }
  });
  it('uses an Ollama-compatible grammar while rejecting quantities beyond business limits', async () => {
    expect(JSON.stringify(RECIPE_PROPOSAL_FORMAT)).not.toMatch(
      /"(?:maximum|maxLength|maxItems)":/u,
    );
    const chat: ChatEngine = {
      answer: async () => ({
        markdown: 'Pour 2 personnes : 200 g de pâtes.',
        status: 'verified',
        route: 'web_verified',
        sources: [],
        retrievalMode: 'none',
        modelCalls: 1,
        passageCount: 0,
      }),
    };
    const ollama: Pick<OllamaClient, 'generate'> = {
      generate: async () => ({
        response: JSON.stringify({
          ...draft,
          portionsMilli: 1_000_000_000_001,
        }),
        durationMs: 1,
      }),
    };
    await expect(
      new ChatMenuRecipeEngine(chat, ollama).propose(
        'Pâtes',
        'local',
        new AbortController().signal,
        () => undefined,
      ),
    ).rejects.toThrow();
  });
  it('persists idempotent requests, completes after start and never writes household data', async () => {
    const db = openDatabase(':memory:');
    const engine: MenuRecipeEngine = {
      propose: vi.fn(async () => ({
        draft,
        sources: [],
        evidence: 'unverified' as const,
      })),
    };
    const service = new MenuAiService(db, engine);
    try {
      service.start();
      const requestId = crypto.randomUUID();
      const profile = crypto.randomUUID();
      const job = service.enqueue(profile, requestId, 'Pâtes', 'local');
      expect(service.enqueue(profile, requestId, 'Pâtes', 'local').id).toBe(
        job.id,
      );
      expect(() => service.enqueue(profile, requestId, 'Riz', 'local')).toThrow(
        'MENU_REQUEST_REUSED',
      );
      await vi.waitFor(() =>
        expect(service.get(profile, job.id)?.status).toBe('completed'),
      );
      expect(engine.propose).toHaveBeenCalledOnce();
      expect(service.get(crypto.randomUUID(), job.id)).toBeNull();
      expect(
        db.prepare('SELECT COUNT(*) AS n FROM maison_records').get(),
      ).toEqual({ n: 0 });
    } finally {
      await service.stop();
      db.close();
    }
  });
  it('restores pending work after a restart and never restarts cancelled jobs', async () => {
    const db = openDatabase(':memory:');
    const profile = crypto.randomUUID();
    const engine: MenuRecipeEngine = {
      propose: async (_name, _mode, signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new Error('cancel')), {
            once: true,
          }),
        ),
    };
    const first = new MenuAiService(db, engine);
    const job = first.enqueue(profile, crypto.randomUUID(), 'Soupe', 'web');
    first.start();
    await vi.waitFor(() =>
      expect(first.get(profile, job.id)?.status).toBe('running'),
    );
    await first.stop();
    expect(first.get(profile, job.id)?.status).toBe('queued');
    const second = new MenuAiService(db, {
      propose: async () => ({ draft, sources: [], evidence: 'partial' }),
    });
    second.cancel(profile, job.id);
    second.start();
    await second.stop();
    expect(second.get(profile, job.id)?.status).toBe('cancelled');
    db.close();
  });
  it('enforces queue limits and reports malformed extraction without saving a recipe', async () => {
    const db = openDatabase(':memory:');
    const profile = crypto.randomUUID();
    const service = new MenuAiService(db, {
      propose: async () => {
        throw new Error('INVALID_JSON');
      },
    });
    try {
      const jobs = Array.from({ length: 4 }, () =>
        service.enqueue(profile, crypto.randomUUID(), 'Recette', 'local'),
      );
      expect(() =>
        service.enqueue(profile, crypto.randomUUID(), 'Autre', 'local'),
      ).toThrow('MENU_QUEUE_FULL');
      service.start();
      await vi.waitFor(() =>
        expect(service.get(profile, jobs[3]!.id)?.status).toBe('failed'),
      );
      expect(
        db.prepare('SELECT COUNT(*) AS n FROM maison_records').get(),
      ).toEqual({ n: 0 });
    } finally {
      await service.stop();
      db.close();
    }
  });
  it('keeps unproven quantities unknown and never promotes a projected recipe to verified', async () => {
    const chat: ChatEngine = {
      answer: async () => ({
        markdown: 'Pour 2 personnes : 200 g de pâtes. Cuire.',
        status: 'verified',
        route: 'web_verified',
        sources: [],
        retrievalMode: 'lexical_fallback',
        modelCalls: 1,
        passageCount: 1,
      }),
    };
    const ollama: Pick<OllamaClient, 'generate'> = {
      generate: async () => ({
        response: JSON.stringify({
          ...draft,
          ingredients: [
            ...draft.ingredients,
            { label: 'Sel', quantity: { milli: 900000, unit: 'g' }, note: '' },
          ],
        }),
        durationMs: 1,
        outputTokens: 1,
        promptTokens: 1,
      }),
    };
    const engine = new ChatMenuRecipeEngine(chat, ollama);
    const result = await engine.propose(
      'Pâtes',
      'web',
      new AbortController().signal,
      () => undefined,
    );
    expect(result.evidence).toBe('partial');
    expect(result.draft?.ingredients[0]?.quantity?.milli).toBe(200000);
    expect(result.draft?.ingredients[1]?.quantity).toBeNull();
  });
  it('does not invoke research after the shared Web quota is exhausted', async () => {
    const chat: ChatEngine = {
      webUsage: async () => ({ creditsUsed: 950, limit: 1000 }),
      answer: vi.fn(),
    };
    const engine = new ChatMenuRecipeEngine(chat, { generate: vi.fn() });
    await expect(
      engine.propose(
        'Recette',
        'web',
        new AbortController().signal,
        () => undefined,
      ),
    ).rejects.toThrow('MENU_WEB_QUOTA');
    expect(chat.answer).not.toHaveBeenCalled();
  });
  it('requires authentication and trusted origins and hides another profile’s proposal', async () => {
    const db = openDatabase(':memory:');
    const service = new MenuAiService(db, {
      propose: async () => ({
        draft,
        sources: [],
        evidence: 'unverified' as const,
      }),
    });
    const app = Fastify();
    await app.register(menuPlugin, {
      prefix: '/api/menus',
      service,
      enabled: true,
      profileId: async (headers) => {
        if (typeof headers['x-profile'] !== 'string') throw new Error('AUTH');
        return headers['x-profile'];
      },
      trustedMutation: (headers) =>
        headers.origin !== 'https://hostile.invalid',
      handleAuthError: (_error, reply) => {
        const response = reply.code(401) as { send: (v: unknown) => unknown };
        return response.send({ error: 'auth' });
      },
    });
    try {
      expect((await app.inject('/api/menus/ai-jobs')).statusCode).toBe(401);
      const profile = crypto.randomUUID();
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/menus/ai-jobs',
            headers: {
              'x-profile': profile,
              origin: 'https://hostile.invalid',
            },
            payload: {
              requestId: crypto.randomUUID(),
              name: 'Pâtes',
              mode: 'local',
            },
          })
        ).statusCode,
      ).toBe(403);
      const response = await app.inject({
        method: 'POST',
        url: '/api/menus/ai-jobs',
        headers: { 'x-profile': profile },
        payload: {
          requestId: crypto.randomUUID(),
          name: 'Pâtes',
          mode: 'local',
        },
      });
      expect(response.statusCode).toBe(202);
      const id = response.json<{ id: string }>().id;
      expect(
        (
          await app.inject({
            url: `/api/menus/ai-jobs/${id}`,
            headers: { 'x-profile': crypto.randomUUID() },
          })
        ).statusCode,
      ).toBe(404);
    } finally {
      await app.close();
      await service.stop();
      db.close();
    }
  });
});
