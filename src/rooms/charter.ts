import type { PublicSignal } from "../core/intent";

/**
 * A Charter is the rules of a room — in two parts:
 *  - `etiquette`: natural-language norms the agent is told to read and follow.
 *  - everything else: MACHINE-ENFORCED constraints the room applies regardless
 *    of whether the agent read or obeyed the etiquette. This enforced half is
 *    the only real guarantee against agents that don't behave.
 */
export interface Charter {
  id: string;
  /** NL rules an agent ingests on join (non-binding — cooperative agents only). */
  etiquette: string;
  /** Enforced: minimum trust to be admitted. */
  minTrust: number;
  /** Enforced: which domains may be posted here (undefined = any). */
  allowedDomains?: string[];
  /** Enforced: max signals one member may publish per `windowTicks`. */
  maxSignalsPerWindow: number;
  windowTicks: number;
  /** The negotiation protocols this room offers (the menu a per-deal agreement picks from). */
  protocols: string[];
}

export interface JoinContext {
  agentId: string;
  trustScore: number; // 0..1, from the (future) web-of-trust; stubbed for now
}

export type Ruling = { ok: true } | { ok: false; reason: string };

/** Enforced admission check. */
export function admits(charter: Charter, ctx: JoinContext): Ruling {
  return ctx.trustScore >= charter.minTrust
    ? { ok: true }
    : { ok: false, reason: `trust ${ctx.trustScore.toFixed(2)} < required ${charter.minTrust}` };
}

/** Enforced signal schema check (domain + required shape). Rate is checked in the Room. */
export function validates(charter: Charter, signal: PublicSignal): Ruling {
  if (charter.allowedDomains && !charter.allowedDomains.some((d) => signal.domain.startsWith(d))) {
    return { ok: false, reason: `domain ${signal.domain} not allowed here` };
  }
  if (!signal.tags || signal.tags.length === 0) {
    return { ok: false, reason: "signal has no tags" };
  }
  return { ok: true };
}
