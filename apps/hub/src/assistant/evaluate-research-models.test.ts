import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { migrateDatabase } from '../db/database.js';
import {
  loadBenchmarkCases,
  responseSurfaceMetrics,
} from './evaluate-research-models.js';

describe('assistant research model benchmark', () => {
  it('measures citations without accepting unknown source identifiers', () => {
    expect(responseSurfaceMetrics('Fait [S1], erreur [S9].', 2)).toEqual({
      answerCharacters: 23,
      citationCount: 2,
      unknownCitationCount: 1,
    });
  });

  it('loads anonymized completed Web cases from a read-only-compatible schema', () => {
    const database = new Database(':memory:');
    migrateDatabase(database, 19);
    const now = '2026-08-26T00:00:00.000Z';
    database
      .prepare(
        `INSERT INTO assistant_conversations(id, profile_id, title, mode, created_at, updated_at)
         VALUES ('conversation', 'profile', 'Test', 'web_deep', ?, ?)`,
      )
      .run(now, now);
    database
      .prepare(
        `INSERT INTO assistant_messages(
           id, conversation_id, profile_id, role, content, requested_mode,
           conversation_mode, thinking_policy, thinking_used, research_outcome,
           credits_used, assistant_model, created_at
         ) VALUES ('user', 'conversation', 'profile', 'user', 'Question précise',
                   'web', 'web_deep', 'auto', 0, 'completed', 1, 'qwen3.5', ?)`,
      )
      .run(now);
    database
      .prepare(
        `INSERT INTO assistant_runs(
           id, client_request_id, conversation_id, profile_id, user_message_id,
           requested_mode, status, stage_label, search_queries_json,
           conversation_mode, thinking_policy, thinking_used, research_outcome,
           credits_used, assistant_model, created_at, updated_at
         ) VALUES ('run', 'request', 'conversation', 'profile', 'user', 'web',
                   'completed', 'Terminé', '["question preuve"]', 'web_deep',
                   'auto', 0, 'completed', 1, 'qwen3.5', ?, ?)`,
      )
      .run(now, now);
    database
      .prepare(
        `INSERT INTO assistant_sources(
           run_id, source_id, title, url, domain, published_at, retrieved_at,
           excerpt, provider
         ) VALUES ('run', 'S1', 'Source', 'https://example.com/a', 'example.com',
                   NULL, ?, 'question preuve directe', 'tavily')`,
      )
      .run(now);

    const cases = loadBenchmarkCases(database, 40);
    database.close();

    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({
      mode: 'web_deep',
      question: 'Question précise',
      queries: ['question preuve'],
      runId: 'run',
    });
    expect(cases[0]?.evidence[0]?.content).toContain('question preuve directe');
  });
});
