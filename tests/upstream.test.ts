import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture } from './helpers.js';
import { mockCompletion } from '../scripts/mock-deepseek.js';
const args = () => ({ request_id: randomUUID(), prompt: 'Private task, do not log this.' });
const data = (r: unknown) => (r as { structuredContent: Record<string, any> }).structuredContent;
for (const [status, code] of [[401, 'UPSTREAM_AUTH'], [429, 'UPSTREAM_RATE_LIMIT'], [503, 'UPSTREAM_ERROR']] as const) {
  test(`upstream ${status} is sanitized, never retried, and retains reservation`, async t => {
    const f = await fixture({ ROUTING_ENABLED: 'true' }); t.after(() => f.close());
    f.mock.state.status = status; f.mock.state.response = { error: 'test-sensitive-provider-error' };
    const r = await (await f.client()).callTool({ name: 'ask_deepseek', arguments: args() });
    assert.equal(data(r).error.code, code); assert.equal(f.mock.state.calls, 1);
    assert.equal(f.application.ledger.summary(f.c).unresolved_reservations, 1);
    assert.ok(f.application.ledger.summary(f.c).accounted_total_usd > 0);
    assert.equal(JSON.stringify(r).includes('test-sensitive-provider-error'), false);
    assert.equal(f.lines.join('').includes('test-sensitive-provider-error'), false);
  });
}
test('deadline retains uncertain reservation, duplicate does not retry', async t => {
  const f = await fixture({ ROUTING_ENABLED: 'true', REQUEST_TIMEOUT_MS: '50' }); t.after(() => f.close());
  f.mock.state.delayMs = 150; const client = await f.client(); const input = args();
  const r = await client.callTool({ name: 'ask_deepseek', arguments: input });
  assert.equal(data(r).error.code, 'UPSTREAM_TIMEOUT');
  const duplicate = await client.callTool({ name: 'ask_deepseek', arguments: input });
  assert.equal(data(duplicate).error.code, 'DUPLICATE_REQUEST');
  assert.equal(f.mock.state.calls, 1); assert.equal(f.application.ledger.summary(f.c).unresolved_reservations, 1);
});
test('malformed/missing usage and oversized response fail closed with reservation held', async t => {
  const f = await fixture({ ROUTING_ENABLED: 'true', MAX_RESPONSE_BYTES: '1024' }); t.after(() => f.close()); const client = await f.client();
  for (const response of [{ choices: [] }, { ...mockCompletion(), choices: [{ message: { reasoning_content: 'missing-content-test-sentinel' }, finish_reason: 'length' }] },
    { ...mockCompletion(), usage: { prompt_tokens: -1 } },
    { ...mockCompletion(), usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 6 } },
    { ...mockCompletion(), padding: 'x'.repeat(2000) }]) {
    f.mock.state.response = response;
    const r = await client.callTool({ name: 'ask_deepseek', arguments: args() });
    assert.equal(data(r).error.code, 'UPSTREAM_INVALID_RESPONSE');
  }
  assert.equal(f.application.ledger.summary(f.c).unresolved_reservations, 5);
  assert.equal(f.lines.join('').includes('missing-content-test-sentinel'), false);
});
test('upstream redirects are refused instead of following credential-exfiltration destinations', async t => {
  const f = await fixture({ ROUTING_ENABLED: 'true' }); t.after(() => f.close());
  f.mock.state.status = 307; f.mock.state.redirect = 'https://api.deepseek.com/chat/completions';
  const r = await (await f.client()).callTool({ name: 'ask_deepseek', arguments: args() });
  assert.equal(data(r).error.code, 'UPSTREAM_ERROR'); assert.equal(f.mock.state.calls, 1);
});
test('usage beyond reservation halts the mode persistently for operator investigation', async t => {
  const f = await fixture({ ROUTING_ENABLED: 'true' }); t.after(() => f.close());
  f.mock.state.response = mockCompletion(50000, 6);
  const client = await f.client(); const r = await client.callTool({ name: 'ask_deepseek', arguments: args() });
  assert.equal(data(r).cost.within_reservation, false); assert.equal(data(r).budget.halted, true);
  const next = await client.callTool({ name: 'ask_deepseek', arguments: args() });
  assert.equal(data(next).error.code, 'ACCOUNTING_ERROR'); assert.equal(f.mock.state.calls, 1);
});
test('cache hits reduce the estimate and truncated answers are marked explicitly', async t => {
  const f = await fixture({ ROUTING_ENABLED: 'true' }); t.after(() => f.close());
  const response = mockCompletion(10, 6, 8); response.choices[0]!.finish_reason = 'length'; f.mock.state.response = response;
  const r = await (await f.client()).callTool({ name: 'ask_deepseek', arguments: args() });
  assert.equal(data(r).truncated, true); assert.equal(data(r).usage.cached_input_tokens, 8);
  assert.equal(data(r).cost.estimated_usd, 0.000026752);
});
