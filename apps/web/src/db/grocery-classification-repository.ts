import {
  GroceryClassificationRecordSchema,
  type GroceryClassificationPullResponse,
  type GroceryClassificationRecord,
} from '@friday/contracts';

import { decryptJson, encryptJson } from '../crypto/vault.js';
import { fridayDb } from './friday-db.js';
import { groceryClassificationAad } from './encryption-context.js';
import { getDeviceContext } from './task-repository.js';

const CURSOR_KEY = 'grocery-classification-cursor';
const ACTIVE_JOB_KEY = 'grocery-classification-active-job';

export async function listGroceryClassifications(): Promise<
  GroceryClassificationRecord[]
> {
  const { deviceId, key } = await getDeviceContext();
  const rows = await fridayDb.groceryClassifications.toArray();
  return Promise.all(
    rows.map(async (row) =>
      GroceryClassificationRecordSchema.parse(
        await decryptJson<GroceryClassificationRecord>(
          key,
          row.encrypted,
          groceryClassificationAad(row.itemId, deviceId),
        ),
      ),
    ),
  );
}

export async function applyGroceryClassificationChanges(
  payload: GroceryClassificationPullResponse,
): Promise<void> {
  const { deviceId, key } = await getDeviceContext();
  const rows = await Promise.all(
    payload.changes.map(async ({ classification }) => ({
      encrypted: await encryptJson(
        key,
        classification,
        groceryClassificationAad(classification.itemId, deviceId),
      ),
      itemId: classification.itemId,
      revision: classification.revision,
      updatedAt: classification.updatedAt,
    })),
  );
  await fridayDb.transaction(
    'rw',
    fridayDb.groceryClassifications,
    fridayDb.settings,
    async () => {
      if (rows.length > 0) await fridayDb.groceryClassifications.bulkPut(rows);
      await fridayDb.settings.put({ key: CURSOR_KEY, value: payload.cursor });
    },
  );
}

export async function getGroceryClassificationCursor(): Promise<number> {
  const value = (await fridayDb.settings.get(CURSOR_KEY))?.value;
  return typeof value === 'number' ? value : 0;
}

export async function getActiveGroceryClassificationJobId(): Promise<
  string | null
> {
  const value = (await fridayDb.settings.get(ACTIVE_JOB_KEY))?.value;
  return typeof value === 'string' ? value : null;
}

export async function setActiveGroceryClassificationJobId(
  jobId: string | null,
): Promise<void> {
  if (jobId === null) {
    await fridayDb.settings.delete(ACTIVE_JOB_KEY);
    return;
  }
  await fridayDb.settings.put({ key: ACTIVE_JOB_KEY, value: jobId });
}
