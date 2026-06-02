import type { PrivateIntent, PublicSignal } from "../core/intent";
import type { NegMessage, Session } from "../negotiate/protocol";

/**
 * The decision layer of an agent. M0 ships a deterministic RuleBrain; M1 adds
 * an LLMBrain (Anthropic SDK) behind this same interface so a few agents can
 * negotiate with real language while the rest stay cheap and reproducible.
 */
export interface Brain {
  /** Opening DM when interested in a heard signal (or null to pass). */
  open(intent: PrivateIntent, signal: PublicSignal): NegMessage | null;
  /** Reply to an incoming negotiation message (may be accept/reject/withdraw). */
  respond(intent: PrivateIntent, session: Session, incoming: NegMessage): NegMessage;
}
