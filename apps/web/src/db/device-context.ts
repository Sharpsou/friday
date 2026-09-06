import { generateDeviceKey } from '../crypto/vault.js';
import { CURRENT_PROFILE_ID } from './profile-defaults.js';
import { fridayDb, type FridayDatabase } from './friday-db.js';

export interface DeviceContext {
  deviceId: string;
  key: CryptoKey;
  profileId: string;
}

async function readOrCreateDeviceId(database: FridayDatabase): Promise<string> {
  const stored = (await database.settings.get('deviceId'))?.value;
  if (typeof stored === 'string') return stored;
  const deviceId = crypto.randomUUID();
  await database.settings.put({ key: 'deviceId', value: deviceId });
  return deviceId;
}

export function getLocalDeviceId(database = fridayDb): Promise<string> {
  return database.transaction('rw', database.settings, () =>
    readOrCreateDeviceId(database),
  );
}

export async function getCurrentLocalProfileId(
  database = fridayDb,
): Promise<string> {
  const stored = (await database.settings.get('currentProfileId'))?.value;
  return typeof stored === 'string' ? stored : CURRENT_PROFILE_ID;
}

export async function getDeviceContext(
  database = fridayDb,
): Promise<DeviceContext> {
  // WebCrypto must finish before opening the IndexedDB transaction. Another
  // connection may win during generation: re-read and keep its persisted key.
  const candidate =
    (await database.keys.get('device-aes-key'))?.value ??
    (await generateDeviceKey());
  return database.transaction(
    'rw',
    database.keys,
    database.settings,
    async () => {
      let key = (await database.keys.get('device-aes-key'))?.value;
      if (!key) {
        key = candidate;
        await database.keys.put({ id: 'device-aes-key', value: key });
      }
      const deviceId = await readOrCreateDeviceId(database);
      const profileId = await getCurrentLocalProfileId(database);
      return { deviceId, key, profileId };
    },
  );
}
