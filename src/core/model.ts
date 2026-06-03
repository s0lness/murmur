/**
 * The model used for all agent LLM calls (distill, reconcile, route, answer,
 * match). Resolved at call time so murmur/.env (MURMUR_MODEL=...) is respected.
 *
 * Default: Haiku 4.5 — cheapest, and these are structured-output tasks it
 * handles well. Bump to claude-sonnet-4-6 (or claude-opus-4-8) via env if match
 * quality dips on harder cases.
 */
export const modelId = (): string => process.env.MURMUR_MODEL ?? "claude-haiku-4-5";
