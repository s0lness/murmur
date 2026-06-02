import type { PublicSignal } from "../core/intent";
import { sealedBidMarket } from "./charters";
import { Room } from "./room";

/** Minimal blurred signal for the demo. */
function sig(id: string, domain: string, tags: string[]): PublicSignal {
  return { id, pseudonymId: "anon", kind: "offer", domain, tags, region: "*", trustGate: 0 };
}

const room = new Room(sealedBidMarket);
console.log(`\n▶ room: ${room.charter.id}`);
console.log(`  etiquette: "${room.rulesOfTheRoom()}"\n`);

// Cooperative, trusted member.
const good = room.join({ agentId: "good", trustScore: 0.8 });
console.log(`good (trust .8) join: ${good.ok ? "admitted" : good.reason}`);

// Untrusted agent — bounced at the door.
const stranger = room.join({ agentId: "stranger", trustScore: 0.1 });
console.log(`stranger (trust .1) join: ${stranger.ok ? "admitted" : "REFUSED — " + stranger.reason}`);

// A member who never read the etiquette and misbehaves.
const spammer = room.join({ agentId: "spammer", trustScore: 0.6 });
console.log(`spammer (trust .6) join: ${spammer.ok ? "admitted" : spammer.reason}\n`);

console.log("─ posting (enforced regardless of etiquette) ─────");

// good: one valid listing.
log("good", room.publish("good", sig("g1", "goods.games", ["switch"]), 0));

// stranger: not admitted → can't post.
log("stranger", room.publish("stranger", sig("s1", "goods.games", ["ps5"]), 0));

// spammer: wrong domain (off-charter), then floods past the rate limit.
log("spammer", room.publish("spammer", sig("x0", "housing.swap", ["apartment"]), 0));
for (let i = 1; i <= 4; i++) log("spammer", room.publish("spammer", sig(`x${i}`, "goods.misc", ["junk"]), 1));

console.log(`\n─ result ─────────────────────────────────────────`);
console.log(`  accepted signals : ${room.accepted.length}  [${room.accepted.map((s) => s.id).join(", ")}]`);
console.log(`  rejections       : ${room.rejections.length}`);
for (const r of room.rejections) console.log(`     ✗ ${r.agentId}: ${r.reason}`);
console.log("");

function log(who: string, r: { accepted: boolean; reason?: string }) {
  console.log(`  ${who.padEnd(9)} ${r.accepted ? "✓ accepted" : "✗ " + r.reason}`);
}
