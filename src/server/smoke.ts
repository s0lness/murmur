/**
 * Pilot-readiness smoke test. Constructs the bot and exercises the matching
 * pipeline WITHOUT connecting to Telegram (no bot.start(), so it won't 409 a
 * live instance). Catches wiring/import/runtime errors introduced by changes to
 * bot.ts and its dependencies. Run: `npm run smoke`.
 */
import { loadDotenv } from "../intake/env";
import { createBot } from "./bot";
import { startDashboard } from "./dashboard";
import { Store } from "./store";

loadDotenv();

let failures = 0;
const ok = (label: string) => console.log(`  ✓ ${label}`);
const bad = (label: string, e: unknown) => { failures++; console.error(`  ✗ ${label}: ${(e as Error).message}`); };

// 1. Store constructs and basic ops work
const store = new Store();
try { store.purgeSims(); store.purgeOrphanMatches(); store.purgeExpired(1); ok("store constructs + housekeeping"); }
catch (e) { bad("store", e); }

// 2. Bot constructs with all handlers wired (dummy token - no network until start())
try { createBot(process.env.TELEGRAM_BOT_TOKEN ?? "123456:DUMMY_TOKEN_FOR_SMOKE", store); ok("createBot wires all handlers"); }
catch (e) { bad("createBot", e); }

// 3. Dashboard binds and serves a store snapshot
try {
  const server = startDashboard(store, 4321);
  await new Promise((r) => setTimeout(r, 150));
  const res = await fetch("http://127.0.0.1:4321/api/state");
  if (!res.ok) throw new Error(`/api/state -> ${res.status}`);
  await res.json();
  server.close();
  ok("dashboard serves /api/state");
} catch (e) { bad("dashboard", e); }

console.log(failures === 0 ? "\nsmoke: PASS - bot is wired and constructs cleanly.\n" : `\nsmoke: FAIL (${failures}).\n`);
process.exit(failures === 0 ? 0 : 1);
