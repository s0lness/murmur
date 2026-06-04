import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Append-only pilot event log. One JSON object per line at logs/events.jsonl,
 * so a pilot run can be analysed afterwards (jq, a notebook, whatever). This is
 * the host's record; it holds real user text, so logs/ is gitignored.
 *
 * Read it later, e.g.:
 *   cat logs/events.jsonl | jq 'select(.type=="deal")'
 *   cat logs/events.jsonl | jq -r 'select(.type=="feedback") | .text'
 */
const FILE = join(process.cwd(), "logs", "events.jsonl");

export function logEvent(type: string, data: Record<string, unknown> = {}): void {
  try {
    mkdirSync(join(process.cwd(), "logs"), { recursive: true });
    appendFileSync(FILE, JSON.stringify({ ts: new Date().toISOString(), type, ...data }) + "\n");
  } catch (e) {
    console.error("logEvent failed:", e);
  }
}
