import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "../core/anthropic";
import { modelId } from "../core/model";
import { record } from "../core/usage";
import { cached, cacheKey } from "../intake/cache";

export interface NormIn { id: string; kind: string; domain: string; tags: string[]; have: string[]; want: string[] }
export interface NormOut { id: string; domain: string; tags: string[]; have: string[]; want: string[] }

const TOOL: Anthropic.Tool = {
  name: "normalize_pool",
  description: "Return canonicalized fields for every item. Call once.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            domain: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
            have: { type: "array", items: { type: "string" } },
            want: { type: "array", items: { type: "string" } },
          },
          required: ["id", "domain", "tags", "have", "want"],
        },
      },
    },
    required: ["items"],
  },
};

const SYS = `You are a consistency normalizer for a matching market. You receive a batch of items (buy/sell/swap intents). Different agents described the SAME things inconsistently. Rewrite ONLY for consistency so matching works:
- Give the SAME \`domain\` to the same kind of item regardless of buy/sell/swap (a concert ticket is the same domain for the seller and every buyer).
- Use the SAME plain token for the same item across agents, so a \`have\` on one side equals a \`want\` on the other ("forza", "spider-man" — never "ps5:forza" on one side and "forza" on the other; never "tickets" vs "ticket").
Keep meaning identical; do not invent or drop items. Return every item. Call normalize_pool once.`;

/** Auto-repair: canonicalize domains + item tokens across the pool so the
 *  detectors can connect what the distiller described inconsistently. */
export async function normalizePool(items: NormIn[]): Promise<Map<string, NormOut>> {
  const key = cacheKey("normalize-v1", modelId(), items);
  const { value } = await cached<NormOut[]>(key, async () => {
    const res = await anthropic().messages.create({
      model: modelId(), max_tokens: 8000,
      system: [{ type: "text", text: SYS, cache_control: { type: "ephemeral" } }],
      tools: [TOOL], tool_choice: { type: "tool", name: "normalize_pool" },
      messages: [{ role: "user", content: JSON.stringify(items) }],
    });
    record(res.usage);
    if (res.stop_reason === "max_tokens") throw new Error("normalize: truncated (raise max_tokens)");
    const b = res.content.find((x) => x.type === "tool_use");
    if (!b || b.type !== "tool_use") throw new Error("normalize: no tool call");
    const items2 = (b.input as { items?: NormOut[] }).items;
    if (!items2?.length) throw new Error("normalize: empty result");
    return items2;
  });
  return new Map(value.map((o) => [o.id, o]));
}
