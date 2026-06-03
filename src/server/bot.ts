import { Bot, InlineKeyboard } from "grammy";
import { blur, type PrivateIntent } from "../core/intent";
import { LLMDistiller } from "../intake/llmDistiller";
import { matchAgainstPool } from "./commons";
import { Store, type StoredIntent, type User } from "./store";

const WELCOME =
  "👋 I'm your murmur agent.\n\n" +
  "Just tell me what you want — to buy, sell, swap, find, or offer — in plain words. " +
  "I'll hold your wants quietly and ping you when someone in the group is a match.\n\n" +
  "I only ever broadcast a *blur* (category + tags, no price, no name). " +
  "Heads up: during this pilot the host can see everything — peers only see the blur.\n\n" +
  "Try: \"selling my road bike, around 200, I'm around till Sunday\"";

const fmt = (i: PrivateIntent) =>
  `${i.kind} · ${i.domain} · ${(i.publicTags ?? i.tags).join(", ")}`;

/** Blurred description shown to the OTHER party — no price, no identity. */
const blurb = (i: PrivateIntent) => {
  const verb = i.kind === "seek" ? "is looking for" : i.kind === "offer" ? "is offering" : "wants to " + i.kind;
  return `someone ${verb}: ${(i.publicTags ?? i.tags).join(", ")} (${i.domain})`;
};

const userLabel = (u?: User) => (u?.handle ? `@${u.handle}` : u?.name ?? "your match");

export function createBot(token: string): Bot {
  const bot = new Bot(token);
  const store = new Store();
  const distiller = new LLMDistiller();

  const remember = (u: { id: number; username?: string; first_name?: string }) =>
    store.upsertUser({ id: u.id, handle: u.username, name: u.first_name });

  bot.command("start", (ctx) => {
    if (ctx.from) remember(ctx.from);
    return ctx.reply(WELCOME, { parse_mode: "Markdown" });
  });
  bot.command("help", (ctx) => ctx.reply(WELCOME, { parse_mode: "Markdown" }));
  bot.command("me", (ctx) => {
    if (!ctx.from) return;
    const list = store.intentsOf(ctx.from.id);
    return ctx.reply(list.length ? list.map((s) => "• " + fmt(s.intent)).join("\n") : "No wants yet — just tell me one.");
  });
  bot.command("clear", (ctx) => {
    if (!ctx.from) return;
    store.clearUser(ctx.from.id);
    return ctx.reply("Cleared your wants.");
  });
  bot.command("rematch", async (ctx) => {
    if (!ctx.from) return;
    await ctx.reply("Rescanning the pool for matches…");
    await rescan(store.intentsOf(ctx.from.id));
    await ctx.reply("Done — I've pinged you about any new matches.");
  });

  // ── consent buttons on a proposed match ──
  bot.on("callback_query:data", async (ctx) => {
    const [, matchId, decision] = (ctx.callbackQuery.data ?? "").split(":");
    const m = matchId ? store.match(matchId) : undefined;
    if (!m || !ctx.from) return ctx.answerCallbackQuery("This match expired.");
    const side = ctx.from.id === m.aUser ? "a" : ctx.from.id === m.bUser ? "b" : null;
    if (!side) return ctx.answerCallbackQuery();

    if (decision === "no") {
      m.status = "passed"; store.persist();
      await ctx.editMessageText("No worries — passed.");
      return ctx.answerCallbackQuery();
    }
    if (side === "a") m.aConsent = true; else m.bConsent = true;
    store.persist();
    await ctx.editMessageText("👍 You're in — waiting for the other side…");
    await ctx.answerCallbackQuery();

    if (m.aConsent && m.bConsent && m.status === "proposed") {
      m.status = "connected"; store.persist();
      const ua = store.user(m.aUser), ub = store.user(m.bUser);
      await bot.api.sendMessage(m.aUser, `🎉 You're connected with ${userLabel(ub)} — take it from here and sort the details.`);
      await bot.api.sendMessage(m.bUser, `🎉 You're connected with ${userLabel(ua)} — take it from here and sort the details.`);
    }
  });

  // ── any text → distill → store → match ──
  bot.on("message:text", async (ctx) => {
    if (!ctx.from || ctx.message.text.startsWith("/")) return;
    remember(ctx.from);
    await ctx.replyWithChatAction("typing");

    const intents = await distiller.distill({
      agentId: `tg${ctx.from.id}`,
      persona: ctx.from.first_name ?? "a friend",
      utterances: [ctx.message.text],
    });
    if (intents.length === 0) {
      return ctx.reply("Noted — nothing to act on there. Tell me something you want to buy, sell, swap, or find.");
    }

    const stored = intents.map((i) => store.addIntent(ctx.from!.id, i));
    const live = stored.filter((s) => s.intent.active !== false);
    await ctx.reply(
      "Got it:\n" + stored.map((s) => "• " + fmt(s.intent) + (s.intent.active === false ? "  (holding — half-formed)" : "")).join("\n") +
        "\n\nBroadcasting a blur. I'll ping you on a match.",
    );

    await rescan(live);
  });

  /** Match each given intent against the live pool and ping new matches.
   *  Dedup lives in propose(), so re-scanning never double-pings. */
  async function rescan(intents: StoredIntent[]) {
    for (const s of intents) {
      if (s.intent.active === false) continue;
      const hits = await matchAgainstPool(s, store.pool());
      for (const hit of hits) await propose(s, hit);
    }
  }

  async function propose(a: StoredIntent, b: StoredIntent) {
    if (store.findMatch(a.intent.id, b.intent.id)) return; // already proposed/passed
    const m = store.addMatch(a.userId, b.userId, a.intent.id, b.intent.id);
    const kb = (id: string) => new InlineKeyboard().text("Connect", `c:${id}:yes`).text("Pass", `c:${id}:no`);
    await bot.api.sendMessage(a.userId, `🎯 Match — ${blurb(b.intent)}. Connect?`, { reply_markup: kb(m.id) });
    await bot.api.sendMessage(b.userId, `🎯 Match — ${blurb(a.intent)}. Connect?`, { reply_markup: kb(m.id) });
  }

  // Safety net: periodically rescan the whole pool so dormant intents (arrived
  // with no complement, or during a crash) still surface. Cached judges keep it
  // cheap when nothing changed.
  const RESCAN_MS = 3 * 60_000;
  setInterval(() => { rescan(store.pool()).catch((e) => console.error("rescan error:", e)); }, RESCAN_MS);

  bot.catch((err) => console.error("bot error:", err.error));
  return bot;
}
