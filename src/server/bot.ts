import { Bot, type Context, InlineKeyboard } from "grammy";
import { type PrivateIntent } from "../core/intent";
import { LLMDistiller } from "../intake/llmDistiller";
import { barterCycles, groupBuys, type Party } from "../multilateral/detect";
import { money } from "../core/currency";
import { buildAliases, proposeEdges, type ResidualIntent } from "../solver/helper";
import { matchAgainstPool } from "./commons";
import { logEvent } from "./eventlog";
import { type Lang, pickLang, STR } from "./i18n";
import { type Match, type MultiDeal, Store, type StoredIntent, type User } from "./store";

const article = (s: string) => (/^[aeiou]/i.test(s) ? "an" : "a");

/** Plain-language description of an intent in the OWNER's locale (their own
 *  price is safe to echo). Item tags stay canonical (English) for matching. */
const human = (i: PrivateIntent, lang: Lang): string => {
  const t = STR[lang];
  const item = (i.publicTags ?? i.tags).slice(0, 4).join(" ") || i.domain;
  const price = i.valuation != null ? ` (~${money(i.valuation)})` : "";
  const body = lang === "en" ? `${t.verb(i.kind)} ${article(item)} ${item}` : `${t.verb(i.kind)} ${item}`;
  return `${body}${price}`;
};

const blurb = (i: PrivateIntent, lang: Lang) =>
  `${STR[lang].someone} ${STR[lang].blurbVerb(i.kind)}: ${(i.publicTags ?? i.tags).join(", ")}`;
const itemName = (i: PrivateIntent) => (i.publicTags ?? i.tags).slice(0, 3).join(" ");
const userLabel = (u?: User) => (u?.handle ? `@${u.handle}` : u?.name ?? "your match");

export function createBot(token: string, store: Store): Bot {
  const bot = new Bot(token);
  const distiller = new LLMDistiller();
  const awaitingRevision = new Map<number, string>(); // userId -> matchId (transient)
  const awaitingClarify = new Map<number, { intentId: string; question: string }>();
  const awaitingAnswer = new Map<number, { matchId: string; asker: number; question: string }>();
  let simSeq = -1; // synthetic /simulate users get negative ids

  // Host (you) for /feedback forwarding: numeric MURMUR_HOST_ID, or captured the
  // first time the @MURMUR_HOST_HANDLE user messages the bot (Telegram can't DM
  // a user by @handle, only by numeric id).
  let hostId = Number(process.env.MURMUR_HOST_ID) || 0;
  const HOST_HANDLE = (process.env.MURMUR_HOST_HANDLE ?? "").replace(/^@/, "").toLowerCase();

  const remember = (u: { id: number; username?: string; first_name?: string; language_code?: string }) => {
    store.upsertUser({ id: u.id, handle: u.username, name: u.first_name, lang: u.language_code });
    if (HOST_HANDLE && u.username?.toLowerCase() === HOST_HANDLE) hostId = u.id;
  };
  const other = (m: Match, uid: number) => (uid === m.aUser ? m.bUser : m.aUser);
  const matchDomain = (m: Match) => m.domain ?? store.intent(m.aIntent)?.intent.domain ?? store.intent(m.bIntent)?.intent.domain ?? "";

  // Localisation: ctx replies in the sender's language; outbound notify() in the
  // recipient's stored language. Default English.
  const ctxT = (ctx: Context) => STR[pickLang(ctx.from?.language_code)];
  const langOf = (uid: number): Lang => pickLang(store.user(uid)?.lang);
  const tr = (uid: number) => STR[langOf(uid)];

  // Synthetic counterparts (from /simulate) have negative ids, no Telegram chat.
  const isSim = (uid: number) => uid < 0;
  const notify = async (uid: number, text: string, extra?: Parameters<typeof bot.api.sendMessage>[2]) => {
    if (isSim(uid)) return; // no real chat to message
    await bot.api.sendMessage(uid, text, extra);
  };

  // ── digest: batch match/deal proposals into one message per short window ──
  interface Pending { text: string; buttons: { label: string; data: string }[] }
  const pendingDigest = new Map<number, Pending[]>();
  const digestTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const DIGEST_MS = 8000;

  function enqueue(uid: number, p: Pending) {
    if (isSim(uid)) return;
    const q = pendingDigest.get(uid) ?? [];
    q.push(p);
    pendingDigest.set(uid, q);
    if (!digestTimers.has(uid)) digestTimers.set(uid, setTimeout(() => void flushDigest(uid), DIGEST_MS));
  }

  async function flushDigest(uid: number) {
    digestTimers.delete(uid);
    const q = pendingDigest.get(uid) ?? [];
    pendingDigest.delete(uid);
    if (q.length === 0) return;
    if (q.length === 1) {
      const p = q[0]!;
      const kb = new InlineKeyboard();
      for (const b of p.buttons) kb.text(b.label, b.data);
      await bot.api.sendMessage(uid, p.text, { reply_markup: kb });
      return;
    }
    const lines = q.map((p, i) => `${i + 1}. ${p.text}`).join("\n");
    const kb = new InlineKeyboard();
    q.forEach((p, i) => { for (const b of p.buttons) kb.text(`${i + 1} ${b.label}`, b.data); kb.row(); });
    await bot.api.sendMessage(uid, `${tr(uid).newCount(q.length)}\n${lines}`, { reply_markup: kb });
  }

  bot.command("start", (ctx) => { if (ctx.from) remember(ctx.from); return ctx.reply(ctxT(ctx).welcome, { parse_mode: "Markdown" }); });
  bot.command("help", (ctx) => { if (ctx.from) remember(ctx.from); return ctx.reply(ctxT(ctx).help, { parse_mode: "Markdown" }); });
  bot.command("me", (ctx) => {
    if (!ctx.from) return;
    remember(ctx.from);
    const t = ctxT(ctx), lang = pickLang(ctx.from.language_code);
    const list = store.intentsOf(ctx.from.id);
    if (!list.length) return ctx.reply(t.noWantsYet);
    const live = list.filter((s) => s.intent.active !== false);
    const held = list.filter((s) => s.intent.active === false);
    let msg = t.youAre(live.map((s) => human(s.intent, lang)).join("; "));
    if (held.length) msg += t.meHolding(held.map((s) => human(s.intent, lang)).join("; "));
    return ctx.reply(msg);
  });
  bot.command("clear", (ctx) => { if (!ctx.from) return; store.clearUser(ctx.from.id); return ctx.reply(ctxT(ctx).cleared); });
  bot.command("feedback", (ctx) => {
    if (!ctx.from) return;
    remember(ctx.from);
    const t = ctxT(ctx);
    const text = ctx.match.trim();
    if (!text) return ctx.reply(t.feedbackPrompt);
    logEvent("feedback", { user: ctx.from.id, handle: ctx.from.username, name: ctx.from.first_name, text });
    const who = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name ?? `user ${ctx.from.id}`;
    if (hostId && hostId !== ctx.from.id) {
      void bot.api.sendMessage(hostId, `📣 Feedback from ${who}:\n${text}`).catch(() => {});
    }
    return ctx.reply(t.feedbackThanks);
  });
  bot.command("pass", (ctx) => {
    if (!ctx.from) return;
    remember(ctx.from);
    const t = ctxT(ctx);
    const m = activeMatchOf(ctx.from.id);
    if (!m) return ctx.reply(t.noActiveMatch);
    m.status = "passed";
    store.dismiss(m.aUser, m.bUser, matchDomain(m));
    store.persist();
    logEvent("pass", { match: m.id, by: ctx.from.id, domain: matchDomain(m) });
    return ctx.reply(t.passed);
  });
  bot.command("status", (ctx) => {
    if (!ctx.from) return;
    remember(ctx.from);
    const lang = pickLang(ctx.from.language_code);
    const mine = store.intentsOf(ctx.from.id).filter((s) => s.intent.active !== false);
    const snap = store.snapshot();
    const realIntents = snap.intents.filter((i) => i.userId >= 0);
    const people = new Set(realIntents.map((i) => i.userId)).size;
    const myMatches = snap.matches.filter((m) => m.aUser === ctx.from!.id || m.bUser === ctx.from!.id);
    const deals = myMatches.filter((m) => m.status === "connected").length;
    const mineStr = mine.map((s) => "• " + human(s.intent, lang)).join("\n") || "-";
    return ctx.reply(STR[lang].status(mineStr, realIntents.length, people, myMatches.length, deals));
  });
  bot.command("rematch", async (ctx) => {
    if (!ctx.from) return;
    const t = ctxT(ctx);
    await ctx.reply(t.rematching);
    await settle();
    await ctx.reply(t.rematchDone);
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
    await ctx.reply(`🧪 Simulated friend is ${stored.map((s) => human(s.intent, pickLang(ctx.from!.language_code))).join("; ")}.\nMatching…`);
    await settle();
  });

  // ── buttons: c = connect/pass on a match, d = approve/revise/abort on a proposal ──
  bot.on("callback_query:data", async (ctx) => {
    const [tag, matchId, decision] = (ctx.callbackQuery.data ?? "").split(":");
    if (!ctx.from) return ctx.answerCallbackQuery();
    if (tag === "g") { await handleMultiVote(ctx, matchId, decision); return; }

    const m = matchId ? store.match(matchId) : undefined;
    const t = ctxT(ctx);
    if (!m) return ctx.answerCallbackQuery();
    const side = ctx.from.id === m.aUser ? "a" : ctx.from.id === m.bUser ? "b" : null;
    if (!side) return ctx.answerCallbackQuery();

    if (tag === "c") {
      if (decision === "no") { m.status = "passed"; store.dismiss(m.aUser, m.bUser, matchDomain(m)); store.persist(); logEvent("pass", { match: m.id, by: ctx.from.id, domain: matchDomain(m) }); await ctx.editMessageText(t.noWorriesPassed); return ctx.answerCallbackQuery(); }
      if (side === "a") m.aConsent = true; else m.bConsent = true;
      store.persist();
      await ctx.editMessageText(t.interested);
      await ctx.answerCallbackQuery();
      if (m.aConsent && m.bConsent && m.status === "proposed") await negotiate(m);
      return;
    }

    if (tag === "d") {
      if (m.status !== "negotiating") return ctx.answerCallbackQuery();
      if (decision === "abort") {
        m.status = "passed"; store.dismiss(m.aUser, m.bUser, matchDomain(m)); store.persist();
        await ctx.editMessageText(t.aborted);
        await notify(other(m, ctx.from.id), tr(other(m, ctx.from.id)).otherAborted);
        return ctx.answerCallbackQuery();
      }
      if (decision === "revise") {
        awaitingRevision.set(ctx.from.id, m.id);
        await ctx.editMessageText(t.reviseAsk);
        return ctx.answerCallbackQuery();
      }
      // approve
      if (side === "a") m.aApprove = true; else m.bApprove = true;
      store.persist();
      await ctx.editMessageText(t.approved(m.price!));
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
    const t = ctxT(ctx), lang = pickLang(ctx.from.language_code);

    // A revision number for a pending proposal?
    const pending = awaitingRevision.get(ctx.from.id);
    if (pending) {
      awaitingRevision.delete(ctx.from.id);
      const m = store.match(pending);
      const num = Number.parseInt(ctx.message.text.replace(/[^0-9]/g, ""), 10);
      if (!m || !Number.isFinite(num)) return ctx.reply(t.cantReadNumber);
      const mine = store.intent(ctx.from.id === m.aUser ? m.aIntent : m.bIntent);
      if (mine) { mine.intent.valuation = num; store.persist(); }
      await ctx.reply(t.renegotiating(num));
      m.status = "proposed"; m.aApprove = false; m.bApprove = false; store.persist();
      await negotiate(m);
      return;
    }

    // Replying to a question relayed from a counterpart? Pass it straight back.
    const ans = awaitingAnswer.get(ctx.from.id);
    if (ans) {
      awaitingAnswer.delete(ctx.from.id);
      await notify(ans.asker, tr(ans.asker).otherReplied(ctx.message.text));
      await ctx.reply(t.passedItBack);
      await refineFromAnswer(ctx.from.id, ans.question, ctx.message.text); // sharpen the broadcast
      return;
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
    // (corrections/cancellations), update (price), or add - not only add.
    const existing = store.intentsOf(ctx.from.id).map((s) => ({
      id: s.id, kind: s.intent.kind, domain: s.intent.domain,
      tags: s.intent.publicTags ?? s.intent.tags,
      valuation: s.intent.valuation ?? null, active: s.intent.active !== false,
    }));
    const { removeIds, updates, adds } = await distiller.reconcile(existing, ctx.from.first_name ?? "a friend", utterance);

    for (const id of removeIds) store.removeIntent(id);
    for (const u of updates) store.updateIntent(u.id, u.valuation ?? undefined, u.active);
    const added = adds.map((i) => store.addIntent(ctx.from!.id, i));
    logEvent("intake", {
      user: ctx.from.id, text: utterance,
      added: added.map((s) => ({ kind: s.intent.kind, domain: s.intent.domain, tags: s.intent.publicTags ?? s.intent.tags, active: s.intent.active !== false })),
      updated: updates.length, removed: removeIds.length,
    });

    const lines: string[] = [];
    const broadcast = added.filter((s) => s.intent.active !== false);
    if (broadcast.length) lines.push(t.gotIt(broadcast.map((s) => human(s.intent, lang)).join("; ")));
    const holding = added.filter((s) => s.intent.active === false);
    if (holding.length) lines.push(t.holding(holding.map((s) => human(s.intent, lang)).join("; ")));
    if (updates.length) lines.push(t.updated(updates.length));
    if (removeIds.length) lines.push(t.dropped(removeIds.length));
    if (lines.length === 0) return ctx.reply(t.nothingChanged);
    if (broadcast.length) lines.push(t.broadcasting);
    await ctx.reply(lines.join("\n\n"));

    // Global batch settlement decides + proposes matches/group-buys/rings.
    await settle();
    // If a fresh intent still found no match but a plausible one exists, ask once.
    const inMatch = (id: string) => store.matchesOf(ctx.from!.id).some((m) => m.aIntent === id || m.bIntent === id);
    let bestClarify: { intentId: string; question: string; score: number } | undefined;
    for (const s of added.filter((x) => x.intent.active !== false)) {
      if (inMatch(s.id)) continue;
      const { clarifications } = await matchAgainstPool(s, store.pool());
      for (const c of clarifications) {
        if (!bestClarify || c.score > bestClarify.score) bestClarify = { intentId: s.id, question: c.question, score: c.score };
      }
    }
    if (bestClarify) {
      awaitingClarify.set(ctx.from.id, { intentId: bestClarify.intentId, question: bestClarify.question });
      await ctx.reply(t.clarify(bestClarify.question));
    }
  });

  const irOk = (seek: PrivateIntent, offer: PrivateIntent) => {
    const buyerCeil = Math.min(seek.valuation ?? Infinity, seek.fallback ?? Infinity);
    const sellerFloor = Math.max(offer.valuation ?? 0, offer.fallback ?? 0);
    return buyerCeil >= sellerFloor; // a feasible, IR-respecting price exists
  };
  const edgeSurplus = (s: PrivateIntent, o: PrivateIntent) =>
    s.valuation != null && o.valuation != null ? Math.max(0, s.valuation - o.valuation) : 0;

  /** Batch settlement (the solver, live): build commerce edges with the SEMANTIC
   *  matcher, gate by IR (fallback), then a coverage allocation (most-constrained
   *  seeker first, qty-aware) decides who clears - then group-buys + barter rings.
   *  Replaces greedy per-pair proposing with a global, IR-respecting allocation. */
  async function settle() {
    const active = store.pool().filter((s) => s.intent.active !== false);
    const offers = active.filter((s) => s.intent.kind === "offer");
    type Edge = { seek: StoredIntent; offer: StoredIntent; surplus: number };
    const bySeek = new Map<string, Edge[]>();
    for (const s of active.filter((x) => x.intent.kind === "seek")) {
      const { matches } = await matchAgainstPool(s, store.pool());
      const es = matches
        .filter((o) => o.intent.kind === "offer" && irOk(s.intent, o.intent))
        .map((o) => ({ seek: s, offer: o, surplus: edgeSurplus(s.intent, o.intent) }));
      if (es.length) bySeek.set(s.id, es);
    }
    const cap = new Map(offers.map((o) => [o.id, o.intent.qty ?? 1]));
    for (const sid of [...bySeek.keys()].sort((a, b) => bySeek.get(a)!.length - bySeek.get(b)!.length)) {
      const opts = bySeek.get(sid)!.filter((e) => (cap.get(e.offer.id) ?? 0) > 0).sort((a, b) => b.surplus - a.surplus);
      if (opts.length === 0) continue;
      const e = opts[0]!;
      cap.set(e.offer.id, (cap.get(e.offer.id) ?? 0) - 1);
      await propose(e.seek, e.offer);
    }
    await scanMultiDeals();
  }

  /** A relayed answer often carries new detail ("yes, it's the OLED 256gb").
   *  Feed it back through reconcile to SHARPEN the answerer's broadcast, then
   *  re-settle - the agent negotiates *understanding*, the solver handles price. */
  async function refineFromAnswer(userId: number, question: string, answer: string) {
    const existing = store.intentsOf(userId).map((s) => ({
      id: s.id, kind: s.intent.kind, domain: s.intent.domain,
      tags: s.intent.publicTags ?? s.intent.tags,
      valuation: s.intent.valuation ?? null, active: s.intent.active !== false,
    }));
    if (existing.length === 0) return;
    const msg = `(Refining my own listing from a clarification) Someone asked me: "${question}". I answered: "${answer}". If this adds concrete detail to one of my items, update or replace that item; otherwise change nothing.`;
    const { removeIds, updates, adds } = await distiller.reconcile(existing, "the user", msg);
    if (removeIds.length === 0 && updates.length === 0 && adds.length === 0) return;
    for (const id of removeIds) store.removeIntent(id);
    for (const u of updates) store.updateIntent(u.id, u.valuation ?? undefined, u.active);
    adds.forEach((i) => store.addIntent(userId, i));
    await bot.api.sendMessage(userId, "✏️ I sharpened your listing with that detail and re-checked for matches.");
    await settle();
  }

  async function propose(a: StoredIntent, b: StoredIntent) {
    if (store.isDismissed(a.userId, b.userId, a.intent.domain)) return; // already passed/dealt - don't re-suggest
    if (store.findMatch(a.intent.id, b.intent.id)) return;
    const m = store.addMatch(a.userId, b.userId, a.intent.id, b.intent.id, a.intent.domain);
    if (isSim(m.aUser)) m.aConsent = true; // sim auto-connects
    if (isSim(m.bUser)) m.bConsent = true;
    store.persist();
    logEvent("match_proposed", { match: m.id, a: a.userId, b: b.userId, domain: a.intent.domain, item: itemName(b.intent) });
    const connectBtns = (id: string, tt: typeof STR[Lang]) => [{ label: tt.btnConnect, data: `c:${id}:yes` }, { label: tt.btnPass, data: `c:${id}:no` }];
    const ta = tr(m.aUser), tb = tr(m.bUser);
    enqueue(m.aUser, { text: ta.matchLine(blurb(b.intent, langOf(m.aUser))), buttons: connectBtns(m.id, ta) });
    enqueue(m.bUser, { text: tb.matchLine(blurb(a.intent, langOf(m.bUser))), buttons: connectBtns(m.id, tb) });
    if (m.aConsent && m.bConsent && m.status === "proposed") await negotiate(m);
  }

  /** Agents propose a price from the private reserves, then gate on both sides. */
  async function negotiate(m: Match) {
    const ai = store.intent(m.aIntent)?.intent;
    const bi = store.intent(m.bIntent)?.intent;
    if (!ai || !bi) return;

    const buyerI = ai.kind === "seek" ? ai : bi.kind === "seek" ? bi : null;
    const sellerI = ai.kind === "offer" ? ai : bi.kind === "offer" ? bi : null;

    let price: number | null = null;
    if (buyerI?.valuation != null && sellerI?.valuation != null) {
      // IR-aware fair price: midpoint of the fallback-bounded zone of agreement.
      // (Research showed LLM haggling is worse than this on price - see src/research/bargaining.ts.)
      const floor = Math.max(sellerI.valuation, sellerI.fallback ?? 0);
      const ceil = Math.min(buyerI.valuation, buyerI.fallback ?? Infinity);
      if (ceil < floor) { await connect(m); return; } // no agreeable price after fallbacks
      price = Math.round((floor + ceil) / 2);
    } else {
      price = sellerI?.valuation ?? buyerI?.valuation ?? null; // one-sided / unpriced
    }
    if (price == null) { await connect(m); return; } // swap / no price → just connect

    m.price = price; m.status = "negotiating"; m.aApprove = false; m.bApprove = false;
    if (isSim(m.aUser)) m.aApprove = true; // sim auto-approves the proposal
    if (isSim(m.bUser)) m.bApprove = true;
    store.persist();
    const item = itemName(ai.kind === "offer" ? ai : bi);
    const kb = (id: string, tt: typeof STR[Lang]) => new InlineKeyboard()
      .text(tt.btnApprove, `d:${id}:approve`).text(tt.btnRevise, `d:${id}:revise`).text(tt.btnAbort, `d:${id}:abort`);
    for (const uid of [m.aUser, m.bUser]) {
      const tt = tr(uid);
      await notify(uid, tt.priceMsg(price, item), { parse_mode: "Markdown", reply_markup: kb(m.id, tt) });
    }
    if (m.aApprove && m.bApprove) await connect(m);
  }

  async function connect(m: Match) {
    m.status = "connected"; store.dismiss(m.aUser, m.bUser, matchDomain(m)); store.persist();
    logEvent("deal", { match: m.id, a: m.aUser, b: m.bUser, domain: matchDomain(m), price: m.price ?? null });
    const ua = store.user(m.aUser), ub = store.user(m.bUser);
    await notify(m.aUser, tr(m.aUser).dealMsg(userLabel(ub), m.price ?? null));
    await notify(m.bUser, tr(m.bUser).dealMsg(userLabel(ua), m.price ?? null));
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
  const escalations = new Map<string, number[]>(); // matchId -> escalation timestamps
  const underRateLimit = (matchId: string) => {
    const now = Date.now();
    const ts = (escalations.get(matchId) ?? []).filter((t) => t > now - 10 * 60_000);
    escalations.set(matchId, ts);
    if (ts.length >= 2) return false; // max 2 human escalations / 10 min / match
    ts.push(now);
    return true;
  };

  /** The counterpart's agent acts as a BUFFER: answer from what it knows, and
   *  only escalate to the human when it must (rate-limited). */
  async function relayQuestion(asker: number, m: Match, item: string, question: string) {
    const cp = other(m, asker);
    const ci = (m.aUser === cp ? store.intent(m.aIntent) : store.intent(m.bIntent))?.intent;
    const context = ci
      ? `wants to ${ci.kind === "seek" ? "buy" : ci.kind === "offer" ? "sell" : ci.kind} ${(ci.publicTags ?? ci.tags).join(", ")}${ci.valuation != null ? ` (around ${money(ci.valuation)})` : ""}`
      : item;

    const tAsk = tr(asker);
    if (isSim(cp)) {
      await notify(asker, tAsk.theirAgentSaid("yes, that works (simulated)."));
      return;
    }

    const { answer, escalate } = await distiller.answer(question, context);
    if (!escalate && answer.trim()) {
      await notify(asker, tAsk.theirAgentSaid(answer.trim()));
      return;
    }
    if (!underRateLimit(m.id)) {
      await notify(asker, tAsk.agentHandling);
      return;
    }
    awaitingAnswer.set(cp, { matchId: m.id, asker, question });
    await notify(cp, tr(cp).questionNeedsYou(item, question));
    await notify(asker, tAsk.goodQuestion);
  }

  // ── multilateral: group-buys and barter rings ──
  async function scanMultiDeals() {
    const active = store.pool().filter((s) => s.intent.active !== false);
    const parties: Party[] = active.map((s) => ({ id: s.id, intent: s.intent }));
    const userOf = new Map(active.map((s) => [s.id, s.userId]));

    const proposeGroup = async (g: ReturnType<typeof groupBuys>[number]) => {
      const recs = [g.offer, ...g.buyers].map((p) => ({ userId: userOf.get(p.id)!, intentId: p.id }));
      const uids = recs.map((r) => r.userId);
      if (new Set(uids).size < 3) return; // anchor + ≥2 distinct buyers
      if (store.findMultiByParties("group", uids)) return;
      await proposeMulti(store.addMultiDeal("group", g.offer.intent.domain, recs, g.qty));
    };
    const proposeRing = async (r: { members: Party[] }) => {
      if (r.members.length < 3) return; // 2-cycles are pairwise swaps
      const recs = r.members.map((p) => ({ userId: userOf.get(p.id)!, intentId: p.id }));
      const uids = recs.map((rr) => rr.userId);
      if (new Set(uids).size < r.members.length) return;
      if (store.findMultiByParties("ring", uids)) return;
      await proposeMulti(store.addMultiDeal("ring", "swap", recs, 1));
    };

    // pass 1: lexical detectors over the real pool
    for (const g of groupBuys(parties)) await proposeGroup(g);
    for (const r of barterCycles(parties)) await proposeRing(r);

    // pass 2 (failover): an LLM emits fuzzy equivalences ("ps5"≈"games console")
    // the keyword detectors miss; re-run them over the token-augmented pool so a
    // ring/group can close across representation drift. Same human vote gates it.
    try {
      const aug = await augmentPool(active);
      if (aug) {
        for (const g of groupBuys(aug)) await proposeGroup(g);
        for (const r of barterCycles(aug)) await proposeRing(r);
      }
    } catch (e) {
      console.error("[helper failover]", e); // never let recall break settle
    }
  }

  /** Build a token-augmented copy of the pool: ask the LLM for fuzzy edges over
   *  the residual, collapse each equivalence class to one canonical token. The
   *  augmented parties keep the SAME intent ids, so MultiDeals stay readable. */
  async function augmentPool(active: StoredIntent[]): Promise<Party[] | null> {
    if (active.length < 3) return null;
    const residual: ResidualIntent[] = active.map((s) => ({
      id: s.id, who: String(s.userId), kind: s.intent.kind,
      item: (s.intent.publicTags ?? s.intent.tags).join(" "),
      have: s.intent.have ?? [], want: s.intent.want ?? [],
    }));
    const edges = await proposeEdges(residual);
    if (edges.length === 0) return null;
    const { canon } = buildAliases(edges);
    return active.map((s) => {
      const tags = (s.intent.publicTags ?? s.intent.tags).map(canon);
      return { id: s.id, intent: { ...s.intent, tags, publicTags: tags, have: (s.intent.have ?? []).map(canon), want: (s.intent.want ?? []).map(canon) } };
    });
  }

  function describeFor(deal: MultiDeal, userId: number): string {
    const t = tr(userId);
    if (deal.mode === "ring") {
      const me = store.intent(deal.parties.find((p) => p.userId === userId)!.intentId)?.intent;
      return t.ringLeg((me?.have ?? []).join("+"), (me?.want ?? []).join("+"));
    }
    const anchorIntent = store.intent(deal.parties[0]!.intentId)?.intent;
    const item = anchorIntent ? itemName(anchorIntent) : "the item";
    const buyers = deal.parties.length - 1;
    return userId === deal.parties[0]!.userId ? t.groupAnchorAsk(buyers, item) : t.groupForming(item, buyers);
  }

  async function proposeMulti(deal: MultiDeal) {
    for (const p of deal.parties) {
      if (isSim(p.userId)) { if (!deal.approvals.includes(p.userId)) deal.approvals.push(p.userId); continue; }
      const t = tr(p.userId);
      const head = deal.mode === "ring" ? t.ringHead(deal.parties.length) : t.groupHead;
      const approveBtns = [{ label: t.btnApprove, data: `g:${deal.id}:approve` }, { label: t.btnPass, data: `g:${deal.id}:pass` }];
      enqueue(p.userId, { text: `${head} - ${describeFor(deal, p.userId)}`, buttons: approveBtns });
    }
    store.persist();
    await maybeSettle(deal);
  }

  async function handleMultiVote(ctx: Context, dealId: string | undefined, decision: string | undefined) {
    const deal = dealId ? store.multiDeal(dealId) : undefined;
    if (!deal || deal.status !== "proposed") return void ctx.answerCallbackQuery();
    const uid = ctx.from!.id;
    if (!deal.parties.some((p) => p.userId === uid)) return void ctx.answerCallbackQuery();
    if (decision === "pass") { if (!deal.declines.includes(uid)) deal.declines.push(uid); }
    else if (!deal.approvals.includes(uid)) deal.approvals.push(uid);
    store.persist();
    await ctx.editMessageText(decision === "pass" ? ctxT(ctx).multiPassed : ctxT(ctx).multiApproved);
    await ctx.answerCallbackQuery();
    await maybeSettle(deal);
  }

  async function maybeSettle(deal: MultiDeal) {
    if (deal.status !== "proposed") return;
    const responded = new Set([...deal.approvals, ...deal.declines]);
    if (deal.parties.some((p) => !responded.has(p.userId))) return; // wait for everyone

    if (deal.mode === "ring") {
      if (deal.parties.every((p) => deal.approvals.includes(p.userId))) await settleRing(deal);
      else deal.status = "failed", store.persist();
      return;
    }
    const anchor = deal.parties[0]!;
    const buyers = deal.parties.slice(1).filter((p) => deal.approvals.includes(p.userId)).slice(0, deal.qty);
    if (deal.approvals.includes(anchor.userId) && buyers.length >= 1) await settleGroup(deal, anchor, buyers);
    else deal.status = "failed", store.persist();
  }

  async function settleRing(deal: MultiDeal) {
    deal.status = "settled"; store.persist();
    const n = deal.parties.length;
    for (let k = 0; k < n; k++) {
      const me = deal.parties[k]!;
      const giver = deal.parties[(k + 1) % n]!; // I receive what I want from the next
      const receiver = deal.parties[(k - 1 + n) % n]!; // I give what I have to the previous
      const mi = store.intent(me.intentId)?.intent;
      await notify(me.userId, tr(me.userId).ringSettled(
        (mi?.have ?? []).join("+"), userLabel(store.user(receiver.userId)),
        (mi?.want ?? []).join("+"), userLabel(store.user(giver.userId))));
    }
  }

  async function settleGroup(deal: MultiDeal, anchor: { userId: number }, buyers: { userId: number }[]) {
    deal.status = "settled"; store.persist();
    const item = (() => { const ai = store.intent(deal.parties[0]!.intentId)?.intent; return ai ? itemName(ai) : "your item"; })();
    await notify(anchor.userId, tr(anchor.userId).groupAnchorSettled(item, buyers.map((b) => userLabel(store.user(b.userId))).join(", ")));
    for (const b of buyers) {
      await notify(b.userId, tr(b.userId).groupBuyerSettled(userLabel(store.user(anchor.userId)), item, buyers.length - 1));
    }
  }

  // Safety net: periodically re-run the batch settlement (surfaces dormant
  // matches, group-buys, and rings). Cached judges keep it cheap.
  setInterval(() => { settle().catch((e) => console.error("settle error:", e)); }, 3 * 60_000);

  // Launch-grade safety net: any unhandled throw (an LLM/API hiccup, a network
  // blip) becomes a friendly message instead of silence or a stuck button.
  bot.catch(async (err) => {
    console.error("bot error:", err.error);
    try {
      if (err.ctx.callbackQuery) await err.ctx.answerCallbackQuery().catch(() => {});
      await err.ctx.reply(ctxT(err.ctx).hiccup);
    } catch (e) {
      console.error("bot.catch: could not notify user:", e);
    }
  });
  return bot;
}
