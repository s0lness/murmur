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
