import type { EventLog } from "./events";
import type { TrustGraph } from "./identity";

/** Shared runtime handed to the bus and every agent. The simulated clock and
 *  delivery queue live in the World; this is the slice everyone else needs. */
export interface Ctx {
  /** Current logical tick. */
  now(): number;
  /** Schedule work for the next tick (this is what makes time pass). */
  enqueue(fn: () => void): void;
  log: EventLog;
  trust: TrustGraph;
}
