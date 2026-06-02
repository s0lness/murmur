import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PublicSignal } from "../core/intent";
import { agree, type Buyer, type Seller } from "../negotiate/protocols";
import { sealedBidMarket } from "./charters";
import { Room } from "./room";

const sig = (id: string, domain: string, tags: string[]): PublicSignal =>
  ({ id, pseudonymId: "anon", kind: "offer", domain, tags, region: "*", trustGate: 0 });

// ── 1) charter enforcement timeline ──
const room = new Room(sealedBidMarket);
const events: { agent: string; action: string; ok: boolean; detail: string }[] = [];
const enter = (agent: string, trust: number) => {
  const r = room.join({ agentId: agent, trustScore: trust });
  events.push({ agent, action: `join (trust ${trust})`, ok: r.ok, detail: r.ok ? "admitted" : r.reason });
};
const tryPost = (agent: string, s: PublicSignal, now: number, note: string) => {
  const r = room.publish(agent, s, now);
  events.push({ agent, action: `post ${note}`, ok: r.accepted, detail: r.accepted ? "accepted" : (r.reason ?? "rejected") });
};
enter("good", 0.8);
enter("stranger", 0.1);
enter("spammer", 0.6);
tryPost("good", sig("g1", "goods.games", ["switch"]), 0, "goods listing");
tryPost("stranger", sig("s1", "goods.games", ["ps5"]), 0, "(not a member)");
tryPost("spammer", sig("x0", "housing.swap", ["apartment"]), 0, "off-charter domain");
for (let i = 1; i <= 4; i++) tryPost("spammer", sig(`x${i}`, "goods.misc", ["junk"]), 1, `flood #${i}`);

// ── 2) protocol menu across rooms ──
const protoRooms = [
  { id: "fast-market", allowed: ["instant-match", "sealed-bid"] },
  { id: "fair-market", allowed: ["sealed-bid"] },
  { id: "bazaar", allowed: ["natural-language"] },
];
const deals: { item: string; buyer: Buyer; seller: Seller }[] = [
  { item: "switch", buyer: { max: 240 }, seller: { min: 180, list: 220 } },
  { item: "ps5", buyer: { max: 430 }, seller: { min: 350, list: 460 } },
];
const protocols = deals.map((d) => ({
  item: d.item,
  buyerMax: d.buyer.max,
  sellerMin: d.seller.min,
  list: d.seller.list,
  byRoom: Object.fromEntries(protoRooms.map((r) => [r.id, agree(r.allowed, d.buyer, d.seller)])),
}));

const lab = {
  enforcement: { charter: room.charter, events, accepted: room.accepted.map((s) => s.id) },
  protocols: { rooms: protoRooms, deals: protocols },
};

const dir = join(process.cwd(), "viewer");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "lab.js"), `window.LAB = ${JSON.stringify(lab)};\n`);
console.log("recorded -> viewer/lab.js  ·  open /lab.html");
