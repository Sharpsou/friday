import { describe, expect, it } from 'vitest';

import { decryptJson, encryptJson, generateDeviceKey } from './vault.js';

describe('device vault', () => {
  it('round-trips JSON with AES-GCM and authenticated metadata', async () => {
    const key = await generateDeviceKey();
    expect(key.extractable).toBe(false);
    const encrypted = await encryptJson(
      key,
      { title: 'Sortir les poubelles' },
      'tasks:task-1:1:device-1',
    );

    await expect(
      decryptJson<{ title: string }>(key, encrypted, 'tasks:task-1:1:device-1'),
    ).resolves.toEqual({ title: 'Sortir les poubelles' });
    await expect(
      decryptJson(key, encrypted, 'tasks:task-1:1:wrong-device'),
    ).rejects.toThrow();
  });
});
