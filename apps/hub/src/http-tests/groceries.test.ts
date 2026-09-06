import { describe, expect, it, vi } from 'vitest';
import { buildHub } from '../app.js';
import { bootstrap, groceryOperation, createHubFixtures } from './fixtures.js';
const { apps } = createHubFixtures();
describe('Friday hub groceries', () => {
  it('transcribes an authenticated grocery photo without storing or classifying it', async () => {
    const transcribe = vi.fn().mockResolvedValue({
      items: [
        {
          box: { x: 580, y: 30, width: 250, height: 40 },
          label: 'Fleur de sel',
          quantityText: 'x2',
          sourceText: 'fleur de sel x2',
        },
      ],
    });
    const app = await buildHub({
      databasePath: ':memory:',
      photoTranscriptionEngine: { transcribe },
    });
    apps.push(app);
    const payload = {
      imageBase64: 'YWJjZGVmZ2hpamtsbW5vcA==',
      mediaType: 'image/jpeg',
    };

    const unauthenticated = await app.inject({
      method: 'POST',
      url: '/api/groceries/photo-transcription',
      payload,
    });
    const cookie = await bootstrap(app);
    const authenticated = await app.inject({
      method: 'POST',
      url: '/api/groceries/photo-transcription',
      headers: { cookie },
      payload,
    });

    expect(unauthenticated.statusCode).toBe(401);
    expect(authenticated.statusCode, authenticated.body).toBe(200);
    expect(authenticated.json()).toEqual({
      items: [
        {
          box: { x: 580, y: 30, width: 250, height: 40 },
          label: 'Fleur de sel',
          quantityText: 'x2',
          sourceText: 'fleur de sel x2',
        },
      ],
    });
    expect(transcribe).toHaveBeenCalledWith(
      payload.imageBase64,
      payload.mediaType,
      expect.any(AbortSignal),
    );
  });
  it('shares a grocery item through the authenticated sync log', async () => {
    const app = await buildHub({ databasePath: ':memory:' });
    apps.push(app);
    const cookie = await bootstrap(app);
    const grocery = groceryOperation();

    const push = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: { cookie },
      payload: { operations: [grocery] },
    });
    const pull = await app.inject({
      method: 'GET',
      url: '/api/sync/pull?after=0',
      headers: { cookie },
    });

    expect(push.statusCode, push.body).toBe(200);
    expect(push.json().acks[0]).toMatchObject({
      entityId: grocery.entityId,
      status: 'applied',
      serverRevision: 1,
    });
    expect(pull.json().changes).toEqual([
      expect.objectContaining({
        entityType: 'grocery_item',
        entityId: grocery.entityId,
        payload: expect.objectContaining({
          label: 'Lait',
          quantityText: '2 bouteilles',
          revision: 1,
        }),
      }),
    ]);
  });
  it('runs a correctable grocery classification job without mutating the list', async () => {
    const app = await buildHub({
      databasePath: ':memory:',
      classificationEngine: {
        async classify(labels) {
          return labels.map(() => ({
            storeFamilyId: 'pet-store',
            aisleId: 'food',
            confidence: 0.81,
          }));
        },
      },
    });
    apps.push(app);
    const cookie = await bootstrap(app);
    const grocery = {
      ...groceryOperation(),
      payload: {
        ...groceryOperation().payload,
        label: 'Repas Nouchka spécial',
      },
    };
    await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: { cookie },
      payload: { operations: [grocery] },
    });

    const started = await app.inject({
      method: 'POST',
      url: '/api/groceries/classification-proposals',
      headers: { cookie },
    });
    expect(started.statusCode, started.body).toBe(200);
    const jobId = started.json().id as string;
    let completed = started;
    await vi.waitFor(async () => {
      completed = await app.inject({
        method: 'GET',
        url: `/api/groceries/classification-proposals/${jobId}`,
        headers: { cookie },
      });
      expect(completed.json().status).toBe('completed');
    });

    const proposal = completed.json().proposal[0] as {
      expectedClassificationRevision: number | null;
      itemId: string;
    };
    const applied = await app.inject({
      method: 'POST',
      url: '/api/groceries/classifications/apply',
      headers: { cookie },
      payload: {
        jobId,
        classifications: [
          {
            itemId: proposal.itemId,
            expectedClassificationRevision:
              proposal.expectedClassificationRevision,
            storeFamilyId: 'supermarket',
            aisleId: 'pets',
          },
        ],
      },
    });
    const classificationPull = await app.inject({
      method: 'GET',
      url: '/api/groceries/classifications?after=0',
      headers: { cookie },
    });
    const groceryPull = await app.inject({
      method: 'GET',
      url: '/api/sync/pull?after=0',
      headers: { cookie },
    });

    expect(applied.statusCode, applied.body).toBe(200);
    expect(classificationPull.json().changes[0].classification).toMatchObject({
      itemId: grocery.entityId,
      aisleId: 'pets',
      source: 'manual',
    });
    expect(groceryPull.json().changes).toHaveLength(1);
  });
});
