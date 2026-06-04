export type NegType = "propose" | "counter" | "accept" | "reject" | "withdraw";

/** A single message in a private negotiation. Commerce uses `price`;
 *  swap/barter uses `have`/`want`. */
export interface NegMessage {
  type: NegType;
  price?: number;
  have?: string[];
  want?: string[];
  note?: string;
}

export interface Session {
  id: string;
  intentId: string;
  /** The counterparty broadcast (signal id) that opened this session. Part of
   *  the session identity, so the same two parties can run several concurrent
   *  negotiations in one domain (one per matched intent). */
  signalId: string;
  myPseudonym: string;
  counterparty: string;
  role: "initiator" | "responder";
  domain: string;
  rounds: number;
  myLastPrice?: number;
  closed: boolean;
}

/** Deterministic, symmetric key so both parties name the same session. Includes
 *  the matched signal id so two intents between the same pair in one domain do
 *  not collide into a single session. */
export function sessionKey(domain: string, a: string, b: string, signalId: string): string {
  return `${domain}:${[a, b].sort().join("~")}:${signalId}`;
}
