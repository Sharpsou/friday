import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { migrateDatabase } from '../db/database.js';

// Read-only source. All migrations run on a restored copy under the supplied directory.
const [sourceArgument, directoryArgument] = process.argv.slice(2);
if (!sourceArgument || !directoryArgument)
  throw new Error(
    'Usage: tsx src/maison/check-migration.ts SOURCE.sqlite OUTPUT_DIRECTORY',
  );
const source = resolve(sourceArgument);
const directory = resolve(directoryArgument);
mkdirSync(directory, { recursive: true });
const output = mkdtempSync(join(directory, 'maison-migration-'));
const backupPath = join(output, 'before.sqlite');
const restoredPath = join(output, 'restored.sqlite');
const live = new Database(source, { readonly: true, fileMustExist: true });
try {
  await live.backup(backupPath);
} finally {
  live.close();
}
const backup = new Database(backupPath, { readonly: true });
try {
  await backup.backup(restoredPath);
} finally {
  backup.close();
}
const restored = new Database(restoredPath);
try {
  const tables = (
    restored
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'",
      )
      .all() as Array<{ name: string }>
  ).map((r) => r.name);
  const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
  const columns = new Map(
    tables.map((table) => [
      table,
      (
        restored.prepare(`PRAGMA table_info(${quote(table)})`).all() as Array<{
          name: string;
        }>
      )
        .map((column) => quote(column.name))
        .join(','),
    ]),
  );
  const digest = (table: string) =>
    createHash('sha256')
      .update(
        JSON.stringify(
          restored
            .prepare(`SELECT ${columns.get(table)!} FROM ${quote(table)}`)
            .all(),
        ),
      )
      .digest('hex');
  const before = new Map(tables.map((table) => [table, digest(table)]));
  const versionBefore = (
    restored
      .prepare('SELECT MAX(version) AS version FROM schema_migrations')
      .get() as { version: number }
  ).version;
  migrateDatabase(restored);
  if (
    restored.pragma('integrity_check', { simple: true }) !== 'ok' ||
    (restored.pragma('foreign_key_check') as unknown[]).length
  )
    throw new Error('RESTORE_INTEGRITY_FAILED');
  if (tables.some((table) => before.get(table) !== digest(table)))
    throw new Error('EXISTING_DATA_CHANGED');
  const versionAfter = (
    restored
      .prepare('SELECT MAX(version) AS version FROM schema_migrations')
      .get() as { version: number }
  ).version;
  const report = {
    at: new Date().toISOString(),
    sourceReadOnly: true,
    versionBefore,
    versionAfter,
    integrity: 'ok',
    existingTablesUnchanged: true,
    backupPath,
    restoredPath,
  };
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify(report)}\n`);
} finally {
  restored.close();
}
