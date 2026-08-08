import Dexie, { type EntityTable } from 'dexie';

import type { EncryptedEnvelope } from '../crypto/vault.js';

export type OutboxState = 'pending' | 'sent' | 'acknowledged' | 'conflict';

export interface TaskRow {
  encrypted: EncryptedEnvelope;
  id: string;
  revision: number;
  syncState: OutboxState;
  updatedAt: string;
}

export interface OutboxRow {
  createdAt: string;
  encryptedPayload: EncryptedEnvelope;
  entityId: string;
  operationId: string;
  state: OutboxState;
}

export interface KeyRow {
  id: 'device-aes-key';
  value: CryptoKey;
}

export interface SettingRow {
  key: string;
  value: unknown;
}

class FridayDatabase extends Dexie {
  keys!: EntityTable<KeyRow, 'id'>;
  outbox!: EntityTable<OutboxRow, 'operationId'>;
  settings!: EntityTable<SettingRow, 'key'>;
  tasks!: EntityTable<TaskRow, 'id'>;

  constructor() {
    super('friday');
    this.version(1).stores({
      keys: '&id',
      outbox: '&operationId, entityId, createdAt, state',
      settings: '&key',
      tasks: '&id, revision, updatedAt, syncState',
    });
  }
}

export const fridayDb = new FridayDatabase();
