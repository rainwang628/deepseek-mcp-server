import { createServer, type Server } from 'node:http';
import { pathToFileURL } from 'node:url';
import { modelSchema } from '../src/pricing.js';
export const MOCK_ANSWER = 'Mock DeepSeek response: no paid API was called.';
export function mockCompletion(input = 8, output = 6, cached = 0) {
  return { id: 'mock-only', object: 'chat.completion', model: 'deepseek-v4-pro',
    choices: [{ index: 0, message: { role: 'assistant', content: MOCK_ANSWER }, finish_reason: 'stop' }],
    usage: { prompt_tokens: input, completion_tokens: output, total_tokens: input + output,
      prompt_cache_hit_tokens: cached, prompt_cache_miss_tokens: input - cached } };
}
export function createMockDeepSeek() {
  const state: { calls: number; lastBody: unknown; authorization: string | undefined; status: number;
    response: unknown; delayMs: number; redirect: string | undefined } = {
    calls: 0, lastBody: undefined, authorization: undefined, status: 200,
    response: mockCompletion(), delayMs: 0, redirect: undefined,
  };
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/chat/completions') { res.writeHead(404).end(); return; }
    state.calls++;
    state.authorization = req.headers.authorization;
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of req) {
      bytes += chunk.length as number;
      if (bytes > 256 * 1024) { res.writeHead(413).end(); return; }
      chunks.push(chunk as Buffer);
    }
    try {
      state.lastBody = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
      const body = state.lastBody as Record<string, unknown>;
      if (!modelSchema.safeParse(body.model).success || typeof body.max_tokens !== 'number') {
        res.writeHead(400).end(); return;
      }
    } catch { res.writeHead(400).end(); return; }
    if (state.delayMs) await new Promise(resolve => setTimeout(resolve, state.delayMs));
    if (res.destroyed) return;
    res.setHeader('Content-Type', 'application/json');
    if (state.redirect) res.setHeader('Location', state.redirect);
    res.writeHead(state.status).end(JSON.stringify(state.response));
  });
  return { server, state };
}
export async function listenLoopback(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing local address');
  return `http://127.0.0.1:${address.port}`;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.MOCK_PORT ?? 4010);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid MOCK_PORT');
  const { server } = createMockDeepSeek();
  server.listen(port, '127.0.0.1', () => { console.log(`Mock API listening on numeric loopback port ${port}; no paid API calls.`); });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
}
