import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PrivateIntent } from "../core/intent";

export interface User { id: number; handle?: string; name?: string; lang?: string }
export interface StoredIntent { id: string; userId: number; intent: PrivateIntent; createdAt: number }
export interface Match {
  id: string;
  aUser: number; bUser: number;
  aIntent: string; bIntent: string;
  domain: string;
  aConsent: boolean; bConsent: boolean;
  status: "proposed" | "negotiating" | "connected" | "passed";
  price?: number;
  aApprove?: boolean;
  bApprove?: boolean;
}

/** A pair of people who already settled a category (passed or dealt) - survives
 *  intent re-statement, so we never re-suggest them for it. */
interface Dismissal { a: number; b: number; domain: string }

/** A multi-party deal: a group-buy (anchor + buyers) or a barter ring (ordered). */
export interface DealParty { userId: number; intentId: string }
export interface MultiDeal {
  id: string;
  mode: "group" | "ring";
  domain: string;
  parties: DealParty[]; // group: parties[0] = anchor (seller); ring: ordered members
  qty: number;
  approvals: number[];
  declines: number[];
  status: "proposed" | "settled" | "failed";
}

interface Data {
  users: User[]; intents: StoredIntent[]; matches: Match[];
  dismissals: Dismissal[]; multiDeals: MultiDeal[]; seq: number;
}

/** Tiny JSON-file store - the whole `murmur.db.json`. No native deps; fine at
 *  friends-group scale, survives restarts. */
export class Store {
  private path: string;
  private data: Data;

  constructor(file = "murmur.db.json") {
    this.path = join(process.cwd(), file);
    this.data = existsSync(this.path)
      ? (JSON.parse(readFileSync(this.path, "utf8")) as Data)
      : { users: [], intents: [], matches: [], dismissals: [], multiDeals: [], seq: 1 };
    this.data.dismissals ??= []; // back-compat for older db files
    this.data.multiDeals ??= [];
  }
  private save() { writeFileSync(this.path, JSON.stringify(this.data, null, 2)); }

  upsertUser(u: User) {
    const e = this.data.users.find((x) => x.id === u.id);
    if (e) Object.assign(e, u); else this.data.users.push(u);
    this.save();
  }
  user(id: number) { return this.data.users.find((x) => x.id === id); }

  addIntent(userId: number, intent: PrivateIntent): StoredIntent {
    const id = `${userId}:${this.data.seq++}`;
    const si: StoredIntent = { id, userId, intent: { ...intent, id }, createdAt: Date.now() };
    this.data.intents.push(si);
    this.save();
    return si;
  }
  intentsOf(userId: number) { return this.data.intents.filter((i) => i.userId === userId); }
  intent(id: string) { return this.data.intents.find((i) => i.id === id); }
  removeIntent(id: string) {
    this.data.intents = this.data.intents.filter((i) => i.id !== id);
    this.data.matches = this.data.matches.filter((m) => m.aIntent !== id && m.bIntent !== id);
    this.save();
  }
  updateIntent(id: string, valuation: number | undefined, active: boolean) {
    const si = this.data.intents.find((i) => i.id === id);
    if (si) { si.intent.valuation = valuation; si.intent.active = active; this.save(); }
  }
  pool() { return this.data.intents; }
  clearUser(userId: number) {
    this.data.intents = this.data.intents.filter((i) => i.userId !== userId);
    this.save();
  }

  match(id: string) { return this.data.matches.find((m) => m.id === id); }
  matchesOf(userId: number) { return this.data.matches.filter((m) => m.aUser === userId || m.bUser === userId); }
  findMatch(x: string, y: string) {
    return this.data.matches.find(
      (m) => (m.aIntent === x && m.bIntent === y) || (m.aIntent === y && m.bIntent === x),
    );
  }
  addMatch(aUser: number, bUser: number, aIntent: string, bIntent: string, domain: string): Match {
    const m: Match = {
      id: `m${this.data.seq++}`, aUser, bUser, aIntent, bIntent, domain,
      aConsent: false, bConsent: false, status: "proposed",
    };
    this.data.matches.push(m);
    this.save();
    return m;
  }

  /** Remember that a pair has settled a category - never suggest them for it again. */
  dismiss(u1: number, u2: number, domain: string) {
    const [a, b] = u1 < u2 ? [u1, u2] : [u2, u1];
    if (!this.data.dismissals.some((d) => d.a === a && d.b === b && d.domain === domain)) {
      this.data.dismissals.push({ a, b, domain });
      this.save();
    }
  }
  isDismissed(u1: number, u2: number, domain: string): boolean {
    const [a, b] = u1 < u2 ? [u1, u2] : [u2, u1];
    return this.data.dismissals.some((d) => d.a === a && d.b === b && d.domain === domain);
  }

  // ── multi-party deals ──
  addMultiDeal(mode: "group" | "ring", domain: string, parties: DealParty[], qty: number): MultiDeal {
    const d: MultiDeal = { id: `g${this.data.seq++}`, mode, domain, parties, qty, approvals: [], declines: [], status: "proposed" };
    this.data.multiDeals.push(d);
    this.save();
    return d;
  }
  multiDeal(id: string) { return this.data.multiDeals.find((d) => d.id === id); }
  /** Dedup key: same mode + same set of people. */
  findMultiByParties(mode: "group" | "ring", userIds: number[]): MultiDeal | undefined {
    const key = [...userIds].sort((a, b) => a - b).join(",");
    return this.data.multiDeals.find(
      (d) => d.mode === mode && [...d.parties.map((p) => p.userId)].sort((a, b) => a - b).join(",") === key,
    );
  }
  persist() { this.save(); }

  /** Read-only view for the host dashboard. */
  snapshot() { return { users: this.data.users, intents: this.data.intents, matches: this.data.matches }; }

  /** Drop intents older than ttlMs (and their matches) so stale wants don't linger. */
  purgeExpired(ttlMs: number): number {
    const cutoff = Date.now() - ttlMs;
    const before = this.data.intents.length;
    const keep = new Set(this.data.intents.filter((i) => i.createdAt >= cutoff).map((i) => i.id));
    this.data.intents = this.data.intents.filter((i) => keep.has(i.id));
    this.data.matches = this.data.matches.filter((m) => keep.has(m.aIntent) && keep.has(m.bIntent));
    const dropped = before - this.data.intents.length;
    if (dropped > 0) this.save();
    return dropped;
  }

  /** Drop matches that reference an intent that no longer exists. */
  purgeOrphanMatches() {
    const ids = new Set(this.data.intents.map((i) => i.id));
    const before = this.data.matches.length;
    this.data.matches = this.data.matches.filter((m) => ids.has(m.aIntent) && ids.has(m.bIntent));
    if (this.data.matches.length !== before) this.save();
  }

  /** Drop synthetic /simulate users (negative ids) - called at startup so each
   *  run begins clean of test counterparts. */
  purgeSims() {
    this.data.intents = this.data.intents.filter((i) => i.userId >= 0);
    this.data.users = this.data.users.filter((u) => u.id >= 0);
    this.data.matches = this.data.matches.filter((m) => m.aUser >= 0 && m.bUser >= 0);
    this.save();
  }
}
