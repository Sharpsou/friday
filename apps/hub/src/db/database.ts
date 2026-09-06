import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { MIGRATION_001 } from './migrations/001.js';
import { MIGRATION_002 } from './migrations/002.js';
import { MIGRATION_003 } from './migrations/003.js';
import { MIGRATION_004 } from './migrations/004.js';
import { MIGRATION_005 } from './migrations/005.js';
import { MIGRATION_006 } from './migrations/006.js';
import { MIGRATION_007 } from './migrations/007.js';
import { MIGRATION_008 } from './migrations/008.js';
import { MIGRATION_009 } from './migrations/009.js';
import { MIGRATION_010 } from './migrations/010.js';
import { MIGRATION_011 } from './migrations/011.js';
import { REMOVE_WEB_RESEARCH_TABLES } from './migrations/012-013.js';
import { MIGRATION_014 } from './migrations/014.js';
import { MIGRATION_015 } from './migrations/015.js';
import { MIGRATION_016 } from './migrations/016.js';
import { MIGRATION_017 } from './migrations/017.js';
import { MIGRATION_018 } from './migrations/018.js';
import { MIGRATION_019, MIGRATION_019_COLUMNS } from './migrations/019.js';
import { MIGRATION_020 } from './migrations/020.js';
import { MIGRATION_021 } from './migrations/021.js';
import { MIGRATION_022 } from './migrations/022.js';
import { MIGRATION_023 } from './migrations/023.js';
import { MIGRATION_024 } from './migrations/024.js';
import { MIGRATION_025 } from './migrations/025.js';
import { MIGRATION_026 } from './migrations/026.js';
import { MIGRATION_027 } from './migrations/027.js';
import { MIGRATION_028 } from './migrations/028.js';
import { MIGRATION_029 } from './migrations/029.js';
import { MIGRATION_030 } from './migrations/030.js';
import { MIGRATION_031 } from './migrations/031.js';
import { MIGRATION_032 } from './migrations/032.js';
import { MIGRATION_033 } from './migrations/033.js';
import { MIGRATION_034 } from './migrations/034.js';
import { MIGRATION_035 } from './migrations/035.js';
import { MIGRATION_036 } from './migrations/036.js';
import { MIGRATION_037 } from './migrations/037.js';
import { MIGRATION_038 } from './migrations/038.js';
import { MIGRATION_039 } from './migrations/039.js';
import { MIGRATION_040 } from './migrations/040.js';
import { MIGRATION_041 } from './migrations/041.js';
import { MIGRATION_042 } from './migrations/042.js';
import { MIGRATION_043 } from './migrations/043.js';
import { MIGRATION_044 } from './migrations/044.js';
import { MAISON_MIGRATION } from './migrations/045.js';
import { MIGRATION_046 } from './migrations/046.js';
import { MIGRATION_047 } from './migrations/047.js';

const MIGRATIONS = [
  { sql: MIGRATION_001, version: 1 },
  { sql: MIGRATION_002, version: 2 },
  { sql: MIGRATION_003, version: 3 },
  { sql: MIGRATION_004, version: 4 },
  { sql: MIGRATION_005, version: 5 },
  { sql: MIGRATION_006, version: 6 },
  { sql: MIGRATION_007, version: 7 },
  { sql: MIGRATION_008, version: 8 },
  { sql: MIGRATION_009, version: 9 },
  { sql: MIGRATION_010, version: 10 },
  { sql: MIGRATION_011, version: 11 },
  { sql: REMOVE_WEB_RESEARCH_TABLES, version: 12 },
  { sql: REMOVE_WEB_RESEARCH_TABLES, version: 13 },
  { sql: MIGRATION_014, version: 14 },
  { sql: MIGRATION_015, version: 15 },
  { sql: MIGRATION_016, version: 16 },
  { sql: MIGRATION_017, version: 17 },
  { sql: MIGRATION_018, version: 18 },
  { sql: MIGRATION_019, version: 19 },
  { sql: MIGRATION_020, version: 20 },
  { sql: MIGRATION_021, version: 21 },
  { sql: MIGRATION_022, version: 22 },
  { sql: MIGRATION_023, version: 23 },
  { sql: MIGRATION_024, version: 24 },
  { sql: MIGRATION_025, version: 25 },
  { sql: MIGRATION_026, version: 26 },
  { sql: MIGRATION_027, version: 27 },
  { sql: MIGRATION_028, version: 28 },
  { sql: MIGRATION_029, version: 29 },
  { sql: MIGRATION_030, version: 30 },
  { sql: MIGRATION_031, version: 31 },
  { sql: MIGRATION_032, version: 32 },
  { sql: MIGRATION_033, version: 33 },
  { sql: MIGRATION_034, version: 34 },
  { sql: MIGRATION_035, version: 35 },
  { sql: MIGRATION_036, version: 36 },
  { sql: MIGRATION_037, version: 37 },
  { sql: MIGRATION_038, version: 38 },
  { sql: MIGRATION_039, version: 39 },
  { sql: MIGRATION_040, version: 40 },
  { sql: MIGRATION_041, version: 41 },
  { sql: MIGRATION_042, version: 42 },
  { sql: MIGRATION_043, version: 43 },
  { sql: MIGRATION_044, version: 44 },
  { sql: MAISON_MIGRATION, version: 45 },
  {
    sql: MIGRATION_046,
    version: 46,
  },
  {
    version: 47,
    sql: MIGRATION_047,
  },
] as const;

export function migrateDatabase(
  database: Database.Database,
  throughVersion = Number.POSITIVE_INFINITY,
): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  for (const migration of MIGRATIONS) {
    if (migration.version > throughVersion) break;
    const applied = database
      .prepare('SELECT version FROM schema_migrations WHERE version = ?')
      .get(migration.version);
    if (applied) continue;

    database.transaction(() => {
      if (migration.version === 19) {
        for (const column of MIGRATION_019_COLUMNS) {
          const exists = database
            .prepare(`SELECT 1 FROM pragma_table_info(?) WHERE name = ?`)
            .get(column.table, column.column);
          if (!exists) {
            database.exec(
              `ALTER TABLE ${column.table} ADD COLUMN ${column.definition}`,
            );
          }
        }
      }
      if (migration.version === 46) {
        const table = database
          .prepare(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='chat_runs'",
          )
          .get() as { sql: string };
        const indexes = database
          .prepare(
            "SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='chat_runs' AND sql IS NOT NULL",
          )
          .all() as Array<{ sql: string }>;
        const definition = table.sql
          .replace(
            /CREATE TABLE ["`]?chat_runs["`]?/u,
            'CREATE TABLE chat_runs_next',
          )
          .replace(
            'model_calls BETWEEN 0 AND 6',
            'model_calls BETWEEN 0 AND 12',
          );
        database.exec(definition);
        database.exec(
          'INSERT INTO chat_runs_next SELECT * FROM chat_runs; DROP TABLE chat_runs; ALTER TABLE chat_runs_next RENAME TO chat_runs;',
        );
        for (const index of indexes) database.exec(index.sql);
      }
      database.exec(migration.sql);
      database
        .prepare(
          'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
        )
        .run(migration.version, new Date().toISOString());
    })();
  }
}

export function openDatabase(filename: string): Database.Database {
  if (filename !== ':memory:') {
    mkdirSync(dirname(filename), { recursive: true });
  }

  const database = new Database(filename);
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 5000');
  if (filename !== ':memory:') {
    database.pragma('journal_mode = WAL');
  }

  migrateDatabase(database);

  return database;
}
