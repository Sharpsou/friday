import { test as base, expect, type Page } from '@playwright/test';
import {
  AuthStateResponseSchema,
  PullResponseSchema,
  PushResponseSchema,
  type TaskRecord,
} from '../../packages/contracts/src/index.ts';
export const E2E_OWNER_DEVICE_ID = '5945057a-0b59-4d3b-814f-9581be697098';
export const E2E_OWNER_IDENTIFIER = 'adulte1';
export const E2E_OWNER_PASSWORD = 'phrase-secrete-friday';

// One in-memory Hub is shared by the suite; Playwright runs it with one worker.
export const test = base.extend({
  page: async ({ page }, providePage) => {
    const state = await page.request.get('/api/auth/state');
    const statePayload = (await state.json()) as { bootstrapRequired: boolean };
    const bootstrapRequired = statePayload.bootstrapRequired;
    const response = await page.request.post(
      bootstrapRequired ? '/api/auth/bootstrap' : '/api/auth/login',
      {
        data: bootstrapRequired
          ? {
              deviceId: E2E_OWNER_DEVICE_ID,
              deviceName: 'Chrome mobile de test',
              identifier: E2E_OWNER_IDENTIFIER,
              name: 'Adulte 1',
              password: E2E_OWNER_PASSWORD,
            }
          : {
              deviceId: E2E_OWNER_DEVICE_ID,
              deviceName: 'Chrome mobile de test',
              identifier: E2E_OWNER_IDENTIFIER,
              password: E2E_OWNER_PASSWORD,
            },
      },
    );
    expect(response.ok(), await response.text()).toBe(true);
    await page.addInitScript((deviceId) => {
      const randomUuid = crypto.randomUUID.bind(crypto);
      let deviceIdentityGenerated = false;
      Object.defineProperty(crypto, 'randomUUID', {
        configurable: true,
        value: () => {
          if (!deviceIdentityGenerated) {
            deviceIdentityGenerated = true;
            return deviceId;
          }
          return randomUuid();
        },
      });
    }, E2E_OWNER_DEVICE_ID);

    await providePage(page);
  },
});
export { expect };

// Establish the empty-list precondition through the same HTTP protocol as the
// app. This only targets the disposable in-memory Hub launched by Playwright.
export async function clearHouseholdTasks(page: Page): Promise<void> {
  const auth = AuthStateResponseSchema.parse(
    await (await page.request.get('/api/auth/state')).json(),
  );
  expect(auth.session).not.toBeNull();
  const profileId = auth.session!.member.profileId;
  const tasks = new Map<string, TaskRecord>();
  let cursor = 0;
  for (;;) {
    const response = await page.request.get(
      `/api/sync/pull?after=${cursor}&maison=1`,
    );
    expect(response.ok(), await response.text()).toBe(true);
    const pull = PullResponseSchema.parse(await response.json());
    for (const change of pull.changes)
      if (change.entityType === 'task')
        tasks.set(change.entityId, change.payload);
    if (pull.cursor === cursor) break;
    cursor = pull.cursor;
  }
  const operations = [...tasks.values()]
    .filter((task) => !task.deletedAt)
    .map((task) => {
      const updatedAt = new Date(
        Math.max(Date.now(), Date.parse(task.updatedAt) + 1),
      ).toISOString();
      return {
        protocolVersion: 1,
        operationId: crypto.randomUUID(),
        deviceId: E2E_OWNER_DEVICE_ID,
        profileId,
        entityType: 'task',
        entityId: task.id,
        operation: 'upsert',
        baseRevision: task.revision,
        clientCreatedAt: updatedAt,
        payload: {
          ...task,
          updatedAt,
          deletedAt: updatedAt,
          deviceId: E2E_OWNER_DEVICE_ID,
          updatedByProfileId: profileId,
        },
      };
    });
  for (let offset = 0; offset < operations.length; offset += 100) {
    const response = await page.request.post('/api/sync/push', {
      data: { operations: operations.slice(offset, offset + 100) },
    });
    expect(response.ok(), await response.text()).toBe(true);
    const result = PushResponseSchema.parse(await response.json());
    expect(result.acks.every((ack) => ack.status === 'applied')).toBe(true);
  }
}
