import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PrivateIntent } from "../src/core/intent";
import { Store } from "../src/server/store";

// Issue #4: the Telegram pilot's store boundary - adding intents, match dedup,
// and consent state transitions (incl. persistence across a restart). No API.

const intent = (over: Partial<PrivateIntent> = {}): PrivateIntent => ({
  id: "x", kind: "offer", domain: "goods.games", tags: ["switch"], region: "*", ...over,
});

const files: string[] = [];
function freshStore(): { store: Store; file: string } {
  const file = `test-store-${files.length}-${Math.random().toString(36).slice(2)}.json`;
  files.push(file);
  return { store: new Store(file), file };
}
afterEach(() => {
  for (const f of files.splice(0)) {
    const p = join(process.cwd(), f);
    if (existsSync(p)) rmSync(p);
  }
});

describe("Store (issue #4)", () => {
  it("adds intents with stable ids scoped to a user", () => {
    const { store } = freshStore();
    const si = store.addIntent(1, intent());
    expect(si.id).toBeTruthy();
    expect(store.intent(si.id)?.intent.domain).toBe("goods.games");
    expect(store.intentsOf(1)).toHaveLength(1);
    expect(store.intentsOf(2)).toHaveLength(0);
  });

  it("dedupes matches regardless of intent order", () => {
    const { store } = freshStore();
    const a = store.addIntent(1, intent({ kind: "seek" }));
    const b = store.addIntent(2, intent({ kind: "offer" }));
    const m = store.addMatch(1, 2, a.id, b.id, "goods.games");
    expect(store.findMatch(a.id, b.id)?.id).toBe(m.id);
    expect(store.findMatch(b.id, a.id)?.id).toBe(m.id); // reversed, same match
  });

  it("transitions consent state and persists it across a reload", () => {
    const { store, file } = freshStore();
    const m = store.addMatch(1, 2, "i1", "i2", "goods.games");
    expect(m.status).toBe("proposed");
    expect(m.aConsent).toBe(false);

    m.aConsent = true;
    m.bConsent = true;
    m.status = "connected";
    store.persist();

    const reloaded = new Store(file); // simulate a process restart
    const r = reloaded.match(m.id);
    expect(r?.aConsent).toBe(true);
    expect(r?.bConsent).toBe(true);
    expect(r?.status).toBe("connected");
  });

  it("dismissals are symmetric in the two user ids", () => {
    const { store } = freshStore();
    store.dismiss(2, 1, "goods.games");
    expect(store.isDismissed(1, 2, "goods.games")).toBe(true);
    expect(store.isDismissed(2, 1, "goods.games")).toBe(true);
    expect(store.isDismissed(1, 2, "goods.phones")).toBe(false);
  });

  it("removing an intent cascades to its matches", () => {
    const { store } = freshStore();
    const a = store.addIntent(1, intent({ kind: "seek" }));
    const b = store.addIntent(2, intent({ kind: "offer" }));
    store.addMatch(1, 2, a.id, b.id, "goods.games");
    store.removeIntent(a.id);
    expect(store.findMatch(a.id, b.id)).toBeUndefined();
  });
});
