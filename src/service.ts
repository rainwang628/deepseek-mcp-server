import { z } from 'zod';
import type { Config } from './config.js';
import { pricingIsCurrent } from './config.js';
import { AppError, safeError } from './errors.js';
import { DeepSeekClient, type Message } from './deepseek.js';
import { BudgetLedger } from './ledger.js';
import type { Logger } from './logging.js';
import { costNanos, modelSchema, PRICING_SOURCE, PRICING_VERIFIED_ON, RULES_REF, toNanos, toUsd } from './pricing.js';

export const askSchema = z.strictObject({
  request_id: z.uuid().describe('A fresh UUID for a new task; reuse the same ID if delivery is uncertain. Duplicates never cause a second inference.'),
  prompt: z.string().min(1).max(100000).describe('Only the task/content explicitly delegated by the user; avoid secrets.'),
  system_prompt: z.string().max(100000).optional(),
  model: modelSchema.optional().describe('Official documented model ID; defaults to the operator-selected model.'),
  max_output_tokens: z.number().int().min(1).max(8192).optional(),
  max_cost_usd: z.number().finite().positive().max(1000).optional().describe('Optional per-call limit, in addition to the stricter operator limit.'),
  dry_run: z.boolean().default(false).describe('Estimate only: no inference, no credential check, no budget debit. Works with routing disabled.'),
});
export type AskInput = z.infer<typeof askSchema>;
export class DeepSeekService {
  private readonly client: DeepSeekClient;
  constructor(readonly config: Config, readonly ledger: BudgetLedger, private readonly log: Logger) {
    this.client = new DeepSeekClient(config);
  }
  health() {
    const c = this.config;
    return { ok: true, service: 'deepseek-mcp-server', version: '0.1.0', transport: 'streamable-http',
      mode: c.DEEPSEEK_MODE, routing_enabled: c.ROUTING_ENABLED, paid_requests_allowed: c.ALLOW_PAID_REQUESTS,
      model: c.DEEPSEEK_MODEL, api_key_configured: c.DEEPSEEK_API_KEY.length > 0,
      pricing_verified_on: PRICING_VERIFIED_ON, pricing_current: pricingIsCurrent(), rules_ref: RULES_REF,
      limits: { max_input_bytes: c.MAX_INPUT_BYTES, max_total_tokens_estimate: c.MAX_TOTAL_TOKENS,
        max_output_tokens: c.MAX_OUTPUT_TOKENS, max_cost_per_request_usd: c.MAX_COST_PER_REQUEST_USD,
        max_calls_per_day: c.MAX_CALLS_PER_DAY },
      budget: this.ledger.summary(c), upstream_checked: false,
      client_validation: { chatgpt_plus: c.CHATGPT_WEB_TOOLS_VERIFIED_ON ? 'web_tools_verified_only' : 'unverified',
        chatgpt_plus_evidence: c.CHATGPT_WEB_TOOLS_VERIFIED_ON ? {
          date: c.CHATGPT_WEB_TOOLS_VERIFIED_ON, source: 'operator_record', scope: 'web_health_check_and_dry_run',
          web_live_inference_independently_verified: false, independently_verified_by_health_check: false,
        } : null,
        chatgpt_ios: c.CHATGPT_IOS_USER_VERIFIED_ON ? 'user_confirmed' : 'unverified',
        chatgpt_ios_evidence: c.CHATGPT_IOS_USER_VERIFIED_ON ? {
          date: c.CHATGPT_IOS_USER_VERIFIED_ON, source: 'user_report',
          scope: 'real_time_deepseek_call', independently_verified_by_health_check: false,
        } : null } };
  }
  async ask(raw: unknown, signal?: AbortSignal) {
    const start = performance.now();
    const parsed = askSchema.safeParse(raw);
    if (!parsed.success) { this.log({ event: 'request_rejected', tool: 'ask_deepseek', code: 'INVALID_ARGUMENT' }); throw new AppError('INVALID_ARGUMENT'); }
    const input = parsed.data;
    const c = this.config;
    const model = input.model ?? c.DEEPSEEK_MODEL;
    const maxOutput = input.max_output_tokens ?? c.DEFAULT_OUTPUT_TOKENS;
    const messages: Message[] = [];
    if (input.system_prompt) messages.push({ role: 'system', content: input.system_prompt });
    messages.push({ role: 'user', content: input.prompt });
    // Deliberately conservative byte-based estimate, not an official tokenizer.
    const inputBytes = Buffer.byteLength(JSON.stringify(messages), 'utf8');
    const inputUpperEstimate = inputBytes + 128;
    let reserved = false;
    try {
      if (inputBytes > c.MAX_INPUT_BYTES || maxOutput > c.MAX_OUTPUT_TOKENS || inputUpperEstimate + maxOutput > c.MAX_TOTAL_TOKENS) throw new AppError('TOKEN_LIMIT');
      const upperCost = costNanos(model, inputUpperEstimate, maxOutput);
      if (upperCost > toNanos(Math.min(c.MAX_COST_PER_REQUEST_USD, input.max_cost_usd ?? c.MAX_COST_PER_REQUEST_USD))) throw new AppError('COST_LIMIT');
      const estimate = { currency: 'USD', input_tokens_upper_estimate: inputUpperEstimate, max_output_tokens: maxOutput,
        max_total_tokens_estimate: inputUpperEstimate + maxOutput, reserved_cost_usd: toUsd(upperCost),
        pricing_tier: 'peak', pricing_source: PRICING_SOURCE, pricing_verified_on: PRICING_VERIFIED_ON,
        note: 'Byte-based input estimate; not a billing guarantee. Output capped by max_tokens. Provider usage and prices determine the final bill.' };
      if (input.dry_run) return { ok: true, dry_run: true, request_id: input.request_id, mode: c.DEEPSEEK_MODE,
        model, routing_enabled: c.ROUTING_ENABLED, estimate, budget: this.ledger.summary(c) };
      if (!c.ROUTING_ENABLED) throw new AppError('ROUTING_DISABLED');
      if (c.DEEPSEEK_MODE === 'live') {
        if (!c.ALLOW_PAID_REQUESTS) throw new AppError('PAID_REQUESTS_DISABLED');
        if (!c.DEEPSEEK_API_KEY || !pricingIsCurrent()) throw new AppError('NOT_CONFIGURED');
      }
      if (signal?.aborted) throw new AppError('UPSTREAM_TIMEOUT');
      try { this.ledger.reserve(input.request_id, upperCost, c); }
      catch (e) { if (e instanceof AppError) throw e; throw new AppError('ACCOUNTING_ERROR'); }
      reserved = true;
      const result = await this.client.ask(model, messages, maxOutput, signal);
      const actualCost = costNanos(model, result.inputTokens, result.outputTokens, result.cachedInputTokens);
      const withinEstimate = result.inputTokens <= inputUpperEstimate && result.outputTokens <= maxOutput;
      try { this.ledger.settle(input.request_id, c.DEEPSEEK_MODE, actualCost, !withinEstimate); }
      catch { throw new AppError('ACCOUNTING_ERROR'); }
      this.log({ event: 'request_completed', tool: 'ask_deepseek', request_id: input.request_id,
        mode: c.DEEPSEEK_MODE, model, duration_ms: Math.round(performance.now() - start),
        input_tokens: result.inputTokens, output_tokens: result.outputTokens, estimated_cost_usd: toUsd(actualCost) });
      return { ok: true, request_id: input.request_id, mode: c.DEEPSEEK_MODE, model,
        answer: result.answer, finish_reason: result.finishReason, truncated: result.finishReason === 'length',
        usage: { input_tokens: result.inputTokens, output_tokens: result.outputTokens, cached_input_tokens: result.cachedInputTokens },
        cost: { currency: 'USD', estimated_usd: toUsd(actualCost), mock_only: c.DEEPSEEK_MODE === 'mock',
          pricing_tier: 'peak', within_reservation: withinEstimate && actualCost <= upperCost },
        estimate, budget: this.ledger.summary(c) };
    } catch (error) {
      let safe = safeError(error);
      if (reserved) {
        try { this.ledger.uncertain(input.request_id, c.DEEPSEEK_MODE); }
        catch { safe = new AppError('ACCOUNTING_ERROR'); }
      }
      this.log({ event: 'request_rejected', tool: 'ask_deepseek', request_id: input.request_id, model,
        mode: c.DEEPSEEK_MODE, code: safe.code, duration_ms: Math.round(performance.now() - start) });
      throw safe;
    }
  }
}
