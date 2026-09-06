import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../db/database.js';
import { WebBudget } from './web-budget.js';

describe('shared Tavily budget', () => {
  it('reserves atomically across clients and retains uncertain requests after restart', () => {
    const db = openDatabase(':memory:');
    try {
      const chat = new WebBudget(db),
        maison = new WebBudget(db);
      chat.reconcile(946, 1000);
      const id = chat.reserve(2);
      maison.reserve(2);
      expect(() => chat.reserve(2)).toThrow('WEB_BUDGET_EXHAUSTED');
      chat.settle(id, 2);
      expect(new WebBudget(db).reconcile(948, 1000).creditsUsed).toBe(950);
      expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally {
      db.close();
    }
  });
});
