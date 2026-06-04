import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "../core/anthropic";
import { modelId } from "../core/model";
import { cached, cacheKey } from "../intake/cache";

/** A residual intent the deterministic solver left unmatched. */
export interface ResidualIntent {
  id: string;
  who: string; // person's name
  kind: string; // seek | offer | swap | barter
  item: string; // short tag line
  have: string[];
  want: string[];
}

/** One participant's side of a fuzzy match: what they hand over, what they receive. */
export interface Leg { id: string; gives: string; gets: string }

/** A fuzzy match the helper recovered from the residual. Not a settlement —
 *  a proposal that must clear the human gate (the question IS the refinement). */
export interface FuzzyProposal {
  legs: Leg[]; // per-participant give/get so each person sees only their own side
  kind: "barter" | "ring" | "substitute" | "commerce";
  summary: string; // plain who-gives-what-to-whom (for logs)
  question: string; // the clarifying ask that would harden this fuzzy leap
  confidence: number; // 0..1, lower = fuzzier
}

const TOOL: Anthropic.Tool = {
  name: "propose",
  description: "Return fuzzy match proposals over the residual. Call once.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      proposals: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            legs: {
              type: "array",
              description: "one entry per participant; gives/gets are that person's own side of the deal, in plain words",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  id: { type: "string", description: "the participant's intent id" },
                  gives: { type: "string", description: "what THIS person hands over (their have/offer)" },
                  gets: { type: "string", description: "what THIS person receives (their want/seek)" },
                },
                required: ["id", "gives", "gets"],
              },
            },
            kind: { type: "string", enum: ["barter", "ring", "substitute", "commerce"] },
            summary: { type: "string", description: "plain who gives what to whom (one line, for logs)" },
            question: { type: "string", description: "the single clarifying question that would confirm the fuzzy leap (e.g. 'would a hybrid work instead of a road bike?')" },
            confidence: { type: "number", description: "0..1; lower for fuzzier leaps" },
          },
          required: ["legs", "kind", "summary", "question", "confidence"],
        },
      },
    },
    required: ["proposals"],
  },
};

const SYS = `You are a MATCHMAKER agent — a failover that runs only on intents the deterministic solver could NOT match. Your job is recall, not precision: surface plausible deals the rigid solver structurally misses, each as a proposal a human will confirm. The solver already handled every clean match, so do NOT re-propose obvious same-item buy/sell pairs.

Look specifically for what a token/keyword matcher cannot see:
- CROSS-REPRESENTATION BARTER: someone OFFERS X and SEEKS Y, while another OFFERS Y and SEEKS X — an economic swap hidden as four separate commerce intents. Propose it as a 2-party barter.
- RINGS: a closed loop A wants what B has, B wants what C has, C wants what A has — across offer/seek positions, not just explicit swaps. Order ids give→get.
- NEAR-SUBSTITUTES: a seeker whose want is close-but-not-equal to an offer (road bike vs hybrid; "any Zelda" vs a specific Zelda title; iPad vs Android tablet). Propose with a question that asks if the substitute is acceptable.

Hard rules (a bad proposal wastes a human's attention and erodes trust):
- GROUND every leg in stated fields only. Pair an explicit have/offer on one side with an explicit want/seek on the other. NEVER invent a capability or item a person did not state (e.g. do not assume a furniture seller offers assembly, or that "gym sessions" covers "moving help").
- Every participant must RECEIVE something they explicitly want. If a person only wants cash, a barter gives them nothing — do not put them in a barter/ring (money-preferring sellers are not barter candidates).
- Fill legs so each person's "gets" is what THEY want and "gives" is what THEY have. A ring must close: one leg's "gives" is the previous leg's "gets", all the way around. Never write a leg where someone gives away an item that isn't theirs.
- confidence: ~0.8 for a tight cross-rep swap with exact want↔have, ~0.4 for a genuine near-substitute. Below ~0.35, don't propose.
- Most residuals have NO real counterpart. Returning an EMPTY list is the correct, expected outcome — do not manufacture matches to look useful. Quality over quantity.
Call propose once.`;

/** LLM failover matchmaker over the residual. Cached for reproducibility. */
export async function proposeFuzzy(residual: ResidualIntent[]): Promise<FuzzyProposal[]> {
  if (residual.length < 2) return [];
  const key = cacheKey("helper-v2", modelId(), residual);
  const { value } = await cached<FuzzyProposal[]>(key, async () => {
    const res = await anthropic().messages.create({
      model: modelId(), max_tokens: 3000,
      system: [{ type: "text", text: SYS, cache_control: { type: "ephemeral" } }],
      tools: [TOOL], tool_choice: { type: "tool", name: "propose" },
      messages: [{ role: "user", content: JSON.stringify(residual) }],
    });
    if (res.stop_reason === "max_tokens") throw new Error("helper: truncated (raise max_tokens)");
    const b = res.content.find((x) => x.type === "tool_use");
    if (!b || b.type !== "tool_use") throw new Error("helper: no tool call");
    return (b.input as { proposals?: FuzzyProposal[] }).proposals ?? [];
  });
  return value;
}
