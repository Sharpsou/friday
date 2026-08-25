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
    expect(latest.version).toBe(24);
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
      { version: 15 },
      { version: 16 },
      { version: 17 },
      { version: 18 },
      { version: 19 },
      { version: 20 },
      { version: 21 },
      { version: 22 },
      { version: 23 },
      { version: 24 },
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
    expect(migrations.at(-1)).toEqual({ version: 24 });
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
    expect(migrations.at(-1)).toEqual({ version: 24 });
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

  it('adds profile-private watches, durable runs, FTS and idempotent states', () => {
    const database = new Database(':memory:');
    migrateDatabase(database, 15);

    migrateDatabase(database);
    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')")
      .all() as Array<{ name: string }>;
    database.close();

    expect(tables.map((table) => table.name)).toEqual(
      expect.arrayContaining([
        'watch_feeds',
        'watches',
        'watch_sources',
        'watch_articles',
        'watch_articles_fts',
        'watch_matches',
        'watch_article_states',
        'watch_state_operations',
        'watch_digests',
        'watch_runs',
        'watch_discovery_runs',
        'watch_source_candidates',
        'watch_concepts',
        'watch_topics',
        'watch_topics_fts',
        'watch_topic_articles',
        'watch_topic_concepts',
        'watch_topic_events',
      ]),
    );
  });

  it('upgrades an existing Watch database to the orchestrated memory schema', () => {
    const database = new Database(':memory:');
    migrateDatabase(database, 16);
    database
      .prepare(
        `INSERT INTO watches(
           id, profile_id, name, question, include_keywords_json,
           exclude_keywords_json, cadence, local_time, weekday, time_zone,
           status, next_digest_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'daily', '07:30', NULL, 'Europe/Paris',
           'active', ?, ?, ?)`,
      )
      .run(
        'watch-existing',
        'profile-a',
        'Veille existante',
        'Quelles nouveautÃ©s ?',
        '["IA","Python"]',
        '[]',
        '2026-08-13T05:30:00.000Z',
        '2026-08-12T05:30:00.000Z',
        '2026-08-12T05:30:00.000Z',
      );

    migrateDatabase(database);
    const watch = database
      .prepare(
        `SELECT name, languages_json, last_web_search_at, memory_initialized_at
           FROM watches WHERE id = ?`,
      )
      .get('watch-existing');
    const runColumns = database
      .prepare('PRAGMA table_info(watch_runs)')
      .all() as Array<{ name: string }>;
    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    database.close();

    expect(watch).toEqual({
      name: 'Veille existante',
      languages_json: '["fr","en"]',
      last_web_search_at: null,
      memory_initialized_at: null,
    });
    expect(runColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'stage',
        'progress_current',
        'progress_total',
        'checkpoint_json',
        'trigger',
      ]),
    );
    expect(tables.map((table) => table.name)).toEqual(
      expect.arrayContaining([
        'watch_discovery_runs',
        'watch_concepts',
        'watch_topics',
        'watch_web_usage',
      ]),
    );
  });

  it('adds durable Watch scheduling reasons without losing version 17 runs', () => {
    const database = new Database(':memory:');
    migrateDatabase(database, 17);
    database
      .prepare(
        `INSERT INTO watches(
           id, profile_id, name, question, include_keywords_json,
           exclude_keywords_json, languages_json, cadence, local_time, weekday,
           time_zone, status, next_digest_at, created_at, updated_at
         ) VALUES ('watch-v17', 'profile-a', 'Veille', 'Question', '["IA"]',
           '[]', '["fr"]', 'daily', '07:30', NULL, 'Europe/Paris', 'active',
           '2026-08-13T05:30:00.000Z', '2026-08-12T05:30:00.000Z',
           '2026-08-12T05:30:00.000Z')`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO watch_runs(
           id, watch_id, profile_id, status, manual, stage, created_at, updated_at
         ) VALUES ('run-v17', 'watch-v17', 'profile-a', 'completed', 1,
           'completed', '2026-08-12T05:30:00.000Z',
           '2026-08-12T05:31:00.000Z')`,
      )
      .run();

    migrateDatabase(database);
    const watch = database
      .prepare('SELECT memory_initialized_at FROM watches WHERE id = ?')
      .get('watch-v17');
    const run = database
      .prepare('SELECT trigger, manual FROM watch_runs WHERE id = ?')
      .get('run-v17');
    database.close();

    expect(watch).toEqual({ memory_initialized_at: null });
    expect(run).toEqual({ trigger: 'manual', manual: 1 });
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
    const attemptColumns = database
      .prepare('PRAGMA table_info(assistant_research_attempts)')
      .all() as Array<{ name: string }>;
    const sourceColumns = database
      .prepare('PRAGMA table_info(assistant_sources)')
      .all() as Array<{ name: string }>;
    database.close();

    expect(tables.map((table) => table.name)).toEqual(
      expect.arrayContaining([
        'assistant_conversations',
        'assistant_messages',
        'assistant_runs',
        'assistant_sources',
        'assistant_run_events',
        'assistant_exa_usage',
        'assistant_exa_health',
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
    expect(messageColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['web_depth', 'assistant_model']),
    );
    expect(runColumns.map((column) => column.name)).toContain(
      'assistant_model',
    );
    expect(attemptColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'provider',
        'diagnostic_status',
        'result_count',
        'duration_ms',
      ]),
    );
    expect(sourceColumns.map((column) => column.name)).toContain('provider');
  });

  it('accepts the legacy Assistant source provider column during migration 19', () => {
    const database = new Database(':memory:');
    migrateDatabase(database, 18);
    database.exec(
      "ALTER TABLE assistant_sources ADD COLUMN provider TEXT NOT NULL DEFAULT 'legacy'",
    );

    migrateDatabase(database);

    const providerColumns = database
      .prepare(
        "SELECT name FROM pragma_table_info('assistant_sources') WHERE name = 'provider'",
      )
      .all();
    const migration = database
      .prepare('SELECT version FROM schema_migrations WHERE version = 19')
      .get();
    database.close();

    expect(providerColumns).toHaveLength(1);
    expect(migration).toEqual({ version: 19 });
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

  it('adds visual localization without discarding version 23 map geometry', () => {
    const database = new Database(':memory:');
    migrateDatabase(database, 23);
    const household = '1030b4f6-1e0f-48fa-adab-865750ce597d';
    database
      .prepare(
        `INSERT INTO robot_mapping_sessions(
           id, household_id, name, status, point_count, storage_bytes,
           started_at, created_at, updated_at
         ) VALUES (?, ?, 'Carte existante', 'explored', 1, 96, ?, ?, ?)`,
      )
      .run(
        'e10ccf3c-b3af-4ed1-a9af-2e1e76b83318',
        household,
        '2026-08-25T12:00:00.000Z',
        '2026-08-25T12:00:00.000Z',
        '2026-08-25T12:00:00.000Z',
      );
    database
      .prepare(
        `INSERT INTO robot_map_points(
           id, household_id, session_id, sequence, x, y, heading, uncertainty,
           recorded_at
         ) VALUES (?, ?, ?, 0, 1.2, -0.4, 0.3, 1, ?)`,
      )
      .run(
        'a485a08b-1b02-4817-9a7d-6a9916f3cf55',
        household,
        'e10ccf3c-b3af-4ed1-a9af-2e1e76b83318',
        '2026-08-25T12:00:00.000Z',
      );
    database
      .prepare(
        `INSERT INTO robot_map_runtime(
           household_id, operating_mode, x, y, heading, uncertainty, updated_at
         ) VALUES (?, 'manual', 1.2, -0.4, 0.3, 1, ?)`,
      )
      .run(household, '2026-08-25T12:00:00.000Z');

    migrateDatabase(database);

    const point = database
      .prepare(
        `SELECT raw_x, raw_y, raw_heading, segment_id
           FROM robot_map_points WHERE household_id = ?`,
      )
      .get(household);
    const tables = database
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table'
          AND name IN ('robot_place_signatures', 'robot_pose_constraints',
                       'robot_localization_events', 'robot_odometry_calibration')`,
      )
      .all() as Array<{ name: string }>;
    database.close();

    expect(point).toEqual({
      raw_x: 1.2,
      raw_y: -0.4,
      raw_heading: 0.3,
      segment_id: 'e10ccf3c-b3af-4ed1-a9af-2e1e76b83318',
    });
    expect(tables).toHaveLength(4);
  });
});
