import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { loadConfig } from '../src/config.js';
import { createApplication } from '../src/server.js';
import { createLogger } from '../src/logging.js';
import { createMockDeepSeek, listenLoopback } from '../scripts/mock-deepseek.js';
// Tests cannot accidentally contact a paid service, even if a regression bypasses the flags.
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.hostname !== '127.0.0.1' && url.hostname !== '[::1]') throw new Error('Test network guard: non-loopback request forbidden');
  return realFetch(input, init);
}) as typeof fetch;
export const TEST_TOKEN = 'test-only-local-bearer-token-never-use-in-production';
export function config(overrides: NodeJS.ProcessEnv = {}) {
  // Never inherit real credentials or routing from process.env.
  return loadConfig({ MCP_BEARER_TOKEN: TEST_TOKEN, LEDGER_PATH: ':memory:', ...overrides });
}
export async function closeHttp(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
}
export async function fixture(overrides: NodeJS.ProcessEnv = {}) {
  const mock = createMockDeepSeek();
  const mockUrl = await listenLoopback(mock.server);
  const dir = mkdtempSync(join(tmpdir(), 'deepseek-mcp-test-'));
  const lines: string[] = [];
  const c = config({ MOCK_DEEPSEEK_URL: mockUrl, LEDGER_PATH: join(dir, 'budget.sqlite'), ...overrides });
  const application = createApplication(c, createLogger(line => lines.push(line)));
  const http = createServer(application.app);
  const url = await listenLoopback(http);
  c.ALLOWED_HOSTS.push(new URL(url).host);
  const clients: Client[] = [];
  return { c, mock, lines, application, url,
    async client(token = TEST_TOKEN) {
      const client = new Client({ name: 'integration-test', version: '0.1.0' });
      clients.push(client);
      await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }));
      return client;
    },
    async close() {
      await Promise.allSettled(clients.map(c => c.close()));
      await closeHttp(http);
      await application.close();
      await closeHttp(mock.server);
      rmSync(dir, { recursive: true, force: true });
    } };
}
