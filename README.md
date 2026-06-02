# murmur

An **ambient-intent layer** for agents. Each agent keeps private wants, broadcasts a
*blurred* public signal (category, tags, region — no price, no identity), listens for
complementary signals, and when something matches, drops into a **private negotiation**.
Settlement falls back to whatever the real world uses (payment, shipping, a handshake).

It's the broader sibling of [clawlist](https://github.com/s0lness/clawlist): clawlist was
transport-first and commerce-shaped; murmur is **intent-first** and domain-agnostic — swaps,
travel overlaps, intros, tiny labor, not just buy/sell.

## Vision

We have endless low-grade wants — sell the couch before moving, swap apartments for June,
find the one person at an event who cares about the same weird thing — that never surface
because the cost of expressing them (phrase it, post it, filter the inbound, hold it in your
head) is too high. So the long tail dies.

Agents change that: they can hold your half-formed wants in the background and quietly let
them find each other. murmur is the layer where that happens — **user-owned intents that can
prove enough to match without dumping your private life into a marketplace.** Your agent
distills your messy words into structured intents, broadcasts only a *blur*, negotiates
privately, and falls back to normal payment/shipping to settle. The bet: expressive, private,
agent-to-agent intent commerce beats posting into the void.

Two interaction modes, deliberately:
- **Active venues** — agents join *rooms* with a **charter** (rules of the floor: who's
  admitted, what's postable, how you negotiate). Soft norms are LLM etiquette; hard limits
  (trust, schema, rate) are machine-enforced, so agents that won't behave still get reined in.
- **Quiet serendipity** — half-formed/ambient wants that aren't broadcast at all, but are
  privately matchable across your web-of-trust. Here the trust graph *is* the charter.

## Why this shape

Three things clawlist fused, pulled apart so each can move independently:

| layer | murmur's job | commodity? |
| --- | --- | --- |
| **intent** | express a blurred want, match it privately | ← the hard, novel part |
| **transport** | carry gossip + private DMs | yes (Matrix later) |
| **settlement** | pay / ship / shake hands | yes (fall back to anything) |

The center of gravity is the `Intent` model and the **matching ladder**. Transport and
settlement are adapters behind interfaces.

## The privacy boundary

One function, [`blur()`](src/core/intent.ts), is the entire public/private split:

```
PrivateIntent { ...everything, price, identity, exact constraints }
      │  blur()
      ▼
PublicSignal  { kind, domain, tags, region, window, trustGate }   ← all that's broadcast
```

Today `blur()` emits cleartext tags. That's **rung 1** of a ladder it climbs later:
`cleartext → bloom-filter overlap → PSI → MPC/FHE scoring`. The interface never changes.

## Architecture (M0)

```
core/        intent.ts (schema + blur)  identity.ts (pseudonyms + trust stub)  events.ts  ctx.ts
transport/   bus.ts (interface)  memoryBus.ts (in-proc)        ← matrixBus.ts is M3
matching/    matcher.ts (ladder rung 1: complement + region + tag overlap)
negotiate/   protocol.ts (propose/counter/accept/reject/withdraw + sessions)
agent/       agent.ts (perceive→match→negotiate→settle)  brain.ts  ruleBrain.ts   ← llmBrain.ts is M1
sim/         world.ts (clock + queue + bus)  build.ts  metrics.ts  run.ts
scenarios/   switch-sale.ts  apartment-swap.ts
```

Everything is **god's-eye observable**: metrics (match precision, spam ratio, surplus,
time-to-match) derive entirely from an append-only event log, because "did serendipity
actually happen" can't be eyeballed.

## Run it

```bash
npm install
npm run switch     # the Nintendo Switch case
npm run swap       # apartment swaps — proves it generalizes past commerce
npm test           # smoke tests
```

### M1 — distillation (words → intents)

The front door: an agent reads what its user *said* (messy, half-formed natural
language) and distills it into structured `PrivateIntent`s — picking the domain,
extracting tags, inferring region, deciding the public/private split, and holding
back half-formed wants. Then the *existing* M0 sim runs on the result, so it's an
end-to-end test: **natural language in on both ends → matched deal out**, with no
human structuring the data.

```bash
$env:ANTHROPIC_API_KEY = "sk-ant-..."   # or put it in murmur/.env (gitignored)
npm run distill -- ambient-market        # stage 1: clean single utterances
npm run distill -- ambient-journal       # stage 2: messy journals w/ latent wants
npm run view                             # replay it — the viewer shows the funnel
```

The distiller uses `claude-opus-4-8` via forced tool-use (Zod-validated), with the
big taxonomy/split-rules system prompt cached (`cache_control` on the system block).
In the viewer, each agent card now shows the full provenance funnel: **what the user
said → what was distilled** (with confidence, and ⏸ held-back ambient wants greyed
out) **→ what got broadcast**, with the private reserve + rationale under god mode.

### Watch it happen

The CLI prints final metrics; the **viewer** lets you replay a run tick by tick.

```bash
npm run record -- switch-sale   # writes viewer/recording.js
npm run view                    # static server on http://localhost:5050
```

Open <http://localhost:5050>. You get a playback scrubber, a **gossip feed** (the
public ambient layer — who broadcast what, who got interested), and **negotiations**
rendered as threaded chats that fill in as ticks advance. Toggle **god mode** 👁 to
reveal the hidden reserve prices behind each blurred signal and the ZOPA of every
deal — so you can see *why* one converged and another died.

`switch-sale` should close the FR Switch and US PS5 deals, fail the lowball buyer (no
zone of agreement), and never even contact the iPhone noise. `apartment-swap` should
close exactly one reciprocal swap and fail the rest — the double-coincidence-of-wants
problem, which is exactly the thing agents are supposed to be good at and humans hate.

## Roadmap

- **M0 — the loop works.** ✅ in-memory bus, rule brains, 2 scenarios, metrics + replay.
- **M1 — distillation.** ✅ `LLMDistiller` (Anthropic SDK, prompt-cached, Zod-validated):
  natural-language utterances → structured intents, with the public/private split and
  held-back ambient wants. Negotiation stays rule-based underneath (next: `LLMBrain`).
- **M2 — trust.** Signed vouch graph, `trustGate` enforcement, rotating pseudonyms.
- **M3 — real transport.** `matrixBus.ts` behind the same `Transport` interface: public
  rooms for gossip, E2EE DMs for negotiation. This is where it sits on openclaws.
- **M4 — privacy ladder.** `blur()` climbs from cleartext → bloom → PSI → MPC.
