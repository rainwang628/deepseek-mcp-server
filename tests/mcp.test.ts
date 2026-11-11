import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture } from './helpers.js';
import { MOCK_ANSWER } from '../scripts/mock-deepseek.js';
const args = () => ({ request_id: randomUUID(), prompt: 'Summarize this explicitly delegated task.' });
const data = (r: unknown) => (r as { structuredContent: Record<string, any> }).structuredContent;

test('standard MCP initializes, discovers schemas, health and dry-run make zero upstream calls', async t => {
  const f = await fixture(); t.after(() => f.close());
  const client = await f.client();
  const tools = (await client.listTools()).tools;
  assert.deepEqual(tools.map(x => x.name), ['health_check', 'ask_deepseek']);
  assert.equal(tools[1]!.annotations?.readOnlyHint, false);
  assert.equal(tools[1]!.inputSchema.additionalProperties, false);
  const health = data(await client.callTool({ name: 'health_check', arguments: {} }));
  assert.equal(health.routing_enabled, false);
  assert.equal(health.paid_requests_allowed, false);
  assert.equal(health.upstream_checked, false);
  const estimate = data(await client.callTool({ name: 'ask_deepseek', arguments: { ...args(), dry_run: true } }));
  assert.equal(estimate.dry_run, true);
  assert.ok(estimate.estimate.reserved_cost_usd > 0);
  assert.equal(f.application.ledger.summary(f.c).calls_today, 0);
  assert.equal(f.mock.state.calls, 0);
});
test('routing is blocked by default; tool cannot enable routing or supply an API key', async t => {
  const f = await fixture(); t.after(() => f.close()); const client = await f.client();
  const r = await client.callTool({ name: 'ask_deepseek', arguments: args() });
  assert.equal(r.isError, true); assert.equal(data(r).error.code, 'ROUTING_DISABLED');
  for (const extra of [{ routing_enabled: true }, { api_key: 'must-not-be-accepted' }, { dry_run: 'false' }]) {
    const invalid = await client.callTool({ name: 'ask_deepseek', arguments: { ...args(), ...extra } });
    assert.equal(invalid.isError, true);
  }
  assert.equal(f.mock.state.calls, 0);
});
test('invalid model, UUID, missing prompt and token type are rejected through MCP', async t => {
  const f = await fixture({ ROUTING_ENABLED: 'true' }); t.after(() => f.close()); const client = await f.client();
  for (const input of [{ ...args(), model: 'guessed-model' }, { ...args(), request_id: 'not-a-uuid' },
    { request_id: randomUUID() }, { ...args(), prompt: '' }, { ...args(), max_output_tokens: '512' },
    { ...args(), max_output_tokens: 0 }, { ...args(), max_output_tokens: 1.5 }]) {
    const r = await client.callTool({ name: 'ask_deepseek', arguments: input }); assert.equal(r.isError, true);
  }
  const health = await client.callTool({ name: 'health_check', arguments: { extra: true } }); assert.equal(health.isError, true);
  assert.equal(f.mock.state.calls, 0);
});
test('mock completion returns answer, usage, cost and durable budget; no real key reaches mock', async t => {
  const f = await fixture({ ROUTING_ENABLED: 'true', DEEPSEEK_API_KEY: 'test-sentinel-do-not-send' });
  t.after(() => f.close()); const client = await f.client(); const input = args();
  const r = await client.callTool({ name: 'ask_deepseek', arguments: { ...input, max_output_tokens: 32 } });
  assert.equal(r.isError, undefined); const output = data(r);
  assert.equal(output.answer, MOCK_ANSWER); assert.equal(output.mode, 'mock'); assert.equal(output.cost.mock_only, true);
  assert.deepEqual(output.usage, { input_tokens: 8, output_tokens: 6, cached_input_tokens: 0 });
  assert.equal(output.budget.calls_today, 1); assert.equal(output.budget.unresolved_reservations, 0);
  assert.equal(f.mock.state.authorization, undefined);
  const sent = f.mock.state.lastBody as Record<string, any>;
  assert.equal(sent.max_tokens, 32); assert.equal(sent.thinking.type, 'disabled'); assert.equal(sent.stream, false);
  assert.equal(sent.tools, undefined);
  const duplicate = await client.callTool({ name: 'ask_deepseek', arguments: input });
  assert.equal(data(duplicate).error.code, 'DUPLICATE_REQUEST'); assert.equal(f.mock.state.calls, 1);
  const logs = f.lines.join('');
  for (const secret of [input.prompt, MOCK_ANSWER, 'test-sentinel-do-not-send', f.c.MCP_BEARER_TOKEN]) assert.equal(logs.includes(secret), false);
  assert.match(logs, /request_completed/);
});
test('input, total, output and per-request cost limits reject before upstream dispatch', async t => {
  const f = await fixture({ ROUTING_ENABLED: 'true' }); t.after(() => f.close()); const client = await f.client();
  for (const input of [{ ...args(), prompt: '中'.repeat(5000) }, { ...args(), max_output_tokens: 2049 },
    { ...args(), max_cost_usd: 0.000000001 }]) {
    const r = await client.callTool({ name: 'ask_deepseek', arguments: input }); assert.equal(r.isError, true);
  }
  assert.equal(f.mock.state.calls, 0);
});
test('live mode needs separate paid authorization even when routing is enabled', async t => {
  const f = await fixture({ DEEPSEEK_MODE: 'live', ROUTING_ENABLED: 'true' }); t.after(() => f.close());
  const r = await (await f.client()).callTool({ name: 'ask_deepseek', arguments: args() });
  assert.equal(data(r).error.code, 'PAID_REQUESTS_DISABLED'); assert.equal(f.mock.state.calls, 0);
});
test('live mode with paid flag and missing key still cannot dispatch', async t => {
  const f = await fixture({ DEEPSEEK_MODE: 'live', ROUTING_ENABLED: 'true', ALLOW_PAID_REQUESTS: 'true' }); t.after(() => f.close());
  const r = await (await f.client()).callTool({ name: 'ask_deepseek', arguments: args() });
  assert.equal(data(r).error.code, 'NOT_CONFIGURED');
});
test('daily call limit is shared across MCP requests and enforced before dispatch', async t => {
  const f = await fixture({ ROUTING_ENABLED: 'true', MAX_CALLS_PER_DAY: '1' }); t.after(() => f.close());
  const client = await f.client();
  await client.callTool({ name: 'ask_deepseek', arguments: args() });
  const r = await client.callTool({ name: 'ask_deepseek', arguments: args() });
  assert.equal(data(r).error.code, 'BUDGET_EXCEEDED'); assert.equal(f.mock.state.calls, 1);
});
test('parallel requests reserve before dispatch; daily budget cannot be double spent', async t => {
  const f = await fixture({ ROUTING_ENABLED: 'true', DAILY_BUDGET_USD: '0.0025' }); t.after(() => f.close());
  f.mock.state.delayMs = 100;
  const a = await f.client(); const b = await f.client();
  const rs = await Promise.all([a, b].map(client => client.callTool({ name: 'ask_deepseek', arguments: args() })));
  assert.equal(rs.filter(r => r.isError).length, 1);
  assert.equal(f.mock.state.calls, 1);
});
