/** Append-only, replayable record of everything that happened in a sim run.
 *  Metrics derive entirely from this — nothing is measured inline. */
export type Event =
  | { t: number; type: "signal_published"; by: string; signalId: string; domain: string; kind: string }
  | { t: number; type: "interest"; by: string; towards: string; signalId: string; score: number }
  | { t: number; type: "negotiation_opened"; sessionId: string; initiator: string; domain: string }
  | { t: number; type: "negotiation_msg"; sessionId: string; from: string; mtype: string; price?: number }
  | { t: number; type: "deal_closed"; sessionId: string; domain: string; price?: number; terms?: string }
  | { t: number; type: "deal_failed"; sessionId: string; reason: string };

export class EventLog {
  private events: Event[] = [];

  append(e: Event): void {
    this.events.push(e);
  }

  all(): readonly Event[] {
    return this.events;
  }

  byType<T extends Event["type"]>(type: T): Extract<Event, { type: T }>[] {
    return this.events.filter((e) => e.type === type) as Extract<Event, { type: T }>[];
  }
}
