import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { migrateDatabase, openDatabase } from './database.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('hub database migrations', () => {
  it('replaces the retired Web research tables with the Tavily attempt ledger', () => {
    const database = new Database(':memory:');
    migrateDatabase(database, 11);
    database.exec(`
      CREATE TABLE assistant_research_attempts (id INTEGER PRIMARY KEY);
      CREATE TABLE web_documents (id INTEGER PRIMARY KEY, title TEXT, excerpt TEXT);
      CREATE VIRTUAL TABLE web_documents_fts USING fts5(title, excerpt);
      CREATE TABLE web_connector_health (connector_id TEXT PRIMARY KEY);
      INSERT INTO schema_migrations(version, applied_at) VALUES (12, '2026-08-10T00:00:00.000Z');
    `);

    migrateDatabase(database);

    const retiredTables = database
      .prepare(
        `SELECT name FROM sqlite_master
          WHERE name IN ('web_documents', 'web_documents_fts', 'web_connector_health')`,
      )
      .all();
    const latest = database
      .prepare('SELECT MAX(version) AS version FROM schema_migrations')
      .get() as { version: number };
    database.close();

    expect(retiredTables).toEqual([]);
    expect(latest.version).toBe(14);
  });

  it('adds optional time and duration columns to a version 1 database', () => {
    const directory = mkdtempSync(join(tmpdir(), 'friday-migration-'));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, 'friday.sqlite');
    const versionOne = new Database(databasePath);
    migrateDatabase(versionOne, 1);
    versionOne
      .prepare(
        `INSERT INTO tasks (
           id, household_id, revision, title, due_date, assignee_profile_id,
           recurrence, note, status, created_at, updated_at, deleted_at,
           created_by_profile_id, updated_by_profile_id, device_id, schema_version
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'task-1',
        'household-1',
        1,
        'Tâche existante',
        '2026-08-15',
        null,
        null,
        null,
        'todo',
        '2026-08-08T12:00:00.000Z',
        '2026-08-08T12:00:00.000Z',
        null,
        'profile-1',
        'profile-1',
        'device-1',
        1,
      );
    versionOne.close();

    const migrated = openDatabase(databasePath);
    const columns = migrated
      .prepare('PRAGMA table_info(tasks)')
      .all() as Array<{
      name: string;
    }>;
    const task = migrated
      .prepare(
        'SELECT title, due_date, due_time, duration_minutes FROM tasks WHERE id = ?',
      )
      .get('task-1');
    const migrations = migrated
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all();
    const memberColumns = migrated
      .prepare('PRAGMA table_info(household_members)')
      .all() as Array<{ name: string }>;
    migrated.close();

    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['due_time', 'duration_minutes']),
    );
    expect(task).toEqual({
      title: 'Tâche existante',
      due_date: '2026-08-15',
      due_time: null,
      duration_minutes: null,
    });
    expect(migrations).toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
      { version: 4 },
      { version: 5 },
      { version: 6 },
      { version: 7 },
      { version: 8 },
      { version: 9 },
      { version: 10 },
      { version: 11 },
      { version: 12 },
      { version: 13 },
      { version: 14 },
    ]);
    expect(memberColumns.map((column) => column.name)).toContain(
      'login_identifier',
    );
  });

  it('adds the shared grocery table without changing existing tasks', () => {
    const database = new Database(':memory:');
    migrateDatabase(database, 4);

    migrateDatabase(database);
    const groceryColumns = database
      .prepare('PRAGMA table_info(grocery_items)')
      .all() as Array<{ name: string }>;
    const migrations = database
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all();
    database.close();

    expect(groceryColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'label',
        'quantity_text',
        'manual_store_family_id',
        'manual_aisle_id',
        'checked_at',
        'deleted_at',
      ]),
    );
    expect(migrations.at(-1)).toEqual({ version: 14 });
  });

  it('adds persistent grocery classification jobs and shared results', () => {
    const database = new Database(':memory:');
    migrateDatabase(database, 5);

    migrateDatabase(database);
    const jobColumns = database
      .prepare('PRAGMA table_info(grocery_classification_jobs)')
      .all() as Array<{ name: string }>;
    const classificationColumns = database
      .prepare('PRAGMA table_info(grocery_classifications)')
      .all() as Array<{ name: string }>;
    const migrations = database
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all();
    database.close();

    expect(jobColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'status',
        'snapshot_json',
        'result_json',
        'cancel_requested',
        'applied_response_json',
      ]),
    );
    expect(classificationColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'store_family_id',
        'aisle_id',
        'label_fingerprint',
        'revision',
      ]),
    );
    expect(migrations.at(-1)).toEqual({ version: 14 });
  });

  it('adds the five budget stores and the idempotent seed marker', () => {
    const database = new Database(':memory:');
    migrateDatabase(database, 7);

    migrateDatabase(database);
    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    database.close();

    expect(tables.map((table) => table.name)).toEqual(
      expect.arrayContaining([
        'budget_entries',
        'budget_recurring_templates',
        'budget_envelopes',
        'budget_planned_expenses',
        'budget_savings_months',
        'budget_seed_markers',
      ]),
    );
  });

  it('allows several Friday devices per user and adds approval requests', () => {
    const database = new Database(':memory:');
    migrateDatabase(database, 8);

    migrateDatabase(database);
    const deviceIndexes = database
      .prepare("PRAGMA index_list('friday_devices')")
      .all() as Array<{ name: string; unique: number }>;
    const approvalColumns = database
      .prepare('PRAGMA table_info(device_approval_requests)')
      .all() as Array<{ name: string }>;
    database.close();

    expect(deviceIndexes).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: expect.stringContaining('user_id') }),
      ]),
    );
    expect(approvalColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'device_id',
        'device_name',
        'status',
        'status_token_hash',
        'approved_by_device_id',
      ]),
    );
  });

  it('adds private Assistant conversations, messages, runs, sources and events', () => {
    const database = new Database(':memory:');
    migrateDatabase(database, 9);

    migrateDatabase(database);
    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    const runColumns = database
      .prepare('PRAGMA table_info(assistant_runs)')
      .all() as Array<{ name: string }>;
    const messageColumns = database
      .prepare('PRAGMA table_info(assistant_messages)')
      .all() as Array<{ name: string }>;
    database.close();

    expect(tables.map((table) => table.name)).toEqual(
      expect.arrayContaining([
        'assistant_conversations',
        'assistant_messages',
        'assistant_runs',
        'assistant_sources',
        'assistant_run_events',
      ]),
    );
    expect(runColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'client_request_id',
        'profile_id',
        'status',
        'lease_until',
        'search_consent',
        'web_depth',
      ]),
    );
    expect(messageColumns.map((column) => column.name)).toContain('web_depth');
  });

  it('backfills the Friday identifier when upgrading an existing auth database', () => {
    const directory = mkdtempSync(join(tmpdir(), 'friday-auth-migration-'));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, 'friday.sqlite');
    const database = new Database(databasePath);
    migrateDatabase(database, 3);

    database
      .prepare(
        `INSERT INTO "user" (
           id, name, email, emailVerified, image, createdAt, updatedAt
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'user-1',
        'Adulte existant',
        'ancien-identifiant@friday.local',
        0,
        null,
        '2026-08-09T08:00:00.000Z',
        '2026-08-09T08:00:00.000Z',
      );
    database
      .prepare('INSERT INTO households (id, name, created_at) VALUES (?, ?, ?)')
      .run('household-1', 'Maison', '2026-08-09T08:00:00.000Z');
    database
      .prepare(
        `INSERT INTO household_members (
           user_id, household_id, profile_id, role, created_at
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        'user-1',
        'household-1',
        'profile-1',
        'owner',
        '2026-08-09T08:00:00.000Z',
      );

    migrateDatabase(database);
    const member = database
      .prepare(
        'SELECT login_identifier FROM household_members WHERE user_id = ?',
      )
      .get('user-1');
    database.close();

    expect(member).toEqual({ login_identifier: 'ancien-identifiant' });
  });
});
