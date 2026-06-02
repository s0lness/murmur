import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(process.cwd(), ".cache");

/** Stable key from any inputs — bump the version prefix to bust the cache. */
export function cacheKey(...parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 40);
}

/**
 * Disk-memoize an async (LLM) call so runs are reproducible and free on replay.
 * This is what restores determinism after M1 made the sim non-deterministic.
 */
export async function cached<T>(key: string, fn: () => Promise<T>): Promise<{ value: T; hit: boolean }> {
  mkdirSync(DIR, { recursive: true });
  const path = join(DIR, `${key}.json`);
  if (existsSync(path)) {
    return { value: JSON.parse(readFileSync(path, "utf8")) as T, hit: true };
  }
  const value = await fn();
  writeFileSync(path, JSON.stringify(value));
  return { value, hit: false };
}
