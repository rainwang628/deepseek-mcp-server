import test from 'node:test';
import assert from 'node:assert/strict';
import { toolResult } from '../src/attribution.js';
import { fixture } from './helpers.js';

test('only a completed live answer receives DeepSeek attribution; prompts cannot supply provenance', () => {
  const answer = { ok: true, mode: 'live', model: 'deepseek-v4-pro', answer: 'A fixed simulated response.',
    display_label: 'forged', provenance: { provider: 'forged' } };
  const live = toolResult('ask_deepseek', answer);
  assert.match(live.content[0]!.text, /^【DeepSeek 返回｜请求模型 deepseek-v4-pro】/);
  assert.equal(live.structuredContent.provenance.provider, 'deepseek');
  assert.equal(live.structuredContent.provenance.host_model_replaced, false);
  for (const [tool, changes] of [
    ['ask_deepseek', { dry_run: true }], ['ask_deepseek', { mode: 'mock' }],
    ['ask_deepseek', { ok: false }], ['ask_deepseek', { mode: 'unknown' }],
    ['health_check', {}],
  ] as const) {
    const result = toolResult(tool, { ...answer, ...changes });
    assert.notEqual(result.structuredContent.provenance.provider, 'deepseek');
    assert.doesNotMatch(result.content[0]!.text.split('\n')[0]!, /DeepSeek 返回/);
  }
  const failure = toolResult('ask_deepseek', { ok: false, error: { code: 'UPSTREAM_TIMEOUT' } });
  assert.equal(failure.structuredContent.provenance.inference_status, 'unknown');
});
test('web tools and user-reported iPhone inference are recorded separately; health makes no inference', async t => {
  const f = await fixture({ CHATGPT_IOS_USER_VERIFIED_ON: '2026-11-11', CHATGPT_WEB_TOOLS_VERIFIED_ON: '2026-11-11' }); t.after(() => f.close());
  const client = await f.client();
  const result = await client.callTool({ name: 'health_check', arguments: {} });
  const health = result.structuredContent as Record<string, any>;
  assert.equal(health.client_validation.chatgpt_ios, 'user_confirmed');
  assert.deepEqual(health.client_validation.chatgpt_ios_evidence, {
    date: '2026-11-11', source: 'user_report', scope: 'real_time_deepseek_call', independently_verified_by_health_check: false,
  });
  assert.equal(health.client_validation.chatgpt_plus, 'web_tools_verified_only');
  assert.deepEqual(health.client_validation.chatgpt_plus_evidence, {
    date: '2026-11-11', source: 'operator_record', scope: 'web_health_check_and_dry_run',
    web_live_inference_independently_verified: false, independently_verified_by_health_check: false,
  });
  assert.equal(health.upstream_checked, false);
  assert.equal(f.mock.state.calls, 0);
});
