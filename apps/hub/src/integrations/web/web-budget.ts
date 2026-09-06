import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

/** Shared account ledger. Unknown network outcomes remain charged conservatively. */
export class WebBudget {
  constructor(private readonly database: Database.Database) {}
  reconcile(used: number, limit: number) {
    const month = new Date().toISOString().slice(0, 7);
    return this.database.transaction(() => {
      const spent = (
        this.database
          .prepare(
            'SELECT COALESCE(SUM(credits),0) AS credits FROM web_budget_reservations WHERE month=?',
          )
          .get(month) as { credits: number }
      ).credits;
      this.database
        .prepare(
          'INSERT INTO web_budget_months(month, baseline, ceiling) VALUES(?,?,?) ON CONFLICT(month) DO UPDATE SET baseline=MAX(baseline,excluded.baseline), ceiling=excluded.ceiling',
        )
        .run(
          month,
          Math.max(0, used - spent),
          Math.max(0, Math.min(950, limit - 50)),
        );
      return this.usage(month);
    })();
  }
  private usage(month: string) {
    const value = this.database
      .prepare('SELECT baseline, ceiling FROM web_budget_months WHERE month=?')
      .get(month) as { baseline: number; ceiling: number } | undefined;
    if (!value) throw new Error('WEB_BUDGET_UNAVAILABLE');
    const spent = (
      this.database
        .prepare(
          'SELECT COALESCE(SUM(credits),0) AS credits FROM web_budget_reservations WHERE month=?',
        )
        .get(month) as { credits: number }
    ).credits;
    return { creditsUsed: value.baseline + spent, limit: value.ceiling + 50 };
  }
  reserve(credits: number) {
    const month = new Date().toISOString().slice(0, 7);
    return this.database.transaction(() => {
      const usage = this.usage(month);
      if (usage.creditsUsed + credits > usage.limit - 50)
        throw new Error('WEB_BUDGET_EXHAUSTED');
      const id = randomUUID();
      this.database
        .prepare(
          "INSERT INTO web_budget_reservations VALUES(?,?,?,'reserved',?)",
        )
        .run(id, month, credits, new Date().toISOString());
      return id;
    })();
  }
  settle(id: string, credits: number) {
    this.database
      .prepare(
        "UPDATE web_budget_reservations SET credits=MAX(credits,?), state='spent' WHERE id=?",
      )
      .run(credits, id);
  }
}
