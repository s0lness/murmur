import type { Agent } from "../agent/agent";
import type { EventLog } from "../core/events";

export interface Metrics {
  signalsPublished: number;
  contacts: number;
  deals: number;
  failed: number;
  spamRatio: number;
  avgTimeToMatch: number;
  msgsPerDeal: number;
  realizedSurplus: number;
  dealLines: string[];
}

/**
 * Everything is derived from the event log — "did serendipity actually happen"
 * is not eyeball-able, so the rig measures it. Surplus is computed from a
 * god's-eye view of both parties' reserves (impossible for the agents to know).
 */
export function computeMetrics(log: EventLog, agents: Agent[]): Metrics {
  const byPseudo = new Map(agents.map((a) => [a.pseudonym, a]));
  const closed = log.byType("deal_closed");
  const contacts = log.byType("negotiation_opened").length;
  const deals = closed.length;
  const failed = log.byType("deal_failed").length;
  const msgs = log.byType("negotiation_msg").length;

  let realizedSurplus = 0;
  const dealLines: string[] = [];
  for (const d of closed) {
    const rest = d.sessionId.slice(d.domain.length + 1);
    const [p1, p2] = rest.split("~");
    const a1 = byPseudo.get(p1 ?? "");
    const a2 = byPseudo.get(p2 ?? "");
    const label = `${a1?.persona ?? p1}  ⇄  ${a2?.persona ?? p2}`;

    if (d.price !== undefined && a1 && a2) {
      const i1 = a1.getIntents().find((i) => i.domain === d.domain && i.valuation !== undefined);
      const i2 = a2.getIntents().find((i) => i.domain === d.domain && i.valuation !== undefined);
      const buyer = i1?.kind === "seek" ? i1 : i2;
      const seller = i1?.kind === "offer" ? i1 : i2;
      if (buyer?.valuation !== undefined && seller?.valuation !== undefined) {
        realizedSurplus += Math.max(0, buyer.valuation - seller.valuation);
      }
      dealLines.push(`  ✓ ${label}  @ ${d.price}`);
    } else {
      dealLines.push(`  ✓ ${label}  (${d.terms ?? "swap"})`);
    }
  }

  return {
    signalsPublished: log.byType("signal_published").length,
    contacts,
    deals,
    failed,
    spamRatio: contacts === 0 ? 0 : (contacts - deals) / contacts,
    avgTimeToMatch: deals === 0 ? 0 : closed.reduce((s, d) => s + d.t, 0) / deals,
    msgsPerDeal: deals === 0 ? 0 : msgs / deals,
    realizedSurplus,
    dealLines,
  };
}

export function formatReport(m: Metrics): string {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return [
    "",
    "─ deals ───────────────────────────────────────────",
    ...(m.dealLines.length ? m.dealLines : ["  (none)"]),
    "",
    "─ metrics ─────────────────────────────────────────",
    `  signals broadcast     ${m.signalsPublished}`,
    `  contacts initiated    ${m.contacts}`,
    `  deals closed          ${m.deals}`,
    `  negotiations failed   ${m.failed}`,
    `  spam ratio            ${pct(m.spamRatio)}   (contacts that didn't close)`,
    `  avg time-to-match     ${m.avgTimeToMatch.toFixed(1)} ticks`,
    `  msgs per deal         ${m.msgsPerDeal.toFixed(1)}`,
    `  realized surplus      ${m.realizedSurplus}`,
    "",
  ].join("\n");
}
