import { money } from "../core/currency";

/**
 * Tiny per-recipient localisation. Pilot ships en + fr; add a locale by adding
 * one entry to STR. Item tags stay in their canonical (English) form for
 * matching, so they may appear in a localised sentence - fine for a pilot.
 */
export type Lang = "en" | "fr";

export const pickLang = (code?: string): Lang => (code?.toLowerCase().startsWith("fr") ? "fr" : "en");

interface Strings {
  welcome: string;
  help: string;
  // intake
  gotIt: (items: string) => string;
  holding: (items: string) => string;
  broadcasting: string;
  updated: (n: number) => string;
  dropped: (n: number) => string;
  nothingChanged: string;
  clarify: (q: string) => string;
  // /me, /status, /clear, /pass
  noWantsYet: string;
  youAre: (live: string) => string;
  meHolding: (held: string) => string;
  cleared: string;
  noActiveMatch: string;
  passed: string;
  status: (mine: string, n: number, people: number, matches: number, deals: number) => string;
  rematching: string;
  rematchDone: string;
  // feedback
  feedbackPrompt: string;
  feedbackThanks: string;
  // matching / negotiation / deal
  matchLine: (blurb: string) => string;
  interested: string;
  noWorriesPassed: string;
  priceMsg: (price: number, item: string) => string;
  approved: (price: number) => string;
  waitingOther: string;
  aborted: string;
  otherAborted: string;
  reviseAsk: string;
  renegotiating: (n: number) => string;
  cantReadNumber: string;
  dealMsg: (label: string, price: number | null) => string;
  // relay
  theirAgentSaid: (a: string) => string;
  passedItBack: string;
  otherReplied: (t: string) => string;
  goodQuestion: string;
  questionNeedsYou: (item: string, q: string) => string;
  agentHandling: string;
  // errors / buttons
  newCount: (n: number) => string;
  hiccup: string;
  btnConnect: string;
  btnPass: string;
  btnApprove: string;
  btnRevise: string;
  btnAbort: string;
  // multilateral (group-buys & barter rings)
  ringHead: (n: number) => string;
  groupHead: string;
  ringLeg: (give: string, get: string) => string;
  groupAnchorAsk: (buyers: number, item: string) => string;
  groupForming: (item: string, buyers: number) => string;
  multiPassed: string;
  multiApproved: string;
  ringSettled: (give: string, to: string, get: string, from: string) => string;
  groupAnchorSettled: (item: string, buyers: string) => string;
  groupBuyerSettled: (anchor: string, item: string, others: number) => string;
  // human() verbs, blurb verbs
  someone: string;
  verb: (kind: string) => string;
  blurbVerb: (kind: string) => string;
}

const en: Strings = {
  welcome:
    "👋 I'm your murmur agent.\n\n" +
    "Tell me what you want in plain words - to *buy*, *sell*, *swap*, or *find* - and I'll hold it " +
    "quietly and ping you when someone in the group is a match.\n\n" +
    "Try things like:\n" +
    "• selling my road bike, around 200, around till Sunday\n" +
    "• looking for a cheap monitor under 80\n" +
    "• swap my breadmaker for a blender\n" +
    "• anyone got a drill I could borrow this weekend?\n\n" +
    "I only ever broadcast a *blur* - category + tags, never your price, name, or address. " +
    "(Pilot note: the host can see everything; peers only see the blur.)\n\n" +
    "/help anytime to see what I can do.",
  help:
    "Just message me what you want, in plain words - buy, sell, swap, lend, or find. " +
    "Change your mind any time (\"actually 150\", \"never mind the bike\") and I'll update.\n\n" +
    "*Commands*\n/me - your current wants\n/status - what's in the pool\n" +
    "/pass - skip the match I just suggested\n/clear - forget all my wants\n" +
    "/feedback <message> - send the host a note\n/help - this message",
  gotIt: (i) => `Got it - you're ${i}.`,
  holding: (i) => `Holding (too vague to broadcast yet): ${i}.`,
  broadcasting: "I'll broadcast a blur (no price or name) and ping you on a match.",
  updated: (n) => `Updated ${n} want${n > 1 ? "s" : ""}.`,
  dropped: (n) => `Dropped ${n} (correction/cancel).`,
  nothingChanged: "Noted - nothing changed. Tell me something you want to buy, sell, swap, or find.",
  clarify: (q) => `🤔 Possible match - one detail first: ${q}`,
  noWantsYet: "No wants yet - just tell me one, like \"selling my old desk for 30\".",
  youAre: (l) => `You're ${l}.`,
  meHolding: (h) => `\n\nHolding (not broadcast yet): ${h}.`,
  cleared: "Cleared - you have no active wants now.",
  noActiveMatch: "No active match to pass on.",
  passed: "Got it - I won't suggest that match again.",
  status: (mine, n, people, matches, deals) =>
    `Your live wants:\n${mine}\n\nPool: ${n} wants from ${people} ${people === 1 ? "person" : "people"}.\n` +
    `Your matches: ${matches}${deals ? ` (${deals} deal${deals === 1 ? "" : "s"})` : ""}.`,
  rematching: "Rescanning the pool for matches…",
  rematchDone: "Done - I've pinged you about any new matches.",
  feedbackPrompt: "Tell me what's on your mind, like:\n/feedback it keeps suggesting bikes I don't want 😅",
  feedbackThanks: "🙏 Thanks - sent your feedback to the host.",
  matchLine: (b) => `🎯 Match - ${b}`,
  interested: "👍 Interested - waiting for the other side…",
  noWorriesPassed: "No worries - passed. I won't suggest this again.",
  priceMsg: (p, item) => `💬 Fair price worked out: *${money(p)}* for *${item}*.\nApprove?`,
  approved: (p) => `✅ Approved ${money(p)}. Waiting for the other side…`,
  waitingOther: "Waiting for the other side…",
  aborted: "Aborted.",
  otherAborted: "The other side aborted the deal.",
  reviseAsk: "Send me your number (the most you'd pay / least you'd accept) and I'll renegotiate.",
  renegotiating: (n) => `Got it - renegotiating around ${money(n)}.`,
  cantReadNumber: "Couldn't read a number - just re-state your want if you like.",
  dealMsg: (label, price) => `🎉 Deal${price != null ? ` at ${money(price)}` : ""}! You're connected with ${label} - sort the details and meet up.`,
  theirAgentSaid: (a) => `💬 Their agent: ${a}`,
  passedItBack: "Passed it back. 👍",
  otherReplied: (t) => `💬 The other party replied: ${t}`,
  goodQuestion: "Good question - checking with them directly.",
  questionNeedsYou: (item, q) => `🗣 A question about your "${item}" match needs you:\n"${q}"\n\nReply and I'll pass it back.`,
  agentHandling: "Their agent is handling a few questions - it'll follow up shortly.",
  newCount: (n) => `🔔 ${n} new:`,
  hiccup: "⚠️ Something hiccuped on my end - mind trying that again in a moment?",
  btnConnect: "Connect", btnPass: "Pass", btnApprove: "Approve", btnRevise: "Revise", btnAbort: "Abort",
  ringHead: (n) => `🔄 ${n}-way barter ring`,
  groupHead: "🛒 Group buy forming",
  ringLeg: (give, get) => `You give ${give} and receive ${get}.`,
  groupAnchorAsk: (buyers, item) => `${buyers} people want your ${item} - settle as a batch?`,
  groupForming: (item, buyers) => `A group buy is forming for ${item} (${buyers} buyers).`,
  multiPassed: "Passed.",
  multiApproved: "👍 Approved - waiting for the others…",
  ringSettled: (give, to, get, from) => `🎉 Ring settled! Give ${give} to ${to}, receive ${get} from ${from}.`,
  groupAnchorSettled: (item, buyers) => `🎉 Group deal! Selling your ${item} to: ${buyers}.`,
  groupBuyerSettled: (anchor, item, others) => `🎉 You're in the group buy with ${anchor} for ${item}${others ? ` (+${others} other buyer${others > 1 ? "s" : ""})` : ""}.`,
  someone: "someone",
  verb: (k) => (k === "seek" ? "looking for" : k === "offer" ? "offering" : k === "swap" ? "swapping" : "bartering"),
  blurbVerb: (k) => (k === "seek" ? "wants" : k === "offer" ? "is offering" : "wants to " + k),
};

const fr: Strings = {
  welcome:
    "👋 Je suis ton agent murmur.\n\n" +
    "Dis-moi ce que tu veux, en langage normal - *acheter*, *vendre*, *échanger* ou *trouver* - " +
    "et je le garde discrètement et te préviens quand quelqu'un du groupe correspond.\n\n" +
    "Essaie par exemple :\n" +
    "• je vends mon vélo de route, autour de 200, dispo jusqu'à dimanche\n" +
    "• je cherche un écran pas cher sous les 80\n" +
    "• j'échange ma machine à pain contre un blender\n" +
    "• quelqu'un aurait une perceuse à me prêter ce week-end ?\n\n" +
    "Je ne diffuse qu'un *flou* - catégorie + mots-clés, jamais ton prix, ton nom ou ton adresse. " +
    "(Note pilote : l'hôte voit tout ; les autres ne voient que le flou.)\n\n" +
    "/help à tout moment pour voir ce que je sais faire.",
  help:
    "Écris-moi simplement ce que tu veux - acheter, vendre, échanger, prêter ou trouver. " +
    "Change d'avis quand tu veux (\"en fait 150\", \"laisse tomber le vélo\") et je mets à jour.\n\n" +
    "*Commandes*\n/me - tes demandes actuelles\n/status - ce qu'il y a dans le pool\n" +
    "/pass - ignorer le match que je viens de proposer\n/clear - oublier toutes mes demandes\n" +
    "/feedback <message> - envoyer un mot à l'hôte\n/help - ce message",
  gotIt: (i) => `C'est noté - tu es en train de ${i}.`,
  holding: (i) => `Je garde de côté (trop vague pour diffuser) : ${i}.`,
  broadcasting: "Je diffuse un flou (sans prix ni nom) et je te préviens en cas de match.",
  updated: (n) => `${n} demande${n > 1 ? "s" : ""} mise${n > 1 ? "s" : ""} à jour.`,
  dropped: (n) => `${n} retirée${n > 1 ? "s" : ""} (correction/annulation).`,
  nothingChanged: "Noté - rien n'a changé. Dis-moi quelque chose à acheter, vendre, échanger ou trouver.",
  clarify: (q) => `🤔 Match possible - juste un détail d'abord : ${q}`,
  noWantsYet: "Aucune demande pour l'instant - dis-m'en une, genre \"je vends mon vieux bureau pour 30\".",
  youAre: (l) => `Tu es en train de ${l}.`,
  meHolding: (h) => `\n\nEn attente (pas encore diffusé) : ${h}.`,
  cleared: "C'est effacé - tu n'as plus aucune demande active.",
  noActiveMatch: "Aucun match actif à ignorer.",
  passed: "Noté - je ne te reproposerai pas ce match.",
  status: (mine, n, people, matches, deals) =>
    `Tes demandes actives :\n${mine}\n\nPool : ${n} demandes de ${people} personne${people === 1 ? "" : "s"}.\n` +
    `Tes matchs : ${matches}${deals ? ` (${deals} deal${deals === 1 ? "" : "s"})` : ""}.`,
  rematching: "Je rescanne le pool…",
  rematchDone: "Fait - je t'ai prévenu s'il y a de nouveaux matchs.",
  feedbackPrompt: "Dis-moi ce que tu en penses, par exemple :\n/feedback il me propose des vélos que je ne veux pas 😅",
  feedbackThanks: "🙏 Merci - j'ai transmis ton retour à l'hôte.",
  matchLine: (b) => `🎯 Match - ${b}`,
  interested: "👍 Intéressé(e) - j'attends l'autre côté…",
  noWorriesPassed: "Pas de souci - ignoré. Je ne te le reproposerai pas.",
  priceMsg: (p, item) => `💬 Prix juste calculé : *${money(p)}* pour *${item}*.\nTu valides ?`,
  approved: (p) => `✅ Validé à ${money(p)}. J'attends l'autre côté…`,
  waitingOther: "J'attends l'autre côté…",
  aborted: "Annulé.",
  otherAborted: "L'autre côté a annulé le deal.",
  reviseAsk: "Envoie-moi ton chiffre (le max que tu paierais / le min que tu accepterais) et je renégocie.",
  renegotiating: (n) => `Noté - je renégocie autour de ${money(n)}.`,
  cantReadNumber: "Je n'ai pas lu de chiffre - réécris ta demande si tu veux.",
  dealMsg: (label, price) => `🎉 Deal${price != null ? ` à ${money(price)}` : ""} ! Tu es en contact avec ${label} - réglez les détails et retrouvez-vous.`,
  theirAgentSaid: (a) => `💬 Son agent : ${a}`,
  passedItBack: "Transmis. 👍",
  otherReplied: (t) => `💬 L'autre personne a répondu : ${t}`,
  goodQuestion: "Bonne question - je vérifie directement avec elleux.",
  questionNeedsYou: (item, q) => `🗣 Une question sur ton match "${item}" a besoin de toi :\n"${q}"\n\nRéponds et je la transmets.`,
  agentHandling: "Son agent gère quelques questions - il revient vers toi bientôt.",
  newCount: (n) => `🔔 ${n} nouveau${n > 1 ? "x" : ""} :`,
  hiccup: "⚠️ Petit bug de mon côté - tu peux réessayer dans un instant ?",
  btnConnect: "Se connecter", btnPass: "Passer", btnApprove: "Valider", btnRevise: "Réviser", btnAbort: "Annuler",
  ringHead: (n) => `🔄 Troc en cercle à ${n}`,
  groupHead: "🛒 Achat groupé en formation",
  ringLeg: (give, get) => `Tu donnes ${give} et tu reçois ${get}.`,
  groupAnchorAsk: (buyers, item) => `${buyers} personnes veulent ton ${item} - vendre en lot ?`,
  groupForming: (item, buyers) => `Un achat groupé se forme pour ${item} (${buyers} acheteurs).`,
  multiPassed: "Ignoré.",
  multiApproved: "👍 Validé - j'attends les autres…",
  ringSettled: (give, to, get, from) => `🎉 Cercle bouclé ! Donne ${give} à ${to}, reçois ${get} de ${from}.`,
  groupAnchorSettled: (item, buyers) => `🎉 Vente groupée ! Tu vends ton ${item} à : ${buyers}.`,
  groupBuyerSettled: (anchor, item, others) => `🎉 Tu es dans l'achat groupé avec ${anchor} pour ${item}${others ? ` (+${others} autre${others > 1 ? "s" : ""} acheteur${others > 1 ? "s" : ""})` : ""}.`,
  someone: "quelqu'un",
  verb: (k) => (k === "seek" ? "chercher" : k === "offer" ? "proposer" : k === "swap" ? "échanger" : "troquer"),
  blurbVerb: (k) => (k === "seek" ? "cherche" : k === "offer" ? "propose" : "veut " + k),
};

export const STR: Record<Lang, Strings> = { en, fr };
