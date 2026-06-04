# murmur — what we learned

A synthesis of the experiments. The blow-by-blow (every run + decision) lives in
[`runs/log.md`](runs/log.md); this is the durable takeaway.

## The core architecture that kept winning

Every capability we tried — pricing, substitute matching, barter rings, refinement — landed
on the **same division of labor**:

```
LLM = preference oracle        deterministic engine = combinatorial core      human = the gate
(express / refine / recall)    (price / allocate / find cycles — IR-safe)      (confirm; never auto-settle)
```

- **The LLM is great at fuzzy judgement, bad at bookkeeping.** It should *express* messy wants
  into structure (distill), *propose semantic equivalences* ("ps5 ≈ games console"), and
  *refine* via clarifying questions. It should NOT build multi-party trades (it scrambles the
  who-gives-what) or set prices (LLM haggling is reserve-safe but leaks and misses narrow
  deals — see `src/research/bargaining.ts`).
- **The deterministic solver does the combinatorics.** Bipartite commerce matching (substitute-
  and IR-aware), node-disjoint barter cycles, group-buys. Prices are the **midpoint of the
  fallback-bounded ZOPA** — individual-rational by construction.
- **The human gate is the safety net.** Across ~14 adversarial fuzzy proposals, it caught
  100% of the bad ones. Hence: proposals + a confirm question, never auto-execution.

The clean expression of this is the **hybrid helper** (`src/solver/helper.ts`): the LLM emits
fuzzy edges, a union-find collapses them to canonical tokens, and the *unchanged* deterministic
detectors close cycles/matches over the augmented graph. Pure-LLM matchmaking scrambled a
planted ring; the hybrid recovered it cleanly.

## What we built

- **The live bot** (`src/server/`) — Telegram pilot: distill → blur → semantic match →
  multilateral (group-buys + rings + the hybrid failover) → IR-midpoint price → human gate.
  See [`PILOT.md`](PILOT.md).
- **The fuzz lab** (`src/fuzz/`) — an LLM plays each *human* (expresses wants, decides
  connect/price/clarify); the **real pipeline** is the agent. Disk-cached for reproducibility,
  with a live dashboard (population, deals, agent⇄human conversations, fuzzy edges, token/cost
  meter). `npm run fuzz <N> [help] [refine] [norm] [watch]`.
- **Reproducible harnesses** — expressivity curve (`measure`), bargaining robustness
  (`bargaining`), golden-scenario eval (`eval`), CI-safe matching tests (`npm test`).

## The durable findings

1. **Flatten intent, let the solver price it.** Live agent-to-agent bargaining is reserve-safe
   but leaks information and misses narrow ZOPAs. Deterministic IR-midpoint pricing dominates.
2. **The fuzzy discussion is for *information*, not haggling.** An agent's clarifying questions
   should refine *what's broadcast* (sharpen tags, elicit substitutes/constraints), then let
   the solver re-price. "Refinement, not negotiation."
3. **Multilateral structure is a density story, not an expressivity one.** Barter rings and
   refinement-recoverable substitutes are *built and correct* but fire rarely on realistic
   small populations — the closed coincidence-of-wants loops (rings) and the no-shared-token
   substitutes (refine) simply aren't there. Normalizing tokens didn't unlock rings; the
   bottleneck is population density. The matcher is already good at substitutes *because real
   substitutes usually share a category word* ("road bike"/"hybrid bike"), which it catches.
   → These features earn their keep at **larger scale and with genuinely vague human input**,
   i.e. the live pilot — not in a 30-agent sim.
4. **Most "matching bugs" are token-quality bugs.** A yoga mat matched an iPad on the shared
   adjective `used`; a bulk seller amplified it across the pool. The fix was a **stopword
   filter**, not solver logic. Currency mismatches (£ budget priced in €) lost real deals →
   one canonical unit + symbol. Garbage-in dominates; clean the tokens first.
5. **The human-in-the-loop is a feature, not a fallback.** It rejects solver false-positives
   (a PS4 offered to a PS5 seeker) and LLM hallucinations alike, at zero modeling cost.

## Where it goes next

The lab has served its purpose — the engine is validated and the division of labor is proven.
The open questions are now about **real humans at real density**: do genuinely vague wants make
refinement pay off? does a 50-person group surface rings? what's the messy-input failure mode
the sim can't generate? That's the pilot. See [`PILOT.md`](PILOT.md).
