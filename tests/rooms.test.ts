import { describe, expect, it } from "vitest";
import type { PublicSignal } from "../src/core/intent";
import { sealedBidMarket } from "../src/rooms/charters";
import { Room } from "../src/rooms/room";

// Issue #4: a Room must ENFORCE its charter (admission, schema/domain, rate)
// regardless of whether an agent read the etiquette. One rejection per rule.

const sig = (over: Partial<PublicSignal> = {}): PublicSignal => ({
  id: "s1", pseudonymId: "anon-a", kind: "offer", domain: "goods.games", tags: ["switch"], region: "*", ...over, trustGate: 1,
});

describe("Room charter enforcement (issue #4)", () => {
  it("refuses admission below minTrust, and blocks non-members from posting", () => {
    const room = new Room(sealedBidMarket); // minTrust 0.5
    expect(room.join({ agentId: "a", trustScore: 0.2 }).ok).toBe(false);
    const r = room.publish("a", sig(), 0);
    expect(r.accepted).toBe(false);
    expect(r.reason).toMatch(/member/);
  });

  it("admits at/above minTrust and accepts a valid post", () => {
    const room = new Room(sealedBidMarket);
    expect(room.join({ agentId: "a", trustScore: 0.5 }).ok).toBe(true);
    expect(room.publish("a", sig(), 0).accepted).toBe(true);
  });

  it("rejects a disallowed domain", () => {
    const room = new Room(sealedBidMarket); // allowedDomains: ["goods."]
    room.join({ agentId: "a", trustScore: 1 });
    const r = room.publish("a", sig({ domain: "social.event" }), 0);
    expect(r.accepted).toBe(false);
    expect(r.reason).toMatch(/domain/);
  });

  it("rejects a signal with no tags", () => {
    const room = new Room(sealedBidMarket);
    room.join({ agentId: "a", trustScore: 1 });
    expect(room.publish("a", sig({ tags: [] }), 0).accepted).toBe(false);
  });

  it("enforces the rate limit over a sliding window", () => {
    const room = new Room(sealedBidMarket); // 2 signals / 5 ticks
    room.join({ agentId: "a", trustScore: 1 });
    expect(room.publish("a", sig(), 0).accepted).toBe(true);
    expect(room.publish("a", sig(), 1).accepted).toBe(true);
    const blocked = room.publish("a", sig(), 2);
    expect(blocked.accepted).toBe(false);
    expect(blocked.reason).toMatch(/rate/);
    // window slides past windowTicks -> allowed again
    expect(room.publish("a", sig(), 10).accepted).toBe(true);
  });
});
