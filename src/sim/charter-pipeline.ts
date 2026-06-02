import { blur, type PrivateIntent } from "../core/intent";
import { keywordMatch } from "../matching/keywordMatcher";
import { agree, type Buyer, type Seller } from "../negotiate/protocols";
import { barterBazaar, sealedBidMarket } from "../rooms/charters";
import type { Charter } from "../rooms/charter";
import { Room } from "../rooms/room";

export interface AgentInput {
  agentId: string;
  persona: string;
  utterances: string[];
  intents: PrivateIntent[];
}

export interface RouteRow {
  agentId: string; kind: string; domain: string;
  room: "market" | "bazaar"; accepted: boolean; reason?: string;
}
export interface MarketDeal {
  seek: string; offer: string; status: "deal" | "no-agreement";
  protocol?: string; price?: number; buyerSurplus?: number; sellerSurplus?: number; messages?: number;
}
export interface BarterDeal { a: string; b: string; haveA: string[]; haveB: string[] }

export interface PipelineResult {
  marketCharter: Charter;
  bazaarCharter: Charter;
  routing: RouteRow[];
  market: MarketDeal[];
  bazaar: BarterDeal[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const cities = (xs: string[] = []) => xs.filter((t) => /^city:/i.test(t)).map(norm);
const dates = (xs: string[] = []) => xs.filter((t) => /\d{4}/.test(t)).map(norm);

/** Barter: double coincidence on the place dimension, dates overlap-if-present. */
function doubleCoincidence(a: PrivateIntent, b: PrivateIntent): boolean {
  const aWant = cities(a.want), aHave = cities(a.have);
  const bWant = cities(b.want), bHave = cities(b.have);
  if (!aWant.length || !bWant.length) return false;
  if (!(aWant.every((w) => bHave.includes(w)) && bWant.every((w) => aHave.includes(w)))) return false;
  const aD = [...dates(a.have), ...dates(a.want)], bD = [...dates(b.have), ...dates(b.want)];
  return !aD.length || !bD.length || aD.some((d) => bD.includes(d));
}

/** The whole loop: route active intents into charter rooms, then close deals
 *  by each room's mechanism (price protocols / barter). Shared by CLI + viewer. */
export function runPipeline(agents: AgentInput[]): PipelineResult {
  const market = new Room(sealedBidMarket);
  const bazaar = new Room(barterBazaar);
  for (const a of agents) {
    market.join({ agentId: a.agentId, trustScore: 1 });
    bazaar.join({ agentId: a.agentId, trustScore: 1 });
  }

  const routing: RouteRow[] = [];
  const mLive: { agentId: string; intent: PrivateIntent }[] = [];
  const bLive: { agentId: string; intent: PrivateIntent }[] = [];
  for (const a of agents) {
    for (const intent of a.intents) {
      if (intent.active === false) continue;
      const toMarket = intent.domain.startsWith("goods.");
      const target = toMarket ? market : bazaar;
      const r = target.publish(a.agentId, blur(intent, a.agentId), 0);
      routing.push({ agentId: a.agentId, kind: intent.kind, domain: intent.domain, room: toMarket ? "market" : "bazaar", accepted: r.accepted, reason: r.reason });
      if (r.accepted) (toMarket ? mLive : bLive).push({ agentId: a.agentId, intent });
    }
  }

  const market_: MarketDeal[] = [];
  for (const s of mLive.filter((x) => x.intent.kind === "seek")) {
    for (const o of mLive.filter((x) => x.intent.kind === "offer")) {
      if (!keywordMatch(s.intent, o.intent, 0.3)) continue;
      if (s.intent.valuation === undefined || o.intent.valuation === undefined) continue;
      const buyer: Buyer = { max: s.intent.valuation };
      const seller: Seller = { min: o.intent.valuation, list: Math.round(o.intent.valuation * 1.3) };
      const deal = agree(sealedBidMarket.protocols, buyer, seller);
      market_.push(deal
        ? { seek: s.agentId, offer: o.agentId, status: "deal", ...deal }
        : { seek: s.agentId, offer: o.agentId, status: "no-agreement" });
    }
  }

  const bazaar_: BarterDeal[] = [];
  const swaps = bLive.filter((x) => x.intent.kind === "swap" || x.intent.kind === "barter");
  for (let i = 0; i < swaps.length; i++) {
    for (let j = i + 1; j < swaps.length; j++) {
      const a = swaps[i]!, b = swaps[j]!;
      if (doubleCoincidence(a.intent, b.intent)) {
        bazaar_.push({ a: a.agentId, b: b.agentId, haveA: a.intent.have ?? [], haveB: b.intent.have ?? [] });
      }
    }
  }

  return { marketCharter: sealedBidMarket, bazaarCharter: barterBazaar, routing, market: market_, bazaar: bazaar_ };
}
