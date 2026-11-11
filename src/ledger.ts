import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { AppError } from './errors.js';
import { toNanos, toUsd } from './pricing.js';
import type { Config } from './config.js';

export class BudgetLedger {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS calls (
        mode TEXT NOT NULL, request_id TEXT NOT NULL, day TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','succeeded','uncertain')),
        reserved_nanos INTEGER NOT NULL, accounted_nanos INTEGER NOT NULL,
        PRIMARY KEY(mode, request_id)
      );
      CREATE TABLE IF NOT EXISTS safety_halts (mode TEXT PRIMARY KEY);`);
  }
  private totals(mode: Config['DEEPSEEK_MODE'], day: string) {
    return this.db.prepare(`SELECT
      COALESCE(SUM(accounted_nanos),0) AS total,
      COALESCE(SUM(CASE WHEN day=? THEN accounted_nanos ELSE 0 END),0) AS daily,
      COALESCE(SUM(CASE WHEN day=? THEN 1 ELSE 0 END),0) AS calls,
      COALESCE(SUM(CASE WHEN status!='succeeded' THEN 1 ELSE 0 END),0) AS unresolved
      FROM calls WHERE mode=?`).get(day, day, mode) as { total: number; daily: number; calls: number; unresolved: number };
  }
  reserve(id: string, nanos: number, c: Config, now = new Date()): void {
    const day = now.toISOString().slice(0, 10);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (this.db.prepare('SELECT 1 FROM safety_halts WHERE mode=?').get(c.DEEPSEEK_MODE)) throw new AppError('ACCOUNTING_ERROR');
      if (this.db.prepare('SELECT 1 FROM calls WHERE mode=? AND request_id=?').get(c.DEEPSEEK_MODE, id)) {
        throw new AppError('DUPLICATE_REQUEST');
      }
      const totals = this.totals(c.DEEPSEEK_MODE, day);
      if (totals.daily + nanos > toNanos(c.DAILY_BUDGET_USD)
        || totals.total + nanos > toNanos(c.TOTAL_BUDGET_USD) || totals.calls >= c.MAX_CALLS_PER_DAY) {
        throw new AppError('BUDGET_EXCEEDED');
      }
      this.db.prepare('INSERT INTO calls VALUES (?, ?, ?, ?, ?, ?)').run(c.DEEPSEEK_MODE, id, day, 'pending', nanos, nanos);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  settle(id: string, mode: Config['DEEPSEEK_MODE'], actualNanos: number, tokenOverrun = false): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare("SELECT reserved_nanos FROM calls WHERE mode=? AND request_id=? AND status='pending'").get(mode, id) as {reserved_nanos: number} | undefined;
      if (!row) throw new AppError('ACCOUNTING_ERROR');
      this.db.prepare("UPDATE calls SET status='succeeded', accounted_nanos=? WHERE mode=? AND request_id=?").run(actualNanos, mode, id);
      if (tokenOverrun || actualNanos > row.reserved_nanos) this.db.prepare('INSERT OR IGNORE INTO safety_halts VALUES (?)').run(mode);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  uncertain(id: string, mode: Config['DEEPSEEK_MODE']): void {
    this.db.prepare("UPDATE calls SET status='uncertain' WHERE mode=? AND request_id=? AND status='pending'").run(mode, id);
  }
  summary(c: Config, now = new Date()) {
    const s = this.totals(c.DEEPSEEK_MODE, now.toISOString().slice(0, 10));
    return { currency: 'USD', budget_day_timezone: 'UTC', mode: c.DEEPSEEK_MODE,
      accounted_today_usd: toUsd(s.daily), accounted_total_usd: toUsd(s.total),
      daily_budget_usd: c.DAILY_BUDGET_USD, total_budget_usd: c.TOTAL_BUDGET_USD,
      calls_today: s.calls, unresolved_reservations: s.unresolved,
      halted: Boolean(this.db.prepare('SELECT 1 FROM safety_halts WHERE mode=?').get(c.DEEPSEEK_MODE)) };
  }
  close(): void { this.db.close(); }
}
