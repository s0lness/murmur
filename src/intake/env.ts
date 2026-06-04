import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Load murmur/.env into process.env (only keys not already set). Gitignored. */
export function loadDotenv(): void {
  try {
    const env = readFileSync(join(process.cwd(), ".env"), "utf8");
    for (const line of env.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && m[1] && !process.env[m[1]]) {
        process.env[m[1]] = m[2]!.replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    /* no .env - rely on the ambient environment */
  }
}
