import Anthropic from "@anthropic-ai/sdk";
import { blur, type PrivateIntent } from "../core/intent";
import { modelId } from "../core/model";
import { cached, cacheKey } from "../intake/cache";

/** One verdict per candidate signal. */
export interface Verdict {
  signalId: string;
  relevant: boolean;
  score: number;
  reason: string;
  /** If a single missing detail decides a plausible match, a question to ask
   *  the user; "" otherwise. */
  clarify: string;
}

const JUDGE_TOOL: Anthropic.Tool = {
  name: "judge_relevance",
  description: "Return a relevance verdict for every candidate signal.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      matches: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            signalId: { type: "string" },
            relevant: { type: "boolean" },
            score: { type: "number" },
            reason: { type: "string" },
            clarify: { type: "string", description: "A short question if one detail decides a plausible match; else empty string." },
          },
          required: ["signalId", "relevant", "score", "reason", "clarify"],
        },
      },
    },
    required: ["matches"],
  },
};

const SYSTEM = `You are the matching brain of a personal agent in an ambient-intent network.

Your user has a private WANT. You overhear BLURRED public signals other agents broadcast (category, tags, region — never price or identity). Decide which signals are genuinely relevant to your user's want.

Be robust where keyword matching fails:
- SYNONYMS / paraphrase: "couch" = "sofa" = "settee" = "canapé".
- LANGUAGE: a French "vélo de course" matches an English "road bike".
- ABSTRACTION: a "Nintendo Switch" satisfies "a portable thing the kids can game on".

But REJECT coincidental keyword overlap that isn't a real match:
- "apple" the fruit is NOT an "Apple" laptop.
- a couch for sale is NOT "couch-surfing" / a place to crash.

A real match also needs the complementary side (a seeker wants what an offer provides) and a plausible region. Score 0–1; mark relevant=true only when you'd actually open a negotiation. Return a verdict for EVERY candidate.

CLARIFY: if a candidate is a plausible match but ONE missing detail decides it (e.g. "Switch" vs "Switch 2", a size, a date window, condition), set relevant=false, score in 0.4–0.6, and \`clarify\` to ONE short question whose answer would resolve it — phrased to ask YOUR user (e.g. "Do you mean the original Switch or the Switch 2?"). For confirmed matches and clear non-matches, leave \`clarify\` empty.`;

/**
 * murmur's semantic matcher. The agent matches its OWN private want against the
 * BLURRED public signals of others — so the privacy split holds (it never sees
 * anyone else's private fields). Disk-cached for reproducibility.
 */
export class SemanticMatcher {
  private _client?: Anthropic;
  constructor(client?: Anthropic) {
    this._client = client;
  }
  // Lazy: build the client on first use, after env (.env) is loaded — so a
  // module-level `new SemanticMatcher()` can't capture a missing API key.
  private client(): Anthropic {
    return (this._client ??= new Anthropic());
  }

  async judge(seeker: PrivateIntent, candidates: PrivateIntent[]): Promise<Verdict[]> {
    // Candidates are reduced to their public blur — the privacy boundary.
    const signals = candidates.map((c) => {
      const s = blur(c, c.id);
      return { id: s.id, kind: s.kind, domain: s.domain, tags: s.tags, region: s.region };
    });
    // Guard: assert nothing private leaked into the matcher's input.
    if (/valuation|reserve/i.test(JSON.stringify(signals))) {
      throw new Error("privacy violation: private field reached the semantic matcher");
    }

    const myWant = {
      kind: seeker.kind,
      domain: seeker.domain,
      tags: seeker.tags,
      want: seeker.want ?? [],
    };

    const key = cacheKey("match-v2", modelId(), SYSTEM, myWant, signals);
    const { value } = await cached<Verdict[]>(key, async () => {
      const response = await this.client().messages.create({
        model: modelId(),
        max_tokens: 2048,
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        tools: [JUDGE_TOOL],
        tool_choice: { type: "tool", name: JUDGE_TOOL.name },
        messages: [
          {
            role: "user",
            content:
              `MY WANT (private):\n${JSON.stringify(myWant)}\n\n` +
              `CANDIDATE SIGNALS (blurred, public):\n${JSON.stringify(signals, null, 1)}`,
          },
        ],
      });
      const block = response.content.find((b) => b.type === "tool_use");
      if (!block || block.type !== "tool_use") throw new Error("semantic matcher: no tool call");
      return (block.input as { matches: Verdict[] }).matches;
    });
    return value;
  }
}
