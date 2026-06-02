import type { PublicSignal } from "../core/intent";
import type { NegMessage } from "../negotiate/protocol";

/** A private, addressed message between two pseudonyms. */
export interface DM {
  from: string;
  to: string;
  sessionId: string;
  body: NegMessage;
}

/**
 * The single seam between the sim and the real world. The in-memory bus today
 * maps 1:1 onto Matrix later: `publish` -> public gossip room, `dm` -> E2EE DM.
 * Swapping transports means writing one new file behind this interface.
 */
export interface Transport {
  registerPseudonym(pseudonymId: string, onDM: (m: DM) => void): void;
  publish(signal: PublicSignal): void;
  dm(msg: DM): void;
  onSignal(handler: (s: PublicSignal) => void): void;
}
