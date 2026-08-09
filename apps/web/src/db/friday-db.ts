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

export interface GroceryItemRow {
  encrypted: EncryptedEnvelope;
  id: string;
  revision: number;
  syncState: OutboxState;
  updatedAt: string;
}

export interface GroceryClassificationRow {
  encrypted: EncryptedEnvelope;
  itemId: string;
  revision: number;
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
  groceryClassifications!: EntityTable<GroceryClassificationRow, 'itemId'>;
  groceryItems!: EntityTable<GroceryItemRow, 'id'>;
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
    this.version(2).stores({
      groceryItems: '&id, revision, updatedAt, syncState',
      keys: '&id',
      outbox: '&operationId, entityId, createdAt, state',
      settings: '&key',
      tasks: '&id, revision, updatedAt, syncState',
    });
    this.version(3).stores({
      groceryClassifications: '&itemId, revision, updatedAt',
      groceryItems: '&id, revision, updatedAt, syncState',
      keys: '&id',
      outbox: '&operationId, entityId, createdAt, state',
      settings: '&key',
      tasks: '&id, revision, updatedAt, syncState',
    });
  }
}

export const fridayDb = new FridayDatabase();
