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
      INSERT INTO robot_visual_places(
        id, household_id, status, label, confidence, observation_count,
        first_seen_at, last_seen_at, updated_at
      ) VALUES
        ('r1', '${HOUSEHOLD}', 'confirmed', 'Salon', 0.92, 4, '${now}', '${now}', '${now}'),
        ('r2', '${OTHER_HOUSEHOLD}', 'confirmed', 'Bureau', 0.99, 9, '${now}', '${now}', '${now}');
      INSERT INTO robot_visual_objects(
        id, household_id, place_id, class_label, display_name, confidence,
        sighting_count, first_seen_at, last_seen_at, updated_at
      ) VALUES
        ('e1', '${HOUSEHOLD}', 'r1', 'remote', 'Télécommande', 0.92, 4, '${now}', '${now}', '${now}'),
        ('e2', '${OTHER_HOUSEHOLD}', 'r2', 'screen', 'Écran secret', 0.99, 9, '${now}', '${now}', '${now}');
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
