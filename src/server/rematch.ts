import { loadDotenv } from "../intake/env";
import { matchAgainstPool } from "./commons";
import { Store } from "./store";

// Re-runs matching over every intent already in murmur.db.json. Read-only —
// safe to run alongside the live bot. Doubles as the basis for a /rematch
// rescan so dormant intents (arrived with no complement, or during a crash)
// can still find each other.
loadDotenv();
const store = new Store();
const pool = store.pool();
console.log(`rematch over ${pool.length} intents…\n`);

const seen = new Set<string>();
for (const si of pool) {
  const hits = await matchAgainstPool(si, pool);
  for (const h of hits) {
    const key = [si.intent.id, h.intent.id].sort().join("~");
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(`✓ MATCH  ${si.userId}/${si.intent.kind} ${si.intent.domain} [${(si.intent.publicTags ?? si.intent.tags).join(",")}]`);
    console.log(`         ${h.userId}/${h.intent.kind} ${h.intent.domain} [${(h.intent.publicTags ?? h.intent.tags).join(",")}]\n`);
  }
}
console.log(`done — ${seen.size} match(es)`);
