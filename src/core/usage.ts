/**
 * Process-wide token + cost meter. Every Anthropic call reports its `usage`
 * here via record(); cache HITS never call the API, so they cost nothing and
 * are not counted. costUSD() prices the accumulated tokens with an approximate
 * per-model table (override via MURMUR_PRICE_IN / MURMUR_PRICE_OUT, $/Mtok).
 */
export interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number; calls: number }

const u: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0 };

interface RawUsage { input_tokens?: number | null; output_tokens?: number | null; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null }
export function record(usage: RawUsage | undefined): void {
  if (!usage) return;
  u.input += usage.input_tokens ?? 0;
  u.output += usage.output_tokens ?? 0;
  u.cacheWrite += usage.cache_creation_input_tokens ?? 0;
  u.cacheRead += usage.cache_read_input_tokens ?? 0;
  u.calls += 1;
}

export const usageTotal = (): Usage => ({ ...u });
export const resetUsage = (): void => { u.input = u.output = u.cacheRead = u.cacheWrite = u.calls = 0; };

/** Approximate list price, $ per million tokens, by model family. */
const PRICING: Record<string, { in: number; out: number }> = {
  opus: { in: 15, out: 75 },
  sonnet: { in: 3, out: 15 },
  haiku: { in: 1, out: 5 },
};
function rate(model: string): { in: number; out: number } {
  const m = model.toLowerCase();
  const fam = m.includes("opus") ? "opus" : m.includes("sonnet") ? "sonnet" : "haiku";
  return {
    in: Number(process.env.MURMUR_PRICE_IN) || PRICING[fam]!.in,
    out: Number(process.env.MURMUR_PRICE_OUT) || PRICING[fam]!.out,
  };
}

/** Cost in USD: cache writes bill at 1.25× input, cache reads at 0.1× input. */
export function costUSD(model: string): number {
  const r = rate(model);
  const cost = (u.input * r.in + u.cacheWrite * r.in * 1.25 + u.cacheRead * r.in * 0.1 + u.output * r.out) / 1e6;
  return Math.round(cost * 10000) / 10000;
}

/** A compact one-line summary for logs/console. */
export function usageSummary(model: string): string {
  const t = u.input + u.cacheWrite + u.cacheRead;
  return `${u.calls} API calls · ${t.toLocaleString()} in (+${u.output.toLocaleString()} out) · ~$${costUSD(model).toFixed(4)}`;
}
