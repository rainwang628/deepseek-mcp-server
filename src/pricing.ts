import { z } from 'zod';

export const modelSchema = z.enum(['deepseek-flash', 'deepseek-v4-pro']);
export type ModelId = z.infer<typeof modelSchema>;
export const PRICING_VERIFIED_ON = '2026-11-11';
export const PRICING_SOURCE = 'https://api-docs.deepseek.com/quick_start/pricing/';
// USD per million tokens, PEAK rates. Always reserve/estimate at the higher tier.
// Update this dated table only after checking the official source above.
export const PRICES = {
  'deepseek-flash': { input: 0.30, cachedInput: 0.006, output: 1.20 },
  'deepseek-v4-pro': { input: 1.32, cachedInput: 0.044, output: 3.96 },
} as const;
export const NANOS_PER_USD = 1_000_000_000;
export function toNanos(usd: number): number { return Math.round(usd * NANOS_PER_USD); }
export function toUsd(nanos: number): number { return nanos / NANOS_PER_USD; }
export function costNanos(model: ModelId, input: number, output: number, cached = 0): number {
  const price = PRICES[model];
  return (input - cached) * Math.round(price.input * 1000)
    + cached * Math.round(price.cachedInput * 1000) + output * Math.round(price.output * 1000);
}
export const RULES_REF = '05d9ace5f5aa41a13a3b7de28a8ea01baf56425b';
