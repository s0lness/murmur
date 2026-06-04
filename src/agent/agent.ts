import type { Ctx } from "../core/ctx";
import { blur, type PrivateIntent, type PublicSignal } from "../core/intent";
import type { Identity } from "../core/identity";
import { evaluate } from "../matching/matcher";
import { sessionKey, type NegMessage, type Session } from "../negotiate/protocol";
import type { DM, Transport } from "../transport/bus";
import type { Brain } from "./brain";

export interface AgentSpec {
  agentId: string;
  persona: string;
  intents: PrivateIntent[];
}

export class Agent {
  readonly id: string;
  readonly pseudonym: string;
  readonly persona: string;
  private sessions = new Map<string, Session>();
  /** signalId -> my private intent id, for the intents I've broadcast. Lets a
   *  responder bind an incoming negotiation to the exact advertised intent. */
  private published = new Map<string, string>();

  constructor(
    identity: Identity,
    persona: string,
    private intents: PrivateIntent[],
    private brain: Brain,
    private bus: Transport,
    private ctx: Ctx,
  ) {
    this.id = identity.agentId;
    this.pseudonym = identity.pseudonymId;
    this.persona = persona;
    this.bus.registerPseudonym(this.pseudonym, (m) => this.onDM(m));
    this.bus.onSignal((s) => this.onSignal(s));
  }

  /** God's-eye accessor for metrics only - never used in the agent loop. */
  getIntents(): readonly PrivateIntent[] {
    return this.intents;
  }

  /** Broadcast a blurred signal for each of my *active* intents.
   *  Half-formed wants (active === false) are held back - not broadcast - until
   *  some trigger promotes them. That restraint is the anti-spam property. */
  announce(): void {
    for (const intent of this.intents) {
      if (intent.active === false) continue;
      const signal = blur(intent, this.pseudonym);
      this.published.set(signal.id, intent.id);
      this.ctx.log.append({
        t: this.ctx.now(),
        type: "signal_published",
        by: this.pseudonym,
        signalId: signal.id,
        domain: signal.domain,
        kind: signal.kind,
      });
      this.bus.publish(signal);
    }
  }

  private onSignal(signal: PublicSignal): void {
    if (signal.pseudonymId === this.pseudonym) return; // ignore my own broadcast
    const match = evaluate(signal, this.intents, this.ctx);
    if (!match) return;

    // Cross-pair dedup without revealing who's interested:
    // buyers (seek) chase listings; sellers (offer) post and wait; symmetric
    // swap/barter is broken by pseudonym order. Guarantees exactly one opener.
    const iInitiate =
      match.intent.kind === "seek" ? true
      : match.intent.kind === "offer" ? false
      : this.pseudonym < signal.pseudonymId;
    if (!iInitiate) return;

    const key = sessionKey(signal.domain, this.pseudonym, signal.pseudonymId, signal.id);
    if (this.sessions.has(key)) return; // already engaged on THIS signal (not just this counterparty)

    const opener = this.brain.open(match.intent, signal);
    if (!opener) return;

    const session: Session = {
      id: key,
      intentId: match.intent.id,
      signalId: signal.id,
      myPseudonym: this.pseudonym,
      counterparty: signal.pseudonymId,
      role: "initiator",
      domain: signal.domain,
      rounds: 0,
      myLastPrice: opener.price,
      closed: false,
    };
    this.sessions.set(key, session);

    this.ctx.log.append({
      t: this.ctx.now(),
      type: "interest",
      by: this.pseudonym,
      towards: signal.pseudonymId,
      signalId: signal.id,
      score: match.score,
    });
    this.ctx.log.append({
      t: this.ctx.now(),
      type: "negotiation_opened",
      sessionId: key,
      initiator: this.pseudonym,
      domain: signal.domain,
    });
    this.send(session, opener);
  }

  private onDM(m: DM): void {
    let session = this.sessions.get(m.sessionId);
    if (!session) {
      // Responder side: first contact. Bind to the EXACT advertised intent the
      // opener's signal referenced (not "first intent in this domain") so a
      // second intent in the same domain gets its own session and the right one.
      const intentId = this.published.get(m.signalId);
      const intent = intentId ? this.intents.find((i) => i.id === intentId) : undefined;
      if (!intent) return;
      session = {
        id: m.sessionId,
        intentId: intent.id,
        signalId: m.signalId,
        myPseudonym: this.pseudonym,
        counterparty: m.from,
        role: "responder",
        domain: intent.domain,
        rounds: 0,
        closed: false,
      };
      this.sessions.set(m.sessionId, session);
    }
    if (session.closed) return;

    const intent = this.intents.find((i) => i.id === session.intentId);
    if (!intent) return;
    session.rounds++;

    this.ctx.log.append({
      t: this.ctx.now(),
      type: "negotiation_msg",
      sessionId: session.id,
      from: m.from,
      mtype: m.body.type,
      price: m.body.price,
    });

    // Terminal messages from the counterparty: they already logged the outcome.
    if (m.body.type === "accept") {
      session.closed = true;
      return;
    }
    if (m.body.type === "reject" || m.body.type === "withdraw") {
      session.closed = true;
      return;
    }

    const reply = this.brain.respond(intent, session, m.body);
    this.send(session, reply);

    if (reply.type === "accept") {
      // I accepted their offer (m.body) - record the agreed terms.
      session.closed = true;
      this.ctx.log.append({
        t: this.ctx.now(),
        type: "deal_closed",
        sessionId: session.id,
        domain: session.domain,
        a: this.pseudonym,
        b: session.counterparty,
        price: m.body.price,
        terms: reply.note,
      });
    } else if (reply.type === "reject" || reply.type === "withdraw") {
      session.closed = true;
      this.ctx.log.append({
        t: this.ctx.now(),
        type: "deal_failed",
        sessionId: session.id,
        reason: reply.note ?? reply.type,
      });
    } else if (reply.price !== undefined) {
      session.myLastPrice = reply.price;
    }
  }

  private send(session: Session, body: NegMessage): void {
    this.bus.dm({ from: this.pseudonym, to: session.counterparty, sessionId: session.id, signalId: session.signalId, body });
  }
}
