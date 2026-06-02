import { blur, type PrivateIntent } from "../core/intent";
import { loadDotenv } from "../intake/env";
import { LLMDistiller } from "../intake/llmDistiller";
import { ambientMarket } from "../intake/scenarios";
import { keywordMatch } from "../matching/keywordMatcher";
import { agree, type Buyer, type Seller } from "../negotiate/protocols";
import { sealedBidMarket } from "../rooms/charters";
import { Room } from "../rooms/room";

loadDotenv();
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY not set (shell or murmur/.env).");
  process.exit(1);
}

// Hand-assigned trust until the web-of-trust exists. buyer-de is below the bar.
const TRUST: Record<string, number> = {
  "seller-fr": 0.8, "buyer-fr": 0.7, "seller-us": 0.8, "buyer-us": 0.6, "buyer-de": 0.3, "noise-fr": 0.9,
};
const trustOf = (id: string) => TRUST[id] ?? 0.7;

console.log("\n▶ murmur — full pipeline: words → distilled → charter room → matched → closed\n");

const distiller = new LLMDistiller();
const agents = await Promise.all(
  ambientMarket().map(async (p) => ({ agentId: p.agentId, intents: await distiller.distill(p) })),
);

const room = new Room(sealedBidMarket);
console.log(`room: ${room.charter.id}  ·  "${room.rulesOfTheRoom()}"\n`);

// ── join (enforced admission) ──
console.log("─ admission ──────────────────────────────────────");
const members = new Set<string>();
for (const a of agents) {
  const r = room.join({ agentId: a.agentId, trustScore: trustOf(a.agentId) });
  if (r.ok) members.add(a.agentId);
  console.log(`  ${a.agentId.padEnd(11)} trust ${trustOf(a.agentId)}  ${r.ok ? "✓ admitted" : "✗ " + r.reason}`);
}

// ── publish blurred signals (enforced schema + rate) ──
const live: { agentId: string; intent: PrivateIntent }[] = [];
for (const a of agents) {
  for (const intent of a.intents) {
    if (intent.active === false) continue;
    const r = room.publish(a.agentId, blur(intent, a.agentId), 0);
    if (r.accepted) live.push({ agentId: a.agentId, intent });
  }
}

// ── match accepted signals, close via the room's protocol menu ──
const seeks = live.filter((x) => x.intent.kind === "seek");
const offers = live.filter((x) => x.intent.kind === "offer");
console.log(`\n─ matches & deals (${live.length} signals live, ${room.rejections.length} posts rejected) ─`);
let any = false;
for (const s of seeks) {
  for (const o of offers) {
    if (!keywordMatch(s.intent, o.intent, 0.3)) continue;
    if (s.intent.valuation === undefined || o.intent.valuation === undefined) {
      console.log(`  ${s.agentId} ⇄ ${o.agentId}  matched but unpriced — skipped`);
      continue;
    }
    const buyer: Buyer = { max: s.intent.valuation };
    const seller: Seller = { min: o.intent.valuation, list: Math.round(o.intent.valuation * 1.3) };
    const deal = agree(room.charter.protocols, buyer, seller);
    any = true;
    if (!deal) { console.log(`  ${s.agentId} ⇄ ${o.agentId}  no agreement`); continue; }
    console.log(
      `  ${s.agentId} ⇄ ${o.agentId}  ${deal.protocol.padEnd(14)} @ ${deal.price}` +
        `   buyer +${deal.buyerSurplus} seller +${deal.sellerSurplus}  ${deal.messages} msg`,
    );
  }
}
if (!any) console.log("  (none)");

console.log(`\n─ enforcement log ────────────────────────────────`);
for (const r of room.rejections) console.log(`  ✗ ${r.agentId}: ${r.reason}`);
console.log("");
