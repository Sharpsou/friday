import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../db/database.js';
import { FridayMemoryReader } from './friday-memory.js';

const PROFILE = '11111111-1111-4111-8111-111111111111';
const OTHER_PROFILE = '22222222-2222-4222-8222-222222222222';
const HOUSEHOLD = '33333333-3333-4333-8333-333333333333';
const OTHER_HOUSEHOLD = '44444444-4444-4444-8444-444444444444';

describe('FridayMemoryReader', () => {
  const databases: ReturnType<typeof openDatabase>[] = [];

  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
  });

  it('returns confirmed robot memory only for the requesting household', () => {
    const database = openDatabase(':memory:');
    databases.push(database);
    const now = '2026-08-25T00:00:00.000Z';
    database.exec(`
      INSERT INTO households(id, name, created_at) VALUES
        ('${HOUSEHOLD}', 'Maison', '${now}'),
        ('${OTHER_HOUSEHOLD}', 'Autre', '${now}');
      INSERT INTO "user"(id, name, email, emailVerified, createdAt, updatedAt) VALUES
        ('u1', 'Alice', 'alice@example.test', 1, '${now}', '${now}'),
        ('u2', 'Bob', 'bob@example.test', 1, '${now}', '${now}');
      INSERT INTO household_members(user_id, household_id, profile_id, role, created_at) VALUES
        ('u1', '${HOUSEHOLD}', '${PROFILE}', 'owner', '${now}'),
        ('u2', '${OTHER_HOUSEHOLD}', '${OTHER_PROFILE}', 'owner', '${now}');
      INSERT INTO robot_rooms(id, household_id, name, status, created_at, updated_at) VALUES
        ('r1', '${HOUSEHOLD}', 'Salon', 'confirmed', '${now}', '${now}'),
        ('r2', '${OTHER_HOUSEHOLD}', 'Bureau', 'confirmed', '${now}', '${now}');
      INSERT INTO robot_memory_entities(
        id, household_id, room_id, kind, class_label, display_name, spatial_key,
        confidence, status, sighting_count, viewpoint_keys_json, first_seen_at,
        last_seen_at, last_x, last_y, updated_at
      ) VALUES
        ('e1', '${HOUSEHOLD}', 'r1', 'object', 'remote', 'Télécommande', '1:1',
         0.92, 'confirmed', 4, '["1:1","2:1"]', '${now}', '${now}', 0.4, 0.6, '${now}'),
        ('e2', '${OTHER_HOUSEHOLD}', 'r2', 'object', 'screen', 'Écran secret', '1:1',
         0.99, 'confirmed', 9, '["1:1","2:1"]', '${now}', '${now}', 0.5, 0.5, '${now}');
    `);

    const facts = new FridayMemoryReader(database).query(
      PROFILE,
      'Où se trouve la télécommande vue par le robot ?',
    );

    expect(facts).toEqual([
      expect.objectContaining({
        confidence: 0.92,
        id: 'F1',
        source: 'robot',
        title: 'Télécommande',
      }),
    ]);
    expect(JSON.stringify(facts)).not.toContain('Écran secret');
  });

  it('returns no fact when the profile has no household membership', () => {
    const database = openDatabase(':memory:');
    databases.push(database);

    expect(
      new FridayMemoryReader(database).query(
        '55555555-5555-4555-8555-555555555555',
        'Que sais-tu ?',
      ),
    ).toEqual([]);
  });
});
