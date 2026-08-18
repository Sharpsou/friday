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

export interface BudgetRow {
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

export interface AssistantConversationRow {
  archivedAt: string | null;
  encrypted: EncryptedEnvelope;
  id: string;
  profileId: string;
  updatedAt: string;
}

export interface AssistantMessageRow {
  conversationId: string;
  createdAt: string;
  encrypted: EncryptedEnvelope;
  id: string;
  profileId: string;
}

export interface AssistantOutboxRow {
  clientRequestId: string;
  conversationId: string;
  createdAt: string;
  encrypted: EncryptedEnvelope;
  profileId: string;
}

export interface WatchSnapshotRow {
  encrypted: EncryptedEnvelope;
  profileId: string;
  updatedAt: string;
}

export interface WatchOutboxRow {
  articleId?: string;
  conceptId?: string;
  createdAt: string;
  encrypted: EncryptedEnvelope;
  kind?: 'article' | 'concept';
  operationId: string;
  profileId: string;
  watchId: string;
}

class FridayDatabase extends Dexie {
  assistantConversations!: EntityTable<AssistantConversationRow, 'id'>;
  assistantMessages!: EntityTable<AssistantMessageRow, 'id'>;
  assistantOutbox!: EntityTable<AssistantOutboxRow, 'clientRequestId'>;
  budgetEntries!: EntityTable<BudgetRow, 'id'>;
  budgetEnvelopes!: EntityTable<BudgetRow, 'id'>;
  budgetPlannedExpenses!: EntityTable<BudgetRow, 'id'>;
  budgetRecurringTemplates!: EntityTable<BudgetRow, 'id'>;
  budgetSavingsMonths!: EntityTable<BudgetRow, 'id'>;
  groceryClassifications!: EntityTable<GroceryClassificationRow, 'itemId'>;
  groceryItems!: EntityTable<GroceryItemRow, 'id'>;
  keys!: EntityTable<KeyRow, 'id'>;
  outbox!: EntityTable<OutboxRow, 'operationId'>;
  settings!: EntityTable<SettingRow, 'key'>;
  tasks!: EntityTable<TaskRow, 'id'>;
  watchOutbox!: EntityTable<WatchOutboxRow, 'operationId'>;
  watchSnapshots!: EntityTable<WatchSnapshotRow, 'profileId'>;

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
    this.version(4).stores({
      budgetEntries: '&id, revision, updatedAt, syncState',
      budgetEnvelopes: '&id, revision, updatedAt, syncState',
      budgetPlannedExpenses: '&id, revision, updatedAt, syncState',
      budgetRecurringTemplates: '&id, revision, updatedAt, syncState',
      budgetSavingsMonths: '&id, revision, updatedAt, syncState',
      groceryClassifications: '&itemId, revision, updatedAt',
      groceryItems: '&id, revision, updatedAt, syncState',
      keys: '&id',
      outbox: '&operationId, entityId, createdAt, state',
      settings: '&key',
      tasks: '&id, revision, updatedAt, syncState',
    });
    this.version(5).stores({
      assistantConversations: '&id, profileId, archivedAt, updatedAt',
      assistantMessages:
        '&id, [profileId+conversationId], conversationId, createdAt',
      assistantOutbox: '&clientRequestId, profileId, conversationId, createdAt',
      budgetEntries: '&id, revision, updatedAt, syncState',
      budgetEnvelopes: '&id, revision, updatedAt, syncState',
      budgetPlannedExpenses: '&id, revision, updatedAt, syncState',
      budgetRecurringTemplates: '&id, revision, updatedAt, syncState',
      budgetSavingsMonths: '&id, revision, updatedAt, syncState',
      groceryClassifications: '&itemId, revision, updatedAt',
      groceryItems: '&id, revision, updatedAt, syncState',
      keys: '&id',
      outbox: '&operationId, entityId, createdAt, state',
      settings: '&key',
      tasks: '&id, revision, updatedAt, syncState',
    });
    this.version(6).stores({
      assistantConversations: '&id, profileId, archivedAt, updatedAt',
      assistantMessages:
        '&id, [profileId+conversationId], conversationId, createdAt',
      assistantOutbox: '&clientRequestId, profileId, conversationId, createdAt',
      budgetEntries: '&id, revision, updatedAt, syncState',
      budgetEnvelopes: '&id, revision, updatedAt, syncState',
      budgetPlannedExpenses: '&id, revision, updatedAt, syncState',
      budgetRecurringTemplates: '&id, revision, updatedAt, syncState',
      budgetSavingsMonths: '&id, revision, updatedAt, syncState',
      groceryClassifications: '&itemId, revision, updatedAt',
      groceryItems: '&id, revision, updatedAt, syncState',
      keys: '&id',
      outbox: '&operationId, entityId, createdAt, state',
      settings: '&key',
      tasks: '&id, revision, updatedAt, syncState',
      watchOutbox: '&operationId, profileId, watchId, articleId, createdAt',
      watchSnapshots: '&profileId, updatedAt',
    });
    this.version(7).stores({
      assistantConversations: '&id, profileId, archivedAt, updatedAt',
      assistantMessages:
        '&id, [profileId+conversationId], conversationId, createdAt',
      assistantOutbox: '&clientRequestId, profileId, conversationId, createdAt',
      budgetEntries: '&id, revision, updatedAt, syncState',
      budgetEnvelopes: '&id, revision, updatedAt, syncState',
      budgetPlannedExpenses: '&id, revision, updatedAt, syncState',
      budgetRecurringTemplates: '&id, revision, updatedAt, syncState',
      budgetSavingsMonths: '&id, revision, updatedAt, syncState',
      groceryClassifications: '&itemId, revision, updatedAt',
      groceryItems: '&id, revision, updatedAt, syncState',
      keys: '&id',
      outbox: '&operationId, entityId, createdAt, state',
      settings: '&key',
      tasks: '&id, revision, updatedAt, syncState',
      watchOutbox: '&operationId, profileId, kind, watchId, createdAt',
      watchSnapshots: '&profileId, updatedAt',
    });
  }
}

export const fridayDb = new FridayDatabase();
