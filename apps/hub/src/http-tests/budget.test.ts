import { describe, expect, it } from 'vitest';
import { buildHub } from '../app.js';
import { bootstrap, budgetOperation, createHubFixtures } from './fixtures.js';
const { apps } = createHubFixtures();
describe('Friday hub budget', () => {
  it('applies a shared budget movement idempotently', async () => {
    const app = await buildHub({ databasePath: ':memory:' });
    apps.push(app);
    const cookie = await bootstrap(app);
    const budget = budgetOperation();

    const first = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: { cookie },
      payload: { operations: [budget] },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: { cookie },
      payload: { operations: [budget] },
    });
    const pull = await app.inject({
      method: 'GET',
      url: '/api/sync/pull?after=0',
      headers: { cookie },
    });

    expect(first.statusCode, first.body).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect(pull.json().changes).toEqual([
      expect.objectContaining({
        entityType: 'budget_entry',
        entityId: budget.entityId,
        payload: expect.objectContaining({ amountCents: 4250, revision: 1 }),
      }),
    ]);
  });
  it('keeps one logical budget entry when two offline operations race on its deterministic id', async () => {
    const app = await buildHub({ databasePath: ':memory:' });
    apps.push(app);
    const cookie = await bootstrap(app);
    const firstOperation = budgetOperation();
    const competingOperation = {
      ...budgetOperation(),
      operationId: '83034bc5-c13d-4d4b-917b-c70ac75bc665',
    };

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: { cookie },
      payload: { operations: [firstOperation, competingOperation] },
    });
    const pull = await app.inject({
      method: 'GET',
      url: '/api/sync/pull?after=0',
      headers: { cookie },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().acks).toEqual([
      expect.objectContaining({ status: 'applied', serverRevision: 1 }),
      expect.objectContaining({ status: 'applied', serverRevision: 1 }),
    ]);
    expect(pull.json().changes).toHaveLength(1);

    const divergent = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: { cookie },
      payload: {
        operations: [
          {
            ...budgetOperation(),
            operationId: '0235d407-66dd-4c7e-b9c5-08014a5500ea',
            payload: { ...budgetOperation().payload, amountCents: 4300 },
          },
        ],
      },
    });
    expect(divergent.json().acks).toEqual([
      expect.objectContaining({ status: 'conflict', serverRevision: 1 }),
    ]);
  });
});
