import type { PublicSignal } from "../core/intent";
import { admits, type Charter, type JoinContext, type Ruling, validates } from "./charter";

export interface PostResult {
  accepted: boolean;
  reason?: string;
}

/**
 * A venue governed by a Charter. The room hands every joiner the etiquette to
 * read, but ENFORCES admission, schema, and rate itself - so an agent that
 * skipped or ignored the etiquette still gets reined in.
 */
export class Room {
  private members = new Set<string>();
  private postTimes = new Map<string, number[]>(); // agentId -> tick timestamps
  readonly accepted: PublicSignal[] = [];
  readonly rejections: { agentId: string; reason: string }[] = [];

  constructor(readonly charter: Charter) {}

  /** Returns the etiquette an agent should read on entry (cooperative path). */
  rulesOfTheRoom(): string {
    return this.charter.etiquette;
  }

  join(ctx: JoinContext): Ruling {
    const ruling = admits(this.charter, ctx);
    if (ruling.ok) this.members.add(ctx.agentId);
    else this.rejections.push({ agentId: ctx.agentId, reason: `join refused: ${ruling.reason}` });
    return ruling;
  }

  publish(agentId: string, signal: PublicSignal, now: number): PostResult {
    if (!this.members.has(agentId)) {
      return this.reject(agentId, "not a member");
    }
    const schema = validates(this.charter, signal);
    if (!schema.ok) return this.reject(agentId, schema.reason);

    // Enforced rate limit over the sliding window.
    const times = (this.postTimes.get(agentId) ?? []).filter((t) => t > now - this.charter.windowTicks);
    if (times.length >= this.charter.maxSignalsPerWindow) {
      return this.reject(agentId, `rate limit (${this.charter.maxSignalsPerWindow}/${this.charter.windowTicks} ticks)`);
    }
    times.push(now);
    this.postTimes.set(agentId, times);

    this.accepted.push(signal);
    return { accepted: true };
  }

  private reject(agentId: string, reason = "rejected"): PostResult {
    this.rejections.push({ agentId, reason });
    return { accepted: false, reason };
  }
}
