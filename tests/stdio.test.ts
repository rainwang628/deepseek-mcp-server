import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fixture } from './helpers.js';
import type { Config } from '../src/config.js';

async function stdioClient(config: Config) {
  const env = Object.fromEntries(Object.entries(config).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : String(v)]));
  // The child imports the same non-loopback fetch guard as every other test.
  const transport = new StdioClientTransport({ command: process.execPath, args: [
    '--import', fileURLToPath(new URL('./helpers.js', import.meta.url)),
    fileURLToPath(new URL('../src/stdio.js', import.meta.url)),
  ], env, cwd: tmpdir(), stderr: 'pipe' });
  let stderr = '';
  transport.stderr?.on('data', chunk => { stderr += String(chunk); });
  const client = new Client({ name: 'global-stdio-test', version: '0.1.0' });
  await client.connect(transport);
  return { client, stderr: () => stderr };
}
const data = (r: unknown) => (r as { structuredContent: Record<string, any> }).structuredContent;

test('global stdio starts from another directory and discovers tools without leaking logs into MCP stdout', async t => {
  const f = await fixture();
  const child = await stdioClient(f.c);
  t.after(async () => { await child.client.close(); await f.close(); });
  const tools = (await child.client.listTools()).tools;
  assert.deepEqual(tools.map(t => t.name), ['health_check', 'ask_deepseek']);
  assert.deepEqual(tools[1]!._meta?.securitySchemes, [{ type: 'noauth' }]);
  assert.match(child.client.getInstructions()!, /routing_enabled=false/);
  const health = data(await child.client.callTool({ name: 'health_check', arguments: {} }));
  assert.equal(health.routing_enabled, false);
  assert.equal(health.transport, 'stdio');
  const estimate = data(await child.client.callTool({ name: 'ask_deepseek', arguments: {
    request_id: randomUUID(), prompt: 'Local stdio dry run', dry_run: true,
  } }));
  assert.equal(estimate.dry_run, true);
  assert.equal(f.mock.state.calls, 0);
  assert.equal(child.stderr().includes(f.c.MCP_BEARER_TOKEN), false);
});
test('stdio and HTTP clients share the same persistent call budget and duplicate UUID protection', async t => {
  const f = await fixture({ ROUTING_ENABLED: 'true', MAX_CALLS_PER_DAY: '1' });
  const child = await stdioClient(f.c);
  t.after(async () => { await child.client.close(); await f.close(); });
  assert.match(child.client.getInstructions()!, /routing_enabled=true/);
  const args = { request_id: randomUUID(), prompt: 'Explicitly delegated mock task' };
  const result = data(await child.client.callTool({ name: 'ask_deepseek', arguments: args }));
  assert.equal(result.ok, true);
  const http = await f.client();
  assert.equal(data(await http.callTool({ name: 'ask_deepseek', arguments: args })).error.code, 'DUPLICATE_REQUEST');
  assert.equal(data(await http.callTool({ name: 'ask_deepseek', arguments: { ...args, request_id: randomUUID() } })).error.code, 'BUDGET_EXCEEDED');
  assert.equal(f.mock.state.calls, 1);
});
