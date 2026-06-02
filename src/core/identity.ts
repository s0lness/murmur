export interface Identity {
  /** Stable local id — never broadcast. */
  agentId: string;
  /** What the rest of the world sees. */
  pseudonymId: string;
}

/** M0: one stable pseudonym per agent. Rotation-per-signal is a later milestone
 *  (it's what makes real web-of-trust scoring necessary — see TrustGraph). */
export function makeIdentity(agentId: string): Identity {
  return { agentId, pseudonymId: `anon-${fnv1a(agentId)}` };
}

function fnv1a(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * Minimal web-of-trust stub. M0 trusts everyone so trustGate never blocks.
 * M2 replaces this with a signed vouch graph + trust-path scoring, which is
 * also where rotating pseudonyms start to matter.
 */
export class TrustGraph {
  private vouches = new Map<string, Set<string>>();

  vouch(from: string, to: string): void {
    let set = this.vouches.get(from);
    if (!set) {
      set = new Set();
      this.vouches.set(from, set);
    }
    set.add(to);
  }

  /** M0 stub: everyone is trusted (1.0). */
  scoreFor(_pseudonymId: string): number {
    return 1;
  }
}
