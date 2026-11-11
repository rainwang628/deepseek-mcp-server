import { z } from 'zod';
import type { Config } from './config.js';
import { AppError } from './errors.js';
import type { ModelId } from './pricing.js';

export interface Message { role: 'system' | 'user'; content: string }
const count = z.number().int().nonnegative().max(2_000_000);
const responseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }),
    finish_reason: z.enum(['stop', 'length', 'content_filter', 'tool_calls', 'insufficient_system_resource', 'aborted']) })).min(1).max(1),
  usage: z.object({ prompt_tokens: count, completion_tokens: count, total_tokens: count,
    prompt_cache_hit_tokens: count.optional(), prompt_cache_miss_tokens: count.optional() }),
});
async function readLimited(response: Response, maxBytes: number): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new AppError('UPSTREAM_INVALID_RESPONSE');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maxBytes) { await reader.cancel(); throw new AppError('UPSTREAM_INVALID_RESPONSE'); }
      chunks.push(next.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) throw new AppError('UPSTREAM_INVALID_RESPONSE');
    throw error;
  } finally { reader.releaseLock(); }
}
export class DeepSeekClient {
  constructor(private readonly c: Config) {}
  async ask(model: ModelId, messages: Message[], maxTokens: number, signal?: AbortSignal) {
    const timeout = AbortSignal.timeout(this.c.REQUEST_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const url = this.c.DEEPSEEK_MODE === 'live'
      ? 'https://api.deepseek.com/chat/completions'
      : new URL('/chat/completions', this.c.MOCK_DEEPSEEK_URL).href;
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    // The real credential can only ever be attached to the fixed official HTTPS endpoint.
    if (this.c.DEEPSEEK_MODE === 'live') headers.Authorization = `Bearer ${this.c.DEEPSEEK_API_KEY}`;
    try {
      const response = await fetch(url, { method: 'POST', headers, redirect: 'error', signal: combined,
        body: JSON.stringify({ model, messages, max_tokens: maxTokens, stream: false, thinking: { type: 'disabled' } }) });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 401 || response.status === 403) throw new AppError('UPSTREAM_AUTH');
        if (response.status === 429) throw new AppError('UPSTREAM_RATE_LIMIT');
        throw new AppError('UPSTREAM_ERROR');
      }
      const parsed = responseSchema.safeParse(await readLimited(response, this.c.MAX_RESPONSE_BYTES));
      if (!parsed.success) throw new AppError('UPSTREAM_INVALID_RESPONSE');
      const { usage, choices } = parsed.data;
      const hit = usage.prompt_cache_hit_tokens ?? 0;
      if (usage.total_tokens !== usage.prompt_tokens + usage.completion_tokens || hit > usage.prompt_tokens
        || (usage.prompt_cache_miss_tokens !== undefined && usage.prompt_cache_miss_tokens + hit !== usage.prompt_tokens)) {
        throw new AppError('UPSTREAM_INVALID_RESPONSE');
      }
      return { answer: choices[0]!.message.content ?? '', finishReason: choices[0]!.finish_reason,
        inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens, cachedInputTokens: hit };
    } catch (error) {
      if (combined.aborted) throw new AppError('UPSTREAM_TIMEOUT');
      if (error instanceof AppError) throw error;
      throw new AppError('UPSTREAM_ERROR');
    }
  }
}
