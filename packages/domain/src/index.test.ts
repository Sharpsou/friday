import { describe, expect, it } from 'vitest';

import { normalizeTaskTitle } from './index.js';

describe('normalizeTaskTitle', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeTaskTitle('  Sortir   les poubelles  ')).toBe(
      'Sortir les poubelles',
    );
  });
});
