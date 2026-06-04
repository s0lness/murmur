# murmur

**An ambient-intent layer for agents.** You tell your agent what you want in plain words. It
holds that want quietly, broadcasts only a *blur* (category + tags - never price, name, or
exact location), and when it finds a complementary want somewhere else it matches you
privately and proposes a fair deal. Settlement falls back to whatever the real world already
uses: payment, shipping, a handshake.

> **Where this is now:** a live Telegram pilot (`@mmmmurmur_bot`) plus an LLM-driven fuzz lab
> that stress-tests the whole pipeline. Jump to **[PILOT.md](PILOT.md)** (run the bot) ·
> **[FINDINGS.md](FINDINGS.md)** (what we learned) · **[runs/log.md](runs/log.md)** (every
> experiment + decision).

## The vision

We carry endless low-grade wants - sell the couch before moving, swap apartments for June,
find the one person at an event who cares about the same weird thing - that never surface,
because the cost of expressing each one (phrase it, post it, filter the inbound, keep it in
your head) is higher than the want is worth. So the long tail dies in your head.

Agents change the economics. They can hold your half-formed wants in the background and
quietly let them find each other - **user-owned intents that prove just enough to match
without dumping your private life into a marketplace.** Your agent distills your messy words
into structured intent, broadcasts only a blur, negotiates privately, and hands you a deal to
close in the real world. The bet: expressive, private, agent-to-agent intent commerce beats
posting into the void.

## How it works

```
  you ──"selling my road bike, ~$150, free till Sunday"──▶  your agent
                                                                │
                                                                │  distill  (LLM → structured intent)
                                                                ▼
                                                   PrivateIntent
                                          { offer · bikes · [road, used] · $150 · region · window }
                                                                │
                                                                │  blur()   ← the privacy boundary
                                                                ▼          (drop price, identity, exact loc)
                                                  PublicSignal  "someone offers: road bike (bikes)"
                                                                │
                                                                │  broadcast to the pool
                          ┌─────────────────────────────────────┴─────────────────────────────────┐
                          ▼                                                                         ▼
                 other agents' signals ───────▶   MATCH                                  your other wants
                                          semantic pairs · group-buys · barter rings
                                          (+ an LLM fuzzy-edge failover for near-substitutes)
                                                                │
                                                                │  price = midpoint of the
                                                                ▼  fallback-bounded zone of agreement
                                                          PROPOSE  ──▶  both sides Connect + Approve
                                                                │
                                                                ▼
                                                      connect & settle in the real world
```

Step by step:

1. **Distill.** Your agent reads what you *said* - messy, half-formed - and turns it into a
   structured `PrivateIntent`: kind (seek / offer / swap), category, tags, a private reserve
   price, region, and a freshness window. Tentative wants are held back, not broadcast.
2. **Blur.** One function, [`blur()`](src/core/intent.ts), is the entire public/private split.
   It strips everything sensitive and emits only what's needed to *find* a match:

   ```
   PrivateIntent { …everything: price, identity, exact constraints }
         │  blur()
         ▼
   PublicSignal  { kind, domain, tags, region }     ← all that ever leaves your agent
   ```

3. **Match.** Signals meet in a shared pool. A semantic judge pairs complementary wants;
   detectors find **group-buys** (one bulk offer, many buyers) and **barter rings** (A wants
   what B has, B what C has, C what A has). When the keyword matcher misses a real
   substitute, an LLM proposes the missing equivalence and the deterministic solver closes
   the match over it.
4. **Price.** The agent does *not* haggle (live LLM bargaining leaks information and misses
   narrow deals). It proposes the **midpoint of the fallback-bounded zone of agreement** -
   individual-rational by construction, so a deal always beats each side's outside option.
5. **Confirm & settle.** Nothing auto-executes. Both humans Connect, then Approve the price;
   then they're dropped into a direct connection to settle however they like.

## Who does what

Two people, each represented by their own agent, meeting over a shared pool. Nobody talks to
the pool directly, and nobody auto-commits: the humans bookend the whole thing.

```
     YOU                          the shared POOL                          THEM
  (a human)                     (matching engine)                       (a human)
      │                                                                      │
      │ "selling my bike, ~$150"                          "want a cheap bike" │
      ▼                                                                      ▼
  your agent ───blur────▶  ┌───────────────────────────────┐  ◀────blur─── their agent
      ▲                    │  MATCH  pairs · groups · rings │                     ▲
      │  Connect?          │         (+ LLM substitute      │            Connect? │
      │  Approve $?        │          failover)             │          Approve $? │
      │                    │  PRICE  deterministic midpoint │                     │
      │                    └───────────────────────────────┘                     │
      └──────────────── you both confirm, then settle in the real world ─────────┘
```

| job | who | how |
| --- | --- | --- |
| say what you want, in plain words | **you** (human) | a chat message |
| distill words into a structured intent | **your agent** | LLM, where judgement is needed |
| blur it, broadcast only what's safe | **your agent** | `blur()`, deterministic |
| find matches across the pool, set a fair price | **the engine** | deterministic, IR-safe |
| propose a fuzzy substitute the keyword matcher missed | **LLM oracle** | "would a hybrid work?" |
| Connect, Approve the price, the final yes | **you** (the gate) | nothing auto-executes |
| pay / ship / meet up | **both humans** | in the real world |

The pattern under all of it: **the LLM is a preference oracle** (express, refine, recall),
**the deterministic engine is the combinatorial core** (match, price, find cycles, individual-
rational by construction), and **the human is the gate** (confirms, and rejects bad
suggestions at zero modeling cost). That split is the thing that kept proving itself across
the experiments; see [FINDINGS.md](FINDINGS.md).

## Run it

Two entry points. Full guides in **[PILOT.md](PILOT.md)** and **[FINDINGS.md](FINDINGS.md)**.

```bash
npm install

# the live bot (Telegram pilot) - distill → blur → match → price → connect
npm run smoke      # verify it wires up (no Telegram connection)
npm run server     # start the bot + host dashboard on http://localhost:4319

# the fuzz lab - an LLM plays each human; the real pipeline is the agent
npm run fuzz 30 help        # 30 agents through the whole pipeline
npm run view                # then open http://localhost:5050/fuzz.html to watch it

npm test           # deterministic matching/privacy tests
```

Needs an `murmur/.env` (gitignored) with `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`,
`MURMUR_MODEL`, and `MURMUR_CURRENCY`. Everything is **observable**: the host dashboard shows
the pool, matches, deals, the agent⇄human conversations, and a live token/cost meter.

## Future exploration

- **Privacy ladder.** `blur()` emits cleartext tags today - rung 1 of a ladder it can climb
  without changing its interface: cleartext → bloom-filter overlap → private set intersection
  → MPC/FHE scoring, trading match cost for ever-stronger privacy.
- **Trust & rooms.** Signed vouch graphs and rotating pseudonyms; *rooms* with a **charter**
  (who's admitted, what's postable, how you negotiate) - soft norms as LLM etiquette, hard
  limits machine-enforced.
- **Real transport.** Today the pool is central-hosted; later, federated transport (public
  rooms for the blurred gossip, E2EE DMs for negotiation) so no host sees everything.
- **Richer refinement.** Clarifying questions that elicit *missing constraints* (budget, size,
  flexibility), not just substitutes - the payoff grows with genuinely vague human input.
