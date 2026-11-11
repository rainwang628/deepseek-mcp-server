import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from './helpers.js';
import { loadConfig, pricingIsCurrent } from '../src/config.js';
import { createLogger } from '../src/logging.js';
import { askSchema, DeepSeekService } from '../src/service.js';
import { BudgetLedger } from '../src/ledger.js';
test('configuration defaults to mock with routing and paid requests off', () => {
  const c = config(); assert.equal(c.DEEPSEEK_MODE, 'mock'); assert.equal(c.ROUTING_ENABLED, false);
  assert.equal(c.ALLOW_PAID_REQUESTS, false); assert.equal(c.HOST, '127.0.0.1');
  assert.equal(c.DEEPSEEK_MODEL, 'deepseek-v4-pro');
});
test('unsafe or ambiguous environment configuration fails closed without exposing values', () => {
  for (const env of [
    { ROUTING_ENABLED: 'yes' }, { ALLOW_PAID_REQUESTS: 'true' }, { DEEPSEEK_MODEL: 'guess' },
    { MCP_BEARER_TOKEN: 'weak' }, { HOST: '0.0.0.0' }, { PUBLIC_URL: 'http://mcp.example.com/mcp' },
    { PUBLIC_URL: 'https://mcp.example.com/mcp' },
    { MOCK_DEEPSEEK_URL: 'https://api.deepseek.com' }, { MOCK_DEEPSEEK_URL: 'http://localhost:4010' },
    { MOCK_DEEPSEEK_URL: 'http://127.0.0.1:4010?key=test-value' }, { MAX_OUTPUT_TOKENS: '1' },
    { DAILY_BUDGET_USD: '-1' }, { CHATGPT_IOS_USER_VERIFIED_ON: 'guessed' },
    { CHATGPT_WEB_TOOLS_VERIFIED_ON: '2026-02-31' },
    { OAUTH_ISSUER: 'https://issuer.example', AUTH_MODE: 'oauth' },
    { DEEPSEEK_MODE: 'live', LEDGER_PATH: ':memory:' }, { DEEPSEEK_API_KEY: 'test-control\ncharacter' },
  ]) assert.throws(() => config(env));
  assert.throws(() => loadConfig({ DEEPSEEK_MODEL: 'test-sensitive-invalid-value' }), e =>
    e instanceof Error && !e.message.includes('test-sensitive-invalid-value'));
});
test('dated pricing expires for live use and future-dated tables fail closed', () => {
  assert.equal(pricingIsCurrent(new Date('2026-11-11T12:00:00Z')), true);
  assert.equal(pricingIsCurrent(new Date('2026-12-12T00:00:00Z')), false);
  assert.equal(pricingIsCurrent(new Date('2026-11-10T23:59:59Z')), false);
});
test('large output is opt-in and still respects token and cost limits', async () => {
  const c = config({ MAX_OUTPUT_TOKENS: '20480', MAX_TOTAL_TOKENS: '32768' });
  assert.equal(c.MAX_OUTPUT_TOKENS, 20480);
  const request = { request_id: '1bf15494-7e56-4a5b-a540-956be95c1e18',
    prompt: 'Large output configuration check', model: 'deepseek-flash', max_output_tokens: 20480, dry_run: true };
  assert.equal(askSchema.safeParse(request).success, true);
  assert.equal(askSchema.safeParse({ ...request, max_output_tokens: 20481 }).success, false);
  assert.throws(() => config({ MAX_OUTPUT_TOKENS: '20480' }));
  assert.throws(() => config({ MAX_OUTPUT_TOKENS: '20481', MAX_TOTAL_TOKENS: '32768' }));
  const ledger = new BudgetLedger(':memory:');
  try {
    const service = new DeepSeekService(c, ledger, createLogger(() => {}));
    await assert.rejects(service.ask(request), (e: any) => e.code === 'COST_LIMIT');
    const funded = new DeepSeekService({ ...c, MAX_COST_PER_REQUEST_USD: 0.03 }, ledger, createLogger(() => {}));
    const result = await funded.ask(request);
    assert.equal(result.estimate.max_output_tokens, 20480);
    assert.equal(result.dry_run, true);
  } finally { ledger.close(); }
});
test('allowlisted logging drops unexpected prompts, headers and API keys', () => {
  const lines: string[] = []; const log = createLogger(line => lines.push(line));
  log({ event: 'request_completed', prompt: 'sensitive-test-prompt', api_key: 'sensitive-test-key',
    headers: { authorization: 'sensitive-test-auth' } } as Parameters<typeof log>[0]);
  assert.equal(lines.join('').includes('sensitive-test-'), false);
  assert.equal(JSON.parse(lines[0]!).event, 'request_completed');
});
