# murmur — fuzz run log

Curated record of fuzzy multi-agent sims and what we decided from them.
Setup: an LLM plays each **human** (expresses wants, decides connect/price), the **real murmur pipeline** is the agent (distiller → solver → multilateral → IR-midpoint price). LLM calls are disk-cached for reproducibility. `npm run fuzz <N>`.

---

## Session 1 — 2026-06-04 · N=8 · opus-4-7

Same population across iterations (8 personas, 48% solver coverage / 900 surplus, 1 group-buy candidate, 0 rings). We iterated the **harness**, not the engine, and watched deals climb 0 → 2 → 4 as we removed sim artifacts — leaving only legitimate outcomes.

| iter | change | deals | cleared |
|---|---|---|---|
| a | first run | 0 | 0/8 |
| b | give humans their wants + reframe Connect as low-stakes | 2 | 3/8 |
| c | tell the human their side (buyer/seller) at price step | 4 | 5/8 |

**Findings & decisions:**

1. **Connect-blind kills good matches (harness + real).** Humans passed even on their exact wants (Sam wants a Makita drill, Dev *has* one → Sam passed: *"too vague, no price, no model"*). Two causes: (a) harness bug — the decision only saw the persona's *personality brief*, not their *wants*, so it couldn't reason about its own goals; (b) the match notification carries a blurred signal with no price, so a cautious buyer passes blind. **Decision:** pass the wants into the decision; reframe Connect as low-stakes ("interested enough to see the price, which comes next") — faithful to the real flow (connect → price → approve). → 0→2 deals. *Real-system implication: surface the agent's proposed price / more detail at the match step, or keep Connect explicitly low-commitment.*

2. **Side-blind price step (harness).** Every price-step abort was a seller who thought they were being asked to *buy* (*"I'm selling a drill, not buying one — wrong side"*). The `decidePrice` prompt never stated the role. **Decision:** state the side ("You are the SELLER, a buyer will pay you €X"). → 2→4 deals. *Sim-only artifact; the real bot addresses each party in their own thread.*

3. **Remaining 2 fall-throughs are correct (real, keep).** Dev rejects a PS4 when he wants a PS5; Tom rejects a Kallax when he's offloading furniture. These are **lexical solver false-positives** (token overlap "playstation/console", "ikea") that the human-in-the-loop catches. *Implication: the lab solver's lexical matching is loose; the live bot's semantic LLM judge likely wouldn't propose these. The human veto is a useful last line of defence either way — don't auto-execute.*

4. **3 unmatched people are genuinely unmatchable (real, expected).** Priya (baby monitor — no seller), Lena & Hannah (both *buy* record players — no seller), orphan ticket/bike swaps. No complement exists in the pool; correctly left open. Healthy that the system doesn't force these.

**Net:** the fuzz rig faithfully reproduces the pipeline and is now a clean diagnostic — once harness artifacts are removed, every deal and every non-deal is economically correct. Next: scale to N=20 for emergent multilateral structure (rings need ≥3-cycle density), and watch whether lexical false-positives grow with population.

---

## Session 2 — 2026-06-04 · N=20 · opus-4-7

20 personas: 4 deals (3 commerce + 1 four-person group buy), **8/20 cleared**, coverage 31%, surplus 1050, groups 4, rings 0. Harness now clean — so every fall-through is an *engine* signal, not a sim artifact. Three findings:

1. **Bulk-seller proposal blast (matcher precision, real).** Marcus (12 pairs of men's running shoes, qty≥2) generated pairwise edges to *five* unrelated buyers (Eli, Rosa, Yuki, Maya, Jamal) — all correctly passed (*"not on my list"*). One multi-qty offer sprays low-quality proposals across the population. The human veto holds, but it's noise. **Decision (todo):** a bulk/multi-qty offer should require a genuine demand signal (≥1 buyer who actually wants the item) before the solver proposes it or forms a group — gate group-buys on real overlap, not just qty.

2. **Barter rings still never form (real, expected — and the lever is known).** Swap-rich population (Jamal: Elden Ring→any Zelda; Eli *has* Zelda ToTK; Lena: espresso→bike; Nina: camera barter) but **0 rings**, because independently-distilled `have`/`want` tokens don't align across people ("elden-ring ps4" vs "zelda tears-of-the-kingdom nintendo-switch"; "any Zelda" never tokenises to the seller's title). This is exactly what `src/eval/normalize.ts` (pool canonicaliser) was built for — but the fuzz harness doesn't run it. **Decision (todo):** run `normalizePool` over the fuzz pool before detection and measure whether it unlocks rings. Strong hypothesis: rings are gated by token drift, not by absence of cycles.

3. **Possible double-allocation of a single offer (potential bug — verify).** Sofia's one `concert indie live-music` offer cleared as a deal with **both** Oscar and Camille (both via the no-price path). A single-unit offer should be consumed once. Either `solve()` emitted two trades for the same seller node, or the run loop doesn't track offer consumption. **Decision (todo):** verify node-disjointness on the seller side for qty=1 offers; the no-price auto-deal path is the likely culprit (bypasses any gating).

**Net:** at scale the harness shifts from debugging the *sim* to debugging the *engine*. The three findings are real product/solver issues, with #2 (normalize → rings) the highest-value next experiment.

---

## Session 3 — 2026-06-04 · N=20 · opus-4-7 · ring experiment

Tested finding #2 (does pool normalization unlock barter rings?) and verified the ring pathway end-to-end.

- **`norm` (normalize the pool before detection): rings still 0.** Metrics essentially unchanged (surplus 1050→1090, minor reallocation). **Hypothesis #2 falsified — token drift was not the blocker.**
- **`ring` (inject a deterministic A→B→C→A 3-way swap) + `norm`: the ring fired and settled.** Detected by `barterCycles`, and all three LLM-humans voted to join → 1 ring deal. **The ring pathway (detect → vote → settle) works end-to-end.**

**Root cause of organic ring scarcity (resolved): representation, not drift.** `barterCycles` only considers intents with `kind === "swap" | "barter"` (have/want graph). But the population's barterable positions are mostly distilled into *separate* `seek` + `offer` commerce intents — e.g. Eli *offers* Zelda and *seeks* a guitar (an economic barter leg) becomes two commerce intents the detector never sees. Only explicit "swap X for Y" utterances enter the cycle graph, and a small random population rarely contains a closed coincidence-of-wants loop among just those.

**Decision / next lever:** generalize `barterCycles` to derive edges from `offer`(≈have) / `seek`(≈want), not only explicit swaps — the group-buy ↔ barter unification. This would let commerce positions participate in cycle detection and surface latent multilateral structure. *Caveat for the live bot:* where liquidity exists, a 2-party commerce match (or money) usually dominates a ring; gate derived rings to cases with no simpler bilateral/coverage settlement, else they're noise. Not yet built — flagged as the highest-value engine change.

Harness flags now: `npm run fuzz <N> [ring] [norm]`.

---

## Session 4 — 2026-06-04 · helper failover (LLM matchmaker on the residual)

Built `src/solver/helper.ts` — an LLM matchmaker that runs **only on intents the deterministic solver left unmatched** and proposes fuzzy candidates (cross-representation barter, rings, near-substitutes) it structurally can't see. Proposals are **not settlements**: each carries per-participant legs + a clarifying question and must clear the same human gate. Flag `help`. Tested on N=20 organic and an N=8 planted lexical-gap ring (`cring`: PS5→bike→camera→PS5, where "games console"≠"ps5" by word overlap so `barterCycles` can't close it).

**Findings:**

1. **The human gate is a robust safety net (validated).** Across ~14 proposals over both runs, **0 bad proposals leaked** — every hallucinated/ill-fitting match was caught. Confirms "proposals, not settlements, behind a human confirm" is the right, safe design for a fuzzy failover.

2. **On a realistic residual, recall yield is ~0 — and that's mostly correct.** N=20: 9 proposals, 0 recovered. The residual is dominated by **cash-preferring sellers** (Tom selling a bike to fund a Garmin; Beatrice downsizing for cash) and **orphan wants with no counterpart**. Barter proposals to a liquidity-preferring seller give them nothing they want → correctly rejected (Jevons: money dominates barter when the counterparty wants cash). A fuzzy failover cannot manufacture liquidity or counterparties.

3. **Helper over-reached → tightened.** Early version invented capabilities ("furniture seller will help assemble", routed a wrong participant into a trade). Tightened the prompt to ground every leg in stated fields, require each participant *receive* a stated want, and treat an empty list as the correct default. Cut the obvious hallucinations.

4. **Pure-LLM multi-party assembly is unreliable (key architectural finding).** On the planted `cring`, the helper's **recall succeeded** — it found the ring and bridged the lexical gap (understood PS5 ≈ games console, which `barterCycles` cannot). But it **assembled the legs wrong**: gave Jo a road bike when she wants a console, and conflated two bike-owners (Ivy vs Hannah) in the residual. LLMs are bad at the multi-hop bookkeeping of who-gives-what across near-duplicate items. 2-party fuzzy matches assemble fine; 3+-party rings scramble.

**Decision / architecture:** don't have the LLM *build* the whole match. Split the labor the way everything else in murmur splits:
- **LLM = fuzzy-edge oracle.** It emits semantic equivalences over residual tokens ("ps5 ≈ games console", "road bike ≈ commuter — with a confirm question"), augmenting the token graph. Good at equivalence, bad at bookkeeping.
- **Deterministic `barterCycles`/solver = combinatorial engine.** It finds cycles/matches over the *augmented* graph. Reliable graph algorithm, no hallucinated legs.
- **Human gate = confirm.** Unchanged.

This makes the helper a *graph augmenter*, not a *match builder* — and folds the group-buy↔barter unification in naturally (the same augmented graph feeds both). Highest-value next build. The current pure-LLM helper stays as a baseline to measure the hybrid against.

Harness flags now: `npm run fuzz <N> [ring] [cring] [norm] [help]`.

---

## Session 5 — 2026-06-04 · hybrid helper (LLM edges → deterministic close)

Built the architecture decided in Session 4. `help` now runs the **hybrid**:
1. **LLM = fuzzy-edge oracle** (`proposeEdges`): over the residual, emit semantic equivalences a keyword matcher misses ("ps5"⇄"games console", "road bike"⇄"commuter bike"), each with a confidence and a confirm question when it's a real substitute. It does NOT build matches.
2. **`buildAliases` (union-find)** turns edges into a token rewrite (each equivalence class → one canonical token).
3. **Deterministic close**: rewrite the residual's tags/have/want, then run the unchanged `barterCycles` + `solve` over the augmented graph. Cycles/matches are assembled by the reliable graph algorithm, framed back in ORIGINAL terms.
4. **Human gate** confirms (per-leg for rings, per-side for subs), carrying the confirm question.

**Result — the hybrid fixes Session 4's failure:**

| scenario | pure-LLM helper (S4) | hybrid (S5) |
|---|---|---|
| planted lexical-gap ring (`cring`) | found it but **scrambled the legs** → 0 recovered | **recovered cleanly → 1** ✓ |
| organic N=20 residual | 9 proposals, hallucinated, 0 recovered | 12 edges, **0 false deals**, 0 recovered |

- **`cring help`:** the PS5→bike→camera→PS5 ring (which `barterCycles` can't see because "games console"≠"ps5" by word overlap) is now **recovered** — all three no-cash swappers accept. The deterministic close gets the who-gives-what right, which the pure-LLM assembly could not. The gate still caught a degenerate 4-cycle (Hannah giving a road bike to *get* a road bike — rejected).
- **`20 help`:** 12 fuzzy edges proposed but **0 cycles close** and the 1 substitute attempt is (correctly) declined. No hallucinated deals reach the gate. This **re-confirms Session 4's structural finding from the other direction**: with representation/token-drift removed as an excuse, the organic residual *still* has no closeable multilateral structure — the bottleneck is genuinely population density, not expressivity.

**Net / decision:** the oracle/solver split holds yet again — LLM for fuzzy equivalence (recall), deterministic engine for combinatorial assembly (precision), human for confirm (safety). This is the shape to port to the live bot's settle loop: run it as a failover only on the unmatched residual, surface recoveries as confirm-questions, never auto-settle. The pure-LLM `proposeFuzzy` stays in the tree as the measured baseline. Group-buy↔barter unification falls out for free (same augmented graph feeds both detectors). Open item: rings need population density to appear organically — worth a larger-N or barter-seeded run to quantify the yield curve.

Harness flags now: `npm run fuzz <N> [ring] [cring] [norm] [help]` (help = hybrid).
