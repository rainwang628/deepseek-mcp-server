import type { ErrorCode } from './errors.js';
import type { ModelId } from './pricing.js';
export interface LogEvent {
  event: 'server_started' | 'server_stopped' | 'startup_failed' | 'request_completed' | 'request_rejected' | 'http_rejected' | 'transport_error';
  request_id?: string;
  tool?: 'ask_deepseek' | 'health_check';
  model?: ModelId;
  mode?: 'mock' | 'live';
  code?: ErrorCode | 'UNAUTHORIZED' | 'INVALID_HOST' | 'INVALID_ORIGIN' | 'BUSY' | 'INVALID_HTTP';
  duration_ms?: number;
  input_tokens?: number;
  output_tokens?: number;
  estimated_cost_usd?: number;
}
export type Logger = (event: LogEvent) => void;
export function createLogger(write: (line: string) => void = line => process.stdout.write(line)): Logger {
  return event => {
    // Explicit allowlist: even an accidental spread containing keys/prompts is discarded.
    const safe: Record<string, unknown> = { timestamp: new Date().toISOString() };
    for (const key of ['event', 'request_id', 'tool', 'model', 'mode', 'code', 'duration_ms', 'input_tokens', 'output_tokens', 'estimated_cost_usd'] as const) {
      if (event[key] !== undefined) safe[key] = event[key];
    }
    write(`${JSON.stringify(safe)}\n`);
  };
}
