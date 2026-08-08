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
    expect(migrations).toEqual([{ version: 1 }, { version: 2 }]);
  });
});
