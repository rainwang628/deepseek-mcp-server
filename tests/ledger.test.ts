import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { BudgetLedger } from '../src/ledger.js';
import { AppError } from '../src/errors.js';
import { toNanos, costNanos } from '../src/pricing.js';
import { config } from './helpers.js';
const date = new Date('2026-11-11T12:00:00Z');
test('pending/uncertain reservations survive restart and lifetime budget survives UTC midnight', t => {
  const dir = mkdtempSync(join(tmpdir(), 'deepseek-ledger-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'budget.sqlite'); const c = config({ TOTAL_BUDGET_USD: '0.003', DAILY_BUDGET_USD: '0.003' });
  const a = new BudgetLedger(path); const id = randomUUID();
  a.reserve(id, toNanos(0.002), c, date); a.uncertain(id, 'mock'); a.close();
  const b = new BudgetLedger(path); t.after(() => b.close());
  assert.equal(b.summary(c, date).accounted_total_usd, 0.002);
  assert.equal(b.summary(c, date).unresolved_reservations, 1);
  assert.throws(() => b.reserve(id, 1, c, date), (e: unknown) => e instanceof AppError && e.code === 'DUPLICATE_REQUEST');
  assert.throws(() => b.reserve(randomUUID(), toNanos(0.002), c, new Date('2026-11-12T00:00:00Z')),
    (e: unknown) => e instanceof AppError && e.code === 'BUDGET_EXCEEDED');
});
test('multiple database connections share atomic budget, and mock/live have separate accounts', t => {
  const dir = mkdtempSync(join(tmpdir(), 'deepseek-ledger-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'budget.sqlite'); const c = config({ DAILY_BUDGET_USD: '0.003' });
  const a = new BudgetLedger(path); const b = new BudgetLedger(path); t.after(() => { a.close(); b.close(); });
  a.reserve(randomUUID(), toNanos(0.002), c, date);
  assert.throws(() => b.reserve(randomUUID(), toNanos(0.002), c, date));
  b.reserve(randomUUID(), toNanos(0.002), { ...c, DEEPSEEK_MODE: 'live' }, date);
  assert.equal(a.summary(c, date).calls_today, 1);
});
test('success releases unused reservation; unexpected overrun persists a safety halt', t => {
  const ledger = new BudgetLedger(':memory:'); t.after(() => ledger.close()); const c = config();
  const id = randomUUID(); ledger.reserve(id, toNanos(0.002), c, date); ledger.settle(id, 'mock', toNanos(0.001));
  assert.equal(ledger.summary(c, date).accounted_total_usd, 0.001);
  assert.throws(() => ledger.settle(id, 'mock', 0));
  const over = randomUUID(); ledger.reserve(over, 1, c, date); ledger.settle(over, 'mock', 2);
  assert.equal(ledger.summary(c, date).halted, true);
  assert.throws(() => ledger.reserve(randomUUID(), 1, c, date));
});
test('integer cost calculation uses official peak prices and cached-input discount', () => {
  assert.equal(costNanos('deepseek-v4-pro', 1000, 500), 3300000);
  assert.equal(costNanos('deepseek-flash', 1000, 500), 900000);
  assert.equal(costNanos('deepseek-v4-pro', 10, 6, 8), 26752);
});
