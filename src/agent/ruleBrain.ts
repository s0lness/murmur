import type { PrivateIntent, PublicSignal } from "../core/intent";
import type { NegMessage, Session } from "../negotiate/protocol";
import type { Brain } from "./brain";

const MAX_ROUNDS = 8;

/**
 * Deterministic baseline brain.
 *  - Commerce: anchored haggling that converges toward the midpoint of the
 *    zone of possible agreement, and walks away when there is none.
 *  - Swap/barter: accepts only on a double coincidence of wants.
 */
export class RuleBrain implements Brain {
  open(intent: PrivateIntent, _signal: PublicSignal): NegMessage | null {
    if (intent.kind === "swap" || intent.kind === "barter") {
      return { type: "propose", have: intent.have, want: intent.want };
    }
    const v = intent.valuation ?? 0;
    // buyer opens low, seller opens high
    return { type: "propose", price: round(intent.kind === "seek" ? v * 0.6 : v * 1.6) };
  }

  respond(intent: PrivateIntent, session: Session, incoming: NegMessage): NegMessage {
    if (intent.kind === "swap" || intent.kind === "barter") {
      return this.respondBarter(intent, incoming);
    }
    return this.respondCommerce(intent, session, incoming);
  }

  private respondBarter(intent: PrivateIntent, incoming: NegMessage): NegMessage {
    const theirHave = new Set(incoming.have ?? []);
    const theirWant = incoming.want ?? [];
    const myHave = intent.have ?? [];
    const myWant = intent.want ?? [];

    const iGetWhatIWant = myWant.length > 0 && myWant.every((w) => theirHave.has(w));
    const theyGetWhatTheyWant = theirWant.length > 0 && theirWant.every((w) => myHave.includes(w));

    return iGetWhatIWant && theyGetWhatTheyWant
      ? { type: "accept", note: `swap ${myHave.join("+")} for ${myWant.join("+")}` }
      : { type: "reject", note: "no double coincidence" };
  }

  private respondCommerce(intent: PrivateIntent, session: Session, incoming: NegMessage): NegMessage {
    const v = intent.valuation ?? 0;
    const theirPrice = incoming.price ?? 0;
    const acceptable = intent.kind === "seek" ? theirPrice <= v : theirPrice >= v;
    const myLast = session.myLastPrice ?? round(intent.kind === "seek" ? v * 0.6 : v * 1.6);
    const closeEnough = Math.abs(theirPrice - myLast) <= 0.05 * Math.max(v, 1);

    if (acceptable && (closeEnough || session.rounds >= 3)) {
      return { type: "accept", price: theirPrice };
    }
    if (session.rounds >= MAX_ROUNDS) {
      return { type: "withdraw", note: "no agreement" };
    }
    // concede toward their price by 40% of the gap, never past my reserve
    const next = myLast + 0.4 * (theirPrice - myLast);
    const bounded = intent.kind === "seek" ? Math.min(next, v) : Math.max(next, v);
    return { type: "counter", price: round(bounded) };
  }
}

function round(n: number): number {
  return Math.round(n);
}
