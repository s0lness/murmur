import { z } from "zod";

/** What an agent wants to do with an intent. seek/offer are complements;
 *  swap/barter match their own kind (double coincidence of wants). */
export const Kind = z.enum(["seek", "offer", "swap", "barter"]);
export type Kind = z.infer<typeof Kind>;

export const Window = z.object({ from: z.number(), to: z.number() });
export type Window = z.infer<typeof Window>;

/** The blurred, public face of an intent — this is all that hits the gossip bus.
 *  Deliberately omits price, identity, and exact constraints. */
export const PublicSignal = z.object({
  id: z.string(),
  pseudonymId: z.string(),
  kind: Kind,
  domain: z.string(),
  tags: z.array(z.string()),
  region: z.string(),
  window: Window.optional(),
  trustGate: z.number().min(0).max(1),
  expiry: z.number().optional(),
});
export type PublicSignal = z.infer<typeof PublicSignal>;

/** The full private intent. Never leaves the agent. */
export interface PrivateIntent {
  id: string;
  kind: Kind;
  domain: string;
  tags: string[];
  region: string;
  window?: Window;
  trustGate?: number;
  /** Commerce: buyer = max willing to pay; seller = min acceptable (reservation). */
  valuation?: number;
  /** The user's best alternative elsewhere (e.g. marketplace price) — a deal must
   *  beat this (individual rationality). */
  fallback?: number;
  /** Other things they'd also accept ("a Vita or a Miyoo") — widens the solution space. */
  substitutes?: string[];
  /** How many units (for bulk / group settlement). Defaults to 1. */
  qty?: number;
  /** Barter/swap: what I can give / what I want in return. */
  have?: string[];
  want?: string[];
  /** Tags safe to expose publicly; defaults to `tags` when omitted. */
  publicTags?: string[];

  // ── Provenance (set by the distiller in M1; absent for hand-authored intents) ──
  /** The raw user utterance this intent was distilled from. */
  source?: string;
  /** Distiller's confidence this is a real, actionable intent (0–1). */
  confidence?: number;
  /** Whether to broadcast now. `false` = half-formed/ambient, held back until a trigger. */
  active?: boolean;
  /** Distiller's one-line justification, incl. why these tags are safe to expose. */
  rationale?: string;
}

/**
 * The privacy boundary. Derives a blurred public signal from a private intent.
 * Everything sensitive — price, identity, exact constraints — stops here.
 * Later milestones graduate this from cleartext tags to bloom filters / PSI.
 */
export function blur(intent: PrivateIntent, pseudonymId: string): PublicSignal {
  return {
    id: intent.id,
    pseudonymId,
    kind: intent.kind,
    domain: intent.domain,
    tags: intent.publicTags ?? intent.tags,
    region: intent.region,
    window: intent.window,
    trustGate: intent.trustGate ?? 0,
  };
}
