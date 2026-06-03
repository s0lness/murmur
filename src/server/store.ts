import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PrivateIntent } from "../core/intent";

export interface User { id: number; handle?: string; name?: string }
export interface StoredIntent { id: string; userId: number; intent: PrivateIntent; createdAt: number }
export interface Match {
  id: string;
  aUser: number; bUser: number;
  aIntent: string; bIntent: string;
  aConsent: boolean; bConsent: boolean;
  status: "proposed" | "negotiating" | "connected" | "passed";
  price?: number;
  aApprove?: boolean;
  bApprove?: boolean;
}

interface Data { users: User[]; intents: StoredIntent[]; matches: Match[]; seq: number }

/** Tiny JSON-file store — the whole `murmur.db.json`. No native deps; fine at
 *  friends-group scale, survives restarts. */
export class Store {
  private path: string;
  private data: Data;

  constructor(file = "murmur.db.json") {
    this.path = join(process.cwd(), file);
    this.data = existsSync(this.path)
      ? (JSON.parse(readFileSync(this.path, "utf8")) as Data)
      : { users: [], intents: [], matches: [], seq: 1 };
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
  pool() { return this.data.intents; }
  clearUser(userId: number) {
    this.data.intents = this.data.intents.filter((i) => i.userId !== userId);
    this.save();
  }

  match(id: string) { return this.data.matches.find((m) => m.id === id); }
  findMatch(x: string, y: string) {
    return this.data.matches.find(
      (m) => (m.aIntent === x && m.bIntent === y) || (m.aIntent === y && m.bIntent === x),
    );
  }
  addMatch(aUser: number, bUser: number, aIntent: string, bIntent: string): Match {
    const m: Match = {
      id: `m${this.data.seq++}`, aUser, bUser, aIntent, bIntent,
      aConsent: false, bConsent: false, status: "proposed",
    };
    this.data.matches.push(m);
    this.save();
    return m;
  }
  persist() { this.save(); }

  /** Drop synthetic /simulate users (negative ids) — called at startup so each
   *  run begins clean of test counterparts. */
  purgeSims() {
    this.data.intents = this.data.intents.filter((i) => i.userId >= 0);
    this.data.users = this.data.users.filter((u) => u.id >= 0);
    this.data.matches = this.data.matches.filter((m) => m.aUser >= 0 && m.bUser >= 0);
    this.save();
  }
}
