import { blur, type PrivateIntent } from "../core/intent";
import { loadDotenv } from "../intake/env";
import { LLMDistiller } from "../intake/llmDistiller";
import { mixedMarket } from "../intake/scenarios";
import { keywordMatch } from "../matching/keywordMatcher";
import { agree, type Buyer, type Seller } from "../negotiate/protocols";
import { barterBazaar, sealedBidMarket } from "../rooms/charters";
import { Room } from "../rooms/room";

loadDotenv();
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY not set (shell or murmur/.env).");
  process.exit(1);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const cities = (xs: string[] = []) => xs.filter((t) => /^city:/i.test(t)).map(norm);
const dates = (xs: string[] = []) => xs.filter((t) => /\d{4}/.test(t)).map(norm);

/**
 * Barter agreement: a double coincidence of wants. Matched structurally on the
 * PLACE dimension (the swap itself), with the date treated as overlap-if-present
 * - because the distiller doesn't always emit symmetric have/want tags, exact
 * full-tag matching is too brittle for real swaps. (A semantic matcher would be
 * more robust here - noted for later.)
 */
function doubleCoincidence(a: PrivateIntent, b: PrivateIntent): boolean {
  const aWant = cities(a.want), aHave = cities(a.have);
  const bWant = cities(b.want), bHave = cities(b.have);
  if (!aWant.length || !bWant.length) return false;
  const placeMatch = aWant.every((w) => bHave.includes(w)) && bWant.every((w) => aHave.includes(w));
  if (!placeMatch) return false;
  const aD = [...dates(a.have), ...dates(a.want)], bD = [...dates(b.have), ...dates(b.want)];
  return !aD.length || !bD.length || aD.some((d) => bD.includes(d)); // unspecified ⇒ negotiable
}

console.log("\n▶ murmur - multi-room: goods → market, swaps → bazaar\n");

const distiller = new LLMDistiller();
const agents = await Promise.all(
  mixedMarket().map(async (p) => ({ agentId: p.agentId, intents: await distiller.distill(p) })),
);

const market = new Room(sealedBidMarket); // goods.* , price protocols
const bazaar = new Room(barterBazaar); // anything, barter / NL
for (const a of agents) {
  market.join({ agentId: a.agentId, trustScore: 1 });
  bazaar.join({ agentId: a.agentId, trustScore: 1 });
}

// Route each active intent to the first room whose charter admits its domain.
const liveIn = new Map<Room, { agentId: string; intent: PrivateIntent }[]>([[market, []], [bazaar, []]]);
console.log("─ routing (by domain, enforced by charter) ───────");
for (const a of agents) {
  for (const intent of a.intents) {
    if (intent.active === false) continue;
    const target = intent.domain.startsWith("goods.") ? market : bazaar;
    const r = target.publish(a.agentId, blur(intent, a.agentId), 0);
    const where = target === market ? "market" : "bazaar";
    console.log(`  ${a.agentId.padEnd(13)} ${intent.kind.toUpperCase().padEnd(5)} ${intent.domain.padEnd(14)} → ${where}  ${r.accepted ? "✓" : "✗ " + r.reason}`);
    if (r.accepted) liveIn.get(target)!.push({ agentId: a.agentId, intent });
  }
}

// ── market: priced commerce via the protocol menu ──
console.log(`\n─ market deals (${sealedBidMarket.protocols.join(", ")}) ─`);
const mLive = liveIn.get(market)!;
const seeks = mLive.filter((x) => x.intent.kind === "seek");
const offers = mLive.filter((x) => x.intent.kind === "offer");
let mAny = false;
for (const s of seeks) for (const o of offers) {
  if (!keywordMatch(s.intent, o.intent, 0.3)) continue;
  if (s.intent.valuation === undefined || o.intent.valuation === undefined) continue;
  const buyer: Buyer = { max: s.intent.valuation };
  const seller: Seller = { min: o.intent.valuation, list: Math.round(o.intent.valuation * 1.3) };
  const deal = agree(sealedBidMarket.protocols, buyer, seller);
  mAny = true;
  console.log(deal
    ? `  ${s.agentId} ⇄ ${o.agentId}  ${deal.protocol} @ ${deal.price}  buyer +${deal.buyerSurplus} seller +${deal.sellerSurplus}  ${deal.messages} msg`
    : `  ${s.agentId} ⇄ ${o.agentId}  no agreement`);
}
if (!mAny) console.log("  (none)");

// ── bazaar: swaps via barter (double coincidence) ──
console.log(`\n─ bazaar deals (barter) ─`);
const bLive = liveIn.get(bazaar)!.filter((x) => x.intent.kind === "swap" || x.intent.kind === "barter");
let bAny = false;
for (let i = 0; i < bLive.length; i++) for (let j = i + 1; j < bLive.length; j++) {
  const a = bLive[i]!, b = bLive[j]!;
  if (doubleCoincidence(a.intent, b.intent)) {
    bAny = true;
    console.log(`  ${a.agentId} ⇄ ${b.agentId}  barter swap  [${(a.intent.have ?? []).join("+")}] ↔ [${(b.intent.have ?? []).join("+")}]`);
  }
}
if (!bAny) console.log("  (none - no double coincidence)");
console.log("");
