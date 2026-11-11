import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { isLoopback, loadConfig } from '../src/config.js';
const c = loadConfig(process.env);
if (c.DEEPSEEK_MODE !== 'mock' || !isLoopback(new URL(c.PUBLIC_URL).hostname)) throw new Error('Smoke check is limited to local mock mode');
const client = new Client({ name: 'local-smoke-check', version: '0.1.0' });
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(c.PUBLIC_URL), {
    requestInit: { headers: { Authorization: `Bearer ${c.MCP_BEARER_TOKEN}` } },
  }));
  const tools = await client.listTools();
  console.log(JSON.stringify({ tools: tools.tools.map(t => t.name) }));
  for (const [name, args] of [
    ['health_check', {}],
    ['ask_deepseek', { request_id: randomUUID(), prompt: 'Local smoke test', dry_run: true }],
  ] as const) {
    const output = await client.callTool({ name, arguments: args });
    if (output.isError) throw new Error('Local smoke check failed');
    console.log(JSON.stringify({ tool: name, result: output.structuredContent }));
  }
} finally { await client.close(); }
