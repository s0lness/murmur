import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "../core/anthropic";
import { modelId } from "../core/model";
import { record } from "../core/usage";
import { cached, cacheKey } from "../intake/cache";

export interface Persona { id: string; name: string; brief: string; wants: string[] }

const TOOL: Anthropic.Tool = {
  name: "people",
  description: "Return the generated people. Call once.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      people: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            brief: { type: "string", description: "1-2 sentences: who they are + their situation/personality (incl. how decisive/picky they are)." },
            wants: { type: "array", items: { type: "string" }, description: "1-3 concrete wants in their own casual words - buy/sell/swap/find, with rough budget/constraints where natural." },
          },
          required: ["name", "brief", "wants"],
        },
      },
    },
    required: ["people"],
  },
};

const SYS = `Generate diverse, realistic people for a small local marketplace simulation (a friend group / neighbourhood). Each has a short brief and 1-3 concrete wants - things to buy, sell, swap, lend, or find - in their own casual words, with rough budgets/constraints where natural.
- Mix categories: electronics, games, furniture, bikes, tickets, clothes, small services, plus a couple of pure swaps/barters and one bulk seller (e.g. several of an item).
- Engineer the population so SOME wants complement each other across people (a seller for a buyer, a swap that closes a ring) and some don't - a realistic mix, not all-matchable.
- Vary personality: some decisive, some picky/price-sensitive, some who'd haggle or change their mind.
- State ALL prices/budgets in US dollars ($).
- Include a few people whose wants are FLEXIBLE or vaguely-worded (e.g. "a bike to get around the city", "some kind of tablet", "a desk, not fussy") so a clarifying question could unlock a near-substitute match - alongside some who are very specific/picky.
Call people once.`;

export async function makePersonas(n: number): Promise<Persona[]> {
  const key = cacheKey("personas-v2", modelId(), n);
  const { value } = await cached<{ name: string; brief: string; wants: string[] }[]>(key, async () => {
    const res = await anthropic().messages.create({
      model: modelId(), max_tokens: 4000,
      system: [{ type: "text", text: SYS, cache_control: { type: "ephemeral" } }],
      tools: [TOOL], tool_choice: { type: "tool", name: "people" },
      messages: [{ role: "user", content: `Generate exactly ${n} people.` }],
    });
    record(res.usage);
    const b = res.content.find((x) => x.type === "tool_use");
    if (!b || b.type !== "tool_use") throw new Error("personas: no tool call");
    return (b.input as { people: { name: string; brief: string; wants: string[] }[] }).people;
  });
  return value.slice(0, n).map((p, i) => ({ id: `u${i + 1}`, ...p }));
}
