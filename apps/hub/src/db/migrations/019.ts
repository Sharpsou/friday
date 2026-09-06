export const MIGRATION_019 = `
  CREATE TABLE assistant_exa_usage (
    month TEXT PRIMARY KEY,
    calls INTEGER NOT NULL DEFAULT 0 CHECK (calls >= 0),
    successes INTEGER NOT NULL DEFAULT 0 CHECK (successes >= 0),
    empty_results INTEGER NOT NULL DEFAULT 0 CHECK (empty_results >= 0),
    rate_limits INTEGER NOT NULL DEFAULT 0 CHECK (rate_limits >= 0),
    failures INTEGER NOT NULL DEFAULT 0 CHECK (failures >= 0),
    updated_at TEXT NOT NULL
  );

  CREATE TABLE assistant_exa_health (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    status TEXT NOT NULL CHECK (status IN ('untested', 'available', 'rate_limited', 'unavailable')),
    last_attempt_at TEXT,
    last_message TEXT,
    cooldown_until TEXT
  );
  INSERT INTO assistant_exa_health(id, status) VALUES (1, 'untested');

  UPDATE assistant_sources SET provider = 'tavily' WHERE provider = 'legacy';
`;

export const MIGRATION_019_COLUMNS = [
  {
    table: 'assistant_research_attempts',
    column: 'provider',
    definition:
      "provider TEXT NOT NULL DEFAULT 'tavily' CHECK (provider IN ('tavily', 'exa'))",
  },
  {
    table: 'assistant_research_attempts',
    column: 'diagnostic_status',
    definition:
      "diagnostic_status TEXT CHECK (diagnostic_status IN ('success', 'empty', 'rate_limited', 'unavailable', 'failed', 'skipped'))",
  },
  {
    table: 'assistant_research_attempts',
    column: 'result_count',
    definition:
      'result_count INTEGER NOT NULL DEFAULT 0 CHECK (result_count >= 0)',
  },
  {
    table: 'assistant_research_attempts',
    column: 'duration_ms',
    definition:
      'duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0)',
  },
  {
    table: 'assistant_sources',
    column: 'provider',
    definition:
      "provider TEXT NOT NULL DEFAULT 'tavily' CHECK (provider IN ('tavily', 'exa'))",
  },
] as const;
