import type { Ctx } from "../core/ctx";
import type { PublicSignal } from "../core/intent";
import type { DM, Transport } from "./bus";

/**
 * In-process gossip + DM. Every delivery is routed through ctx.enqueue, so
 * messages land on the *next* tick - that's what gives us logical time and
 * makes time-to-match measurable.
 */
export class MemoryBus implements Transport {
  private signalHandlers: ((s: PublicSignal) => void)[] = [];
  private inboxes = new Map<string, (m: DM) => void>();

  constructor(private ctx: Ctx) {}

  registerPseudonym(pseudonymId: string, onDM: (m: DM) => void): void {
    this.inboxes.set(pseudonymId, onDM);
  }

  onSignal(handler: (s: PublicSignal) => void): void {
    this.signalHandlers.push(handler);
  }

  publish(signal: PublicSignal): void {
    for (const h of this.signalHandlers) {
      this.ctx.enqueue(() => h(signal));
    }
  }

  dm(msg: DM): void {
    const inbox = this.inboxes.get(msg.to);
    if (!inbox) return;
    this.ctx.enqueue(() => inbox(msg));
  }
}
