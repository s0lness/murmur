import type { Agent } from "../agent/agent";
import type { Ctx } from "../core/ctx";
import { EventLog } from "../core/events";
import { TrustGraph } from "../core/identity";
import { MemoryBus } from "../transport/memoryBus";

/**
 * The simulated universe: a logical clock, a delivery queue, the gossip bus,
 * the trust graph, and an event log. Time advances one "round" of the queue
 * per tick, so anything enqueued during a tick lands on the next one.
 */
export class World {
  readonly log = new EventLog();
  readonly trust = new TrustGraph();
  readonly agents: Agent[] = [];
  readonly ctx: Ctx;
  readonly bus: MemoryBus;

  private queue: (() => void)[] = [];
  private tick = 0;

  constructor(private maxTicks = 1000) {
    this.ctx = {
      now: () => this.tick,
      enqueue: (fn) => this.queue.push(fn),
      log: this.log,
      trust: this.trust,
    };
    this.bus = new MemoryBus(this.ctx);
  }

  add(agent: Agent): void {
    this.agents.push(agent);
  }

  run(): void {
    for (const a of this.agents) a.announce();
    while (this.queue.length > 0 && this.tick < this.maxTicks) {
      const round = this.queue;
      this.queue = [];
      this.tick++;
      for (const fn of round) fn();
    }
  }
}
