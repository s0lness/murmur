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

export function createBot(token: string, store: Store): Bot {
  const bot = new Bot(token);
  const distiller = new LLMDistiller();
  const awaitingRevision = new Map<number, string>(); // userId -> matchId (transient)
  const awaitingClarify = new Map<number, { intentId: string; question: string }>();
  const awaitingAnswer = new Map<number, { matchId: string; asker: number; question: string }>();
  let simSeq = -1; // synthetic /simulate users get negative ids

  const remember = (u: { id: number; username?: string; first_name?: string }) =>
    store.upsertUser({ id: u.id, handle: u.username, name: u.first_name });
  const other = (m: Match, uid: number) => (uid === m.aUser ? m.bUser : m.aUser);

  // Synthetic counterparts (from /simulate) have negative ids, no Telegram chat.
  const isSim = (uid: number) => uid < 0;
  const notify = async (uid: number, text: string, extra?: Parameters<typeof bot.api.sendMessage>[2]) => {
    if (isSim(uid)) return; // no real chat to message
    await bot.api.sendMessage(uid, text, extra);
  };

  bot.command("start", (ctx) => { if (ctx.from) remember(ctx.from); return ctx.reply(WELCOME, { parse_mode: "Markdown" }); });
  bot.command("help", (ctx) => ctx.reply(WELCOME, { parse_mode: "Markdown" }));
  bot.command("me", (ctx) => {
    if (!ctx.from) return;
    const list = store.intentsOf(ctx.from.id);
    return ctx.reply(list.length ? list.map((s) => "• " + fmt(s.intent)).join("\n") : "No wants yet — just tell me one.");
  });
  bot.command("clear", (ctx) => { if (!ctx.from) return; store.clearUser(ctx.from.id); return ctx.reply("Cleared your wants."); });
  bot.command("status", (ctx) => {
    if (!ctx.from) return;
    const mine = store.intentsOf(ctx.from.id).filter((s) => s.intent.active !== false);
    const snap = store.snapshot();
    const realIntents = snap.intents.filter((i) => i.userId >= 0);
    const people = new Set(realIntents.map((i) => i.userId)).size;
    const myMatches = snap.matches.filter((m) => m.aUser === ctx.from!.id || m.bUser === ctx.from!.id);
    const deals = myMatches.filter((m) => m.status === "connected").length;
    return ctx.reply(
      `Your live wants (${mine.length}):\n${mine.map((s) => "• " + fmt(s.intent)).join("\n") || "—"}\n\n` +
        `Pool: ${realIntents.length} wants from ${people} ${people === 1 ? "person" : "people"}.\n` +
        `Your matches: ${myMatches.length}${deals ? ` (${deals} deal${deals === 1 ? "" : "s"})` : ""}.`,
    );
  });
  bot.command("rematch", async (ctx) => {
    if (!ctx.from) return;
    await ctx.reply("Rescanning the pool for matches…");
    await rescan(store.intentsOf(ctx.from.id));
    await ctx.reply("Done — I've pinged you about any new matches.");
  });
  // Dev: inject a synthetic counterpart that auto-responds, so you can test the
  // full match → negotiate → deal loop from one account.
  bot.command("simulate", async (ctx) => {
    if (!ctx.from) return;
    const text = ctx.match.trim();
    if (!text) return ctx.reply("Usage: /simulate <what the other person wants>\ne.g. /simulate looking for a road bike");
    const simId = simSeq--;
    store.upsertUser({ id: simId, handle: `sim${-simId}`, name: "Simulated friend" });
    const intents = await distiller.distill({ agentId: `sim${-simId}`, persona: "a simulated friend", utterances: [text] });
    if (intents.length === 0) return ctx.reply("Couldn't distill an intent from that.");
    const stored = intents.map((i) => store.addIntent(simId, i));
    await ctx.reply(`🧪 Simulated friend posted: ${stored.map((s) => fmt(s.intent)).join("; ")}\nMatching…`);
    await rescan(stored.filter((s) => s.intent.active !== false));
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

    // Replying to a question relayed from a counterpart? Pass it straight back.
    const ans = awaitingAnswer.get(ctx.from.id);
    if (ans) {
      awaitingAnswer.delete(ctx.from.id);
      await bot.api.sendMessage(ans.asker, `💬 The other party replied: ${ctx.message.text}`);
      return ctx.reply("Passed it back. 👍");
    }

    // If they're answering a clarifying question, fold it into the message.
    let utterance = ctx.message.text;
    const clar = awaitingClarify.get(ctx.from.id);
    if (clar) {
      awaitingClarify.delete(ctx.from.id);
      utterance = `(Answering "${clar.question}") ${ctx.message.text}`;
    } else {
      // Otherwise, maybe it's a question to relay to a matched counterpart.
      const active = activeMatchOf(ctx.from.id);
      if (active) {
        const item = matchItem(active);
        const { action, question } = await distiller.route(ctx.message.text, `"${item}" with the other party`);
        if (action === "ask" && question.trim()) {
          await relayQuestion(ctx.from.id, active, item, question.trim());
          return;
        }
      }
    }

    await ctx.replyWithChatAction("typing");
    // Reconcile against the user's standing portfolio: a message can remove
    // (corrections/cancellations), update (price), or add — not only add.
    const existing = store.intentsOf(ctx.from.id).map((s) => ({
      id: s.id, kind: s.intent.kind, domain: s.intent.domain,
      tags: s.intent.publicTags ?? s.intent.tags,
      valuation: s.intent.valuation ?? null, active: s.intent.active !== false,
    }));
    const { removeIds, updates, adds } = await distiller.reconcile(existing, ctx.from.first_name ?? "a friend", utterance);

    for (const id of removeIds) store.removeIntent(id);
    for (const u of updates) store.updateIntent(u.id, u.valuation ?? undefined, u.active);
    const added = adds.map((i) => store.addIntent(ctx.from!.id, i));

    const lines: string[] = [];
    if (added.length) lines.push("Added:\n" + added.map((s) => "• " + fmt(s.intent) + (s.intent.active === false ? "  (holding)" : "")).join("\n"));
    if (updates.length) lines.push(`Updated ${updates.length} want${updates.length > 1 ? "s" : ""}.`);
    if (removeIds.length) lines.push(`Dropped ${removeIds.length} (correction/cancel).`);
    if (lines.length === 0) return ctx.reply("Noted — nothing changed. Tell me something you want to buy, sell, swap, or find.");
    await ctx.reply(lines.join("\n\n") + "\n\nBroadcasting a blur. I'll ping you on a match.");

    // Match the new intents; if nothing matched cleanly but a candidate is a
    // plausible-but-ambiguous match, ask the user one clarifying question.
    let matched = false;
    let bestClarify: { intentId: string; question: string; score: number } | undefined;
    for (const s of added.filter((x) => x.intent.active !== false)) {
      const { matches, clarifications } = await matchAgainstPool(s, store.pool());
      for (const hit of matches) { await propose(s, hit); matched = true; }
      for (const c of clarifications) {
        if (!bestClarify || c.score > bestClarify.score) bestClarify = { intentId: s.id, question: c.question, score: c.score };
      }
    }
    if (!matched && bestClarify) {
      awaitingClarify.set(ctx.from.id, { intentId: bestClarify.intentId, question: bestClarify.question });
      await ctx.reply(`🤔 Possible match — one detail first: ${bestClarify.question}`);
    }
  });

  async function rescan(intents: StoredIntent[]) {
    for (const s of intents) {
      if (s.intent.active === false) continue;
      const { matches } = await matchAgainstPool(s, store.pool());
      for (const hit of matches) await propose(s, hit);
    }
  }

  async function propose(a: StoredIntent, b: StoredIntent) {
    if (store.findMatch(a.intent.id, b.intent.id)) return;
    const m = store.addMatch(a.userId, b.userId, a.intent.id, b.intent.id);
    if (isSim(m.aUser)) m.aConsent = true; // sim auto-connects
    if (isSim(m.bUser)) m.bConsent = true;
    store.persist();
    const kb = (id: string) => new InlineKeyboard().text("Connect", `c:${id}:yes`).text("Pass", `c:${id}:no`);
    await notify(m.aUser, `🎯 Match — ${blurb(b.intent)}. Connect?`, { reply_markup: kb(m.id) });
    await notify(m.bUser, `🎯 Match — ${blurb(a.intent)}. Connect?`, { reply_markup: kb(m.id) });
    if (m.aConsent && m.bConsent && m.status === "proposed") await negotiate(m);
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

    m.price = price; m.status = "negotiating"; m.aApprove = false; m.bApprove = false;
    if (isSim(m.aUser)) m.aApprove = true; // sim auto-approves the proposal
    if (isSim(m.bUser)) m.bApprove = true;
    store.persist();
    const item = itemName(ai.kind === "offer" ? ai : bi);
    const kb = (id: string) => new InlineKeyboard()
      .text("Approve", `d:${id}:approve`).text("Revise", `d:${id}:revise`).text("Abort", `d:${id}:abort`);
    const msg = `💬 My agent negotiated: *${item}* for *€${price}*.\nApprove?`;
    await notify(m.aUser, msg, { parse_mode: "Markdown", reply_markup: kb(m.id) });
    await notify(m.bUser, msg, { parse_mode: "Markdown", reply_markup: kb(m.id) });
    if (m.aApprove && m.bApprove) await connect(m);
  }

  async function connect(m: Match) {
    m.status = "connected"; store.persist();
    const ua = store.user(m.aUser), ub = store.user(m.bUser);
    const terms = m.price != null ? ` at €${m.price}` : "";
    await notify(m.aUser, `🎉 Deal${terms}! You're connected with ${userLabel(ub)} — sort the details and meet up.`);
    await notify(m.bUser, `🎉 Deal${terms}! You're connected with ${userLabel(ua)} — sort the details and meet up.`);
  }

  // ── agent-to-agent question relay ──
  function activeMatchOf(uid: number): Match | undefined {
    const ms = store.matchesOf(uid).filter((m) => m.status === "proposed" || m.status === "negotiating" || m.status === "connected");
    return ms.at(-1);
  }
  function matchItem(m: Match): string {
    const a = store.intent(m.aIntent)?.intent, b = store.intent(m.bIntent)?.intent;
    const offer = a?.kind === "offer" ? a : b?.kind === "offer" ? b : a ?? b;
    return offer ? itemName(offer) : "the match";
  }
  async function relayQuestion(asker: number, m: Match, item: string, question: string) {
    const cp = other(m, asker);
    if (isSim(cp)) {
      await bot.api.sendMessage(asker, "Asked them — relaying…");
      await bot.api.sendMessage(asker, "💬 The other party replied: (simulated) yes, that works for me.");
      return;
    }
    awaitingAnswer.set(cp, { matchId: m.id, asker, question });
    await bot.api.sendMessage(cp, `🗣 The other party's agent asks about your "${item}" match:\n"${question}"\n\nReply and I'll pass it back.`);
    await bot.api.sendMessage(asker, "Asked them — I'll relay their answer.");
  }

  // Safety net: periodically surface dormant matches. Cached judges keep it cheap.
  setInterval(() => { rescan(store.pool()).catch((e) => console.error("rescan error:", e)); }, 3 * 60_000);

  bot.catch((err) => console.error("bot error:", err.error));
  return bot;
}
