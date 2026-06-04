import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "../core/anthropic";
import { modelId } from "../core/model";
import { record } from "../core/usage";
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

// ── hybrid: LLM emits fuzzy edges, the deterministic detector closes the loops ──

/** A semantic equivalence the keyword matcher misses: token `a` (someone HAS)
 *  is substitutable for token `b` (someone WANTS). question != "" when the
 *  substitution is a genuine leap that needs the receiver's buy-in. */
export interface FuzzyEdge { a: string; b: string; confidence: number; question: string }

const EDGE_TOOL: Anthropic.Tool = {
  name: "edges",
  description: "Return fuzzy-equivalence edges over residual tokens. Call once.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      edges: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            a: { type: "string", description: "exact token one side HAS/OFFERS" },
            b: { type: "string", description: "exact token another side WANTS/SEEKS, substitutable for a" },
            confidence: { type: "number", description: "0..1; ~0.9 same-thing-worded-differently, ~0.5 genuine substitute" },
            question: { type: "string", description: "confirm question if the substitution needs buy-in, else empty" },
          },
          required: ["a", "b", "confidence", "question"],
        },
      },
    },
    required: ["edges"],
  },
};

const EDGE_SYS = `You are a FUZZY-EQUIVALENCE ORACLE. You are NOT building deals — a deterministic engine does that. Your only job: spot pairs of item tokens that a keyword matcher would treat as different but that actually refer to substitutable things, where one token appears on a HAVE/OFFER side and the other on a WANT/SEEK side of the residual.

Examples of edges to emit: "ps5" ⇄ "games console"; "road bike" ⇄ "commuter bike"; "mirrorless camera" ⇄ "camera"; "ikea kallax" ⇄ "shelving".

Rules:
- a must be something a person HAS/OFFERS; b something a (different) person WANTS/SEEKS. Use EXACT token strings from the input.
- confidence ~0.9 + empty question when they're the same thing worded differently (ps5 IS a games console). confidence ~0.5 + a short confirm question when it's a real substitute someone might decline ("would a road bike work as a commuter?").
- Only link genuinely substitutable items. Do NOT link unrelated things. If there are none, return an empty list.
Call edges once.`;

/** LLM fuzzy-edge oracle over the residual. Cached. The deterministic detector
 *  then closes cycles/matches over the token-augmented graph. */
export async function proposeEdges(residual: ResidualIntent[]): Promise<FuzzyEdge[]> {
  if (residual.length < 2) return [];
  const key = cacheKey("edges-v1", modelId(), residual);
  const { value } = await cached<FuzzyEdge[]>(key, async () => {
    const res = await anthropic().messages.create({
      model: modelId(), max_tokens: 2000,
      system: [{ type: "text", text: EDGE_SYS, cache_control: { type: "ephemeral" } }],
      tools: [EDGE_TOOL], tool_choice: { type: "tool", name: "edges" },
      messages: [{ role: "user", content: JSON.stringify(residual) }],
    });
    record(res.usage);
    if (res.stop_reason === "max_tokens") throw new Error("edges: truncated (raise max_tokens)");
    const b = res.content.find((x) => x.type === "tool_use");
    if (!b || b.type !== "tool_use") throw new Error("edges: no tool call");
    return (b.input as { edges?: FuzzyEdge[] }).edges ?? [];
  });
  return value;
}

/** Union-find over fuzzy edges → a token-rewrite that maps every member of an
 *  equivalence class to one canonical token, plus the confirm question (if any)
 *  attached to each class. Feed canon() over have/want/tags, then run the
 *  deterministic detector: equivalent tokens now collide and cycles close. */
export function buildAliases(edges: FuzzyEdge[]): { canon: (t: string) => string; questionFor: (t: string) => string } {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const union = (x: string, y: string) => { parent.set(find(x), find(y)); };
  const q = new Map<string, string>();
  for (const e of edges) { union(e.a, e.b); if (e.question) { q.set(e.a, e.question); q.set(e.b, e.question); } }
  const canon = (t: string) => (parent.has(t) ? find(t) : t);
  const questionFor = (t: string) => {
    for (const [tok, question] of q) if (canon(tok) === canon(t)) return question;
    return "";
  };
  return { canon, questionFor };
}

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
    record(res.usage);
    if (res.stop_reason === "max_tokens") throw new Error("helper: truncated (raise max_tokens)");
    const b = res.content.find((x) => x.type === "tool_use");
    if (!b || b.type !== "tool_use") throw new Error("helper: no tool call");
    return (b.input as { proposals?: FuzzyProposal[] }).proposals ?? [];
  });
  return value;
}
