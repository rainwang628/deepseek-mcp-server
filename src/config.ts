import { z } from 'zod';
import { modelSchema, PRICING_VERIFIED_ON } from './pricing.js';

const bool = (fallback: 'true' | 'false') => z.enum(['true', 'false']).default(fallback).transform(v => v === 'true');
const integer = (fallback: number, min: number, max: number) => z.coerce.number().int().min(min).max(max).default(fallback);
const money = (fallback: number) => z.coerce.number().finite().min(0).max(1000).default(fallback);
const list = z.string().default('').transform(v => v.split(',').map(s => s.trim()).filter(Boolean));
const envSchema = z.object({
  HOST: z.string().default('127.0.0.1'),
  PORT: integer(3000, 1, 65535),
  PUBLIC_URL: z.url().default('http://127.0.0.1:3000/mcp'),
  ALLOWED_HOSTS: list,
  ALLOWED_ORIGINS: list,
  AUTH_MODE: z.enum(['bearer', 'oauth']).default('bearer'),
  MCP_BEARER_TOKEN: z.string().default(''),
  OAUTH_ISSUER: z.string().default(''),
  OAUTH_JWKS_URL: z.string().default(''),
  OAUTH_ALLOWED_SUBJECTS: list,
  DEEPSEEK_MODE: z.enum(['mock', 'live']).default('mock'),
  DEEPSEEK_MODEL: modelSchema.default('deepseek-v4-pro'),
  DEEPSEEK_API_KEY: z.string().default(''),
  MOCK_DEEPSEEK_URL: z.url().default('http://127.0.0.1:4010'),
  ROUTING_ENABLED: bool('false'),
  ALLOW_PAID_REQUESTS: bool('false'),
  MAX_OUTPUT_TOKENS: integer(2048, 1, 8192),
  DEFAULT_OUTPUT_TOKENS: integer(512, 1, 8192),
  MAX_TOTAL_TOKENS: integer(16384, 256, 131072),
  MAX_INPUT_BYTES: integer(12000, 1, 100000),
  MAX_COST_PER_REQUEST_USD: money(0.02),
  DAILY_BUDGET_USD: money(1),
  TOTAL_BUDGET_USD: money(50),
  MAX_CALLS_PER_DAY: integer(200, 1, 10000),
  CHATGPT_WEB_TOOLS_VERIFIED_ON: z.union([z.literal(''), z.iso.date()]).default(''),
  CHATGPT_IOS_USER_VERIFIED_ON: z.union([z.literal(''), z.iso.date()]).default(''),
  REQUEST_TIMEOUT_MS: integer(30000, 50, 120000),
  MAX_RESPONSE_BYTES: integer(1048576, 1024, 4194304),
  MAX_CONCURRENT_REQUESTS: integer(2, 1, 16),
  LEDGER_PATH: z.string().min(1).default('data/budget.sqlite'),
});
export type Config = z.infer<typeof envSchema>;
export function isLoopback(hostname: string): boolean {
  // Numeric loopback only: no DNS resolution or rebinding through localhost aliases.
  return hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}
function safeUrl(value: string): URL {
  const u = new URL(value);
  if (u.username || u.password || u.search || u.hash) throw new Error('URL credentials, query and fragments are not allowed');
  return u;
}
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    // Never stringify Zod issues: they can include environment values.
    const keys = [...new Set(result.error.issues.map(i => String(i.path[0])))];
    throw new Error(`Invalid environment variables: ${keys.join(', ')}`);
  }
  const c = result.data;
  const publicUrl = safeUrl(c.PUBLIC_URL);
  if (publicUrl.pathname !== '/mcp') throw new Error('PUBLIC_URL must end at /mcp');
  if (publicUrl.protocol !== 'https:' && !(publicUrl.protocol === 'http:' && isLoopback(publicUrl.hostname))) {
    throw new Error('PUBLIC_URL requires HTTPS, except numeric loopback HTTP for local testing');
  }
  if (!isLoopback(publicUrl.hostname) && c.AUTH_MODE !== 'oauth') throw new Error('Remote deployment requires OAuth');
  if (c.AUTH_MODE === 'bearer' && (c.MCP_BEARER_TOKEN.length < 32 || !/^[\x21-\x7e]+$/.test(c.MCP_BEARER_TOKEN))) {
    throw new Error('MCP_BEARER_TOKEN must contain at least 32 printable non-space ASCII characters');
  }
  if (c.AUTH_MODE === 'bearer' && !isLoopback(c.HOST)) throw new Error('Local Bearer mode must bind to numeric loopback');
  if (c.AUTH_MODE === 'oauth') {
    for (const value of [c.OAUTH_ISSUER, c.OAUTH_JWKS_URL]) {
      const u = safeUrl(value);
      if (u.protocol !== 'https:' && !(isLoopback(publicUrl.hostname) && u.protocol === 'http:' && isLoopback(u.hostname))) {
        throw new Error('OAuth issuer and JWKS require HTTPS outside local tests');
      }
    }
    if (c.OAUTH_ALLOWED_SUBJECTS.length === 0) throw new Error('OAUTH_ALLOWED_SUBJECTS must explicitly allow the owner');
  }
  const mockUrl = safeUrl(c.MOCK_DEEPSEEK_URL);
  if (mockUrl.protocol !== 'http:' || !isLoopback(mockUrl.hostname) || mockUrl.pathname !== '/') {
    throw new Error('Mock API must use an HTTP numeric loopback origin');
  }
  if (c.DEFAULT_OUTPUT_TOKENS > c.MAX_OUTPUT_TOKENS) throw new Error('Default output exceeds output token limit');
  if (c.MAX_OUTPUT_TOKENS >= c.MAX_TOTAL_TOKENS) throw new Error('Output limit must be below total token limit');
  if (c.ALLOW_PAID_REQUESTS && c.DEEPSEEK_MODE !== 'live') throw new Error('Paid authorization applies only to live mode');
  if (c.DEEPSEEK_API_KEY && !/^[\x21-\x7e]+$/.test(c.DEEPSEEK_API_KEY)) throw new Error('DEEPSEEK_API_KEY must not contain whitespace or control characters');
  if (c.LEDGER_PATH === ':memory:' && (c.DEEPSEEK_MODE === 'live' || !isLoopback(publicUrl.hostname))) {
    throw new Error('Live or remote instances require a persistent ledger');
  }
  c.ALLOWED_HOSTS = [...new Set([publicUrl.host, ...c.ALLOWED_HOSTS])];
  for (const origin of c.ALLOWED_ORIGINS) {
    if (safeUrl(origin).origin !== origin) throw new Error('ALLOWED_ORIGINS must contain origins without paths');
  }
  return c;
}
export function pricingIsCurrent(now = new Date()): boolean {
  // Fail closed for live calls when the reviewed price table is more than 30 days old.
  const age = now.getTime() - Date.parse(`${PRICING_VERIFIED_ON}T00:00:00Z`);
  return age >= 0 && age <= 30 * 86400000;
}
