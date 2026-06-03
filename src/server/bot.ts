import { Bot, InlineKeyboard } from "grammy";
import { type PrivateIntent } from "../core/intent";
import { LLMDistiller } from "../intake/llmDistiller";
import { matchAgainstPool } from "./commons";
import { type Match, Store, type StoredIntent, type User } from "./store";

const WELCOME =
  "👋 I'm your murmur agent.\n\n" +
  "Just tell me what you want — to buy, sell, swap, find, or offer — in plain words. " +
  "I'll hold your wants quietly and ping you when someone in the group is a match.\n\n" +
  "I only ever broadcast a *blur* (category + tags, no price, no name). " +
  "Heads up: during this pilot the host can see everything — peers only see the blur.\n\n" +
  "Try: \"selling my road bike, around 200, I'm around till Sunday\"";

const fmt = (i: PrivateIntent) => `${i.kind} · ${i.domain} · ${(i.publicTags ?? i.tags).join(", ")}`;

const blurb = (i: PrivateIntent) => {
  const verb = i.kind === "seek" ? "is looking for" : i.kind === "offer" ? "is offering" : "wants to " + i.kind;
  return `someone ${verb}: ${(i.publicTags ?? i.tags).join(", ")} (${i.domain})`;
};
const itemName = (i: PrivateIntent) => (i.publicTags ?? i.tags).slice(0, 3).join(" ");
const userLabel = (u?: User) => (u?.handle ? `@${u.handle}` : u?.name ?? "your match");

export function createBot(token: string): Bot {
  const bot = new Bot(token);
  const store = new Store();
  const distiller = new LLMDistiller();
  const awaitingRevision = new Map<number, string>(); // userId -> matchId (transient)

  const remember = (u: { id: number; username?: string; first_name?: string }) =>
    store.upsertUser({ id: u.id, handle: u.username, name: u.first_name });
  const other = (m: Match, uid: number) => (uid === m.aUser ? m.bUser : m.aUser);

  bot.command("start", (ctx) => { if (ctx.from) remember(ctx.from); return ctx.reply(WELCOME, { parse_mode: "Markdown" }); });
  bot.command("help", (ctx) => ctx.reply(WELCOME, { parse_mode: "Markdown" }));
  bot.command("me", (ctx) => {
    if (!ctx.from) return;
    const list = store.intentsOf(ctx.from.id);
    return ctx.reply(list.length ? list.map((s) => "• " + fmt(s.intent)).join("\n") : "No wants yet — just tell me one.");
  });
  bot.command("clear", (ctx) => { if (!ctx.from) return; store.clearUser(ctx.from.id); return ctx.reply("Cleared your wants."); });
  bot.command("rematch", async (ctx) => {
    if (!ctx.from) return;
    await ctx.reply("Rescanning the pool for matches…");
    await rescan(store.intentsOf(ctx.from.id));
    await ctx.reply("Done — I've pinged you about any new matches.");
  });

  // ── buttons: c = connect/pass on a match, d = approve/revise/abort on a proposal ──
  bot.on("callback_query:data", async (ctx) => {
    const [tag, matchId, decision] = (ctx.callbackQuery.data ?? "").split(":");
    const m = matchId ? store.match(matchId) : undefined;
    if (!m || !ctx.from) return ctx.answerCallbackQuery("This match expired.");
    const side = ctx.from.id === m.aUser ? "a" : ctx.from.id === m.bUser ? "b" : null;
    if (!side) return ctx.answerCallbackQuery();

    if (tag === "c") {
      if (decision === "no") { m.status = "passed"; store.persist(); await ctx.editMessageText("No worries — passed."); return ctx.answerCallbackQuery(); }
      if (side === "a") m.aConsent = true; else m.bConsent = true;
      store.persist();
      await ctx.editMessageText("👍 Interested — waiting for the other side…");
      await ctx.answerCallbackQuery();
      if (m.aConsent && m.bConsent && m.status === "proposed") await negotiate(m);
      return;
    }

    if (tag === "d") {
      if (m.status !== "negotiating") return ctx.answerCallbackQuery("This proposal is no longer open.");
      if (decision === "abort") {
        m.status = "passed"; store.persist();
        await ctx.editMessageText("Aborted.");
        await bot.api.sendMessage(other(m, ctx.from.id), "The other side aborted the deal.");
        return ctx.answerCallbackQuery();
      }
      if (decision === "revise") {
        awaitingRevision.set(ctx.from.id, m.id);
        await ctx.editMessageText("Send me your number (the most you'd pay / least you'd accept) and I'll renegotiate.");
        return ctx.answerCallbackQuery();
      }
      // approve
      if (side === "a") m.aApprove = true; else m.bApprove = true;
      store.persist();
      await ctx.editMessageText(`✅ Approved €${m.price}. Waiting for the other side…`);
      await ctx.answerCallbackQuery();
      if (m.aApprove && m.bApprove) await connect(m);
      return;
    }
    return ctx.answerCallbackQuery();
  });

  // ── any text → (revision?) or distill → store → match ──
  bot.on("message:text", async (ctx) => {
    if (!ctx.from || ctx.message.text.startsWith("/")) return;
    remember(ctx.from);

    // A revision number for a pending proposal?
    const pending = awaitingRevision.get(ctx.from.id);
    if (pending) {
      awaitingRevision.delete(ctx.from.id);
      const m = store.match(pending);
      const num = Number.parseInt(ctx.message.text.replace(/[^0-9]/g, ""), 10);
      if (!m || !Number.isFinite(num)) return ctx.reply("Couldn't read a number — just re-state your want if you like.");
      const mine = store.intent(ctx.from.id === m.aUser ? m.aIntent : m.bIntent);
      if (mine) { mine.intent.valuation = num; store.persist(); }
      await ctx.reply(`Got it — renegotiating around €${num}.`);
      m.status = "proposed"; m.aApprove = false; m.bApprove = false; store.persist();
      await negotiate(m);
      return;
    }

    await ctx.replyWithChatAction("typing");
    const intents = await distiller.distill({
      agentId: `tg${ctx.from.id}`, persona: ctx.from.first_name ?? "a friend", utterances: [ctx.message.text],
    });
    if (intents.length === 0) return ctx.reply("Noted — nothing to act on there. Tell me something you want to buy, sell, swap, or find.");

    const stored = intents.map((i) => store.addIntent(ctx.from!.id, i));
    await ctx.reply(
      "Got it:\n" + stored.map((s) => "• " + fmt(s.intent) + (s.intent.active === false ? "  (holding — half-formed)" : "")).join("\n") +
        "\n\nBroadcasting a blur. I'll ping you on a match.",
    );
    await rescan(stored.filter((s) => s.intent.active !== false));
  });

  async function rescan(intents: StoredIntent[]) {
    for (const s of intents) {
      if (s.intent.active === false) continue;
      const hits = await matchAgainstPool(s, store.pool());
      for (const hit of hits) await propose(s, hit);
    }
  }

  async function propose(a: StoredIntent, b: StoredIntent) {
    if (store.findMatch(a.intent.id, b.intent.id)) return;
    const m = store.addMatch(a.userId, b.userId, a.intent.id, b.intent.id);
    const kb = (id: string) => new InlineKeyboard().text("Connect", `c:${id}:yes`).text("Pass", `c:${id}:no`);
    await bot.api.sendMessage(a.userId, `🎯 Match — ${blurb(b.intent)}. Connect?`, { reply_markup: kb(m.id) });
    await bot.api.sendMessage(b.userId, `🎯 Match — ${blurb(a.intent)}. Connect?`, { reply_markup: kb(m.id) });
  }

  /** Agents propose a price from the private reserves, then gate on both sides. */
  async function negotiate(m: Match) {
    const ai = store.intent(m.aIntent)?.intent;
    const bi = store.intent(m.bIntent)?.intent;
    if (!ai || !bi) return;

    const buyer = ai.kind === "seek" ? { uid: m.aUser, max: ai.valuation } : bi.kind === "seek" ? { uid: m.bUser, max: bi.valuation } : null;
    const seller = ai.kind === "offer" ? { uid: m.aUser, min: ai.valuation } : bi.kind === "offer" ? { uid: m.bUser, min: bi.valuation } : null;

    let price: number | null = null;
    if (buyer && seller) {
      const { max } = buyer, { min } = seller;
      if (max != null && min != null) price = max >= min ? Math.round((max + min) / 2) : null; // midpoint, or no ZOPA
      else if (min != null) price = min;
      else if (max != null) price = max;
    }
    if (price == null) { await connect(m); return; } // swap / no overlap / no price → just connect

    m.price = price; m.status = "negotiating"; m.aApprove = false; m.bApprove = false; store.persist();
    const item = itemName(ai.kind === "offer" ? ai : bi);
    const kb = (id: string) => new InlineKeyboard()
      .text("Approve", `d:${id}:approve`).text("Revise", `d:${id}:revise`).text("Abort", `d:${id}:abort`);
    const msg = `💬 My agent negotiated: *${item}* for *€${price}*.\nApprove?`;
    await bot.api.sendMessage(m.aUser, msg, { parse_mode: "Markdown", reply_markup: kb(m.id) });
    await bot.api.sendMessage(m.bUser, msg, { parse_mode: "Markdown", reply_markup: kb(m.id) });
  }

  async function connect(m: Match) {
    m.status = "connected"; store.persist();
    const ua = store.user(m.aUser), ub = store.user(m.bUser);
    const terms = m.price != null ? ` at €${m.price}` : "";
    await bot.api.sendMessage(m.aUser, `🎉 Deal${terms}! You're connected with ${userLabel(ub)} — sort the details and meet up.`);
    await bot.api.sendMessage(m.bUser, `🎉 Deal${terms}! You're connected with ${userLabel(ua)} — sort the details and meet up.`);
  }

  // Safety net: periodically surface dormant matches. Cached judges keep it cheap.
  setInterval(() => { rescan(store.pool()).catch((e) => console.error("rescan error:", e)); }, 3 * 60_000);

  bot.catch((err) => console.error("bot error:", err.error));
  return bot;
}
