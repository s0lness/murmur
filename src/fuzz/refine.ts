import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "../core/anthropic";
import { modelId } from "../core/model";
import { record } from "../core/usage";
import { cached, cacheKey } from "../intake/cache";

/** The agent's clarifying move: pick the single most plausible substitute from
 *  the pool and ask the user one question, or decline to ask (candidate ""). */
export interface ClarifyOut { candidate: string; question: string }

const TOOL: Anthropic.Tool = {
  name: "clarify",
  description: "Return one clarifying question + the offer it's about, or none. Call once.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      candidate: { type: "string", description: "id of the offer worth asking about, or \"\" if none is plausible" },
      question: { type: "string", description: "one short question to the user, or \"\" — e.g. 'There's a hybrid bike available — would that work for your commute?'" },
    },
    required: ["candidate", "question"],
  },
};

const SYS = `You are a user's marketplace agent. Their WANT did not match any exact offer. Look at the available offers and decide if ONE is a plausible-enough substitute to be worth a single question to your user (e.g. a hybrid for a road bike, a different-brand tablet, a nearby size). If so, return that offer's id and a short, specific question. If nothing is a reasonable substitute, return candidate "" and question "" — do NOT force a bad suggestion. One question only.`;

export async function agentClarify(want: string, offers: { id: string; item: string }[]): Promise<ClarifyOut> {
  if (!offers.length) return { candidate: "", question: "" };
  const key = cacheKey("clarify-v1", modelId(), want, offers);
  const { value } = await cached<ClarifyOut>(key, async () => {
    const res = await anthropic().messages.create({
      model: modelId(), max_tokens: 300,
      system: [{ type: "text", text: SYS, cache_control: { type: "ephemeral" } }],
      tools: [TOOL], tool_choice: { type: "tool", name: "clarify" },
      messages: [{ role: "user", content: JSON.stringify({ want, offers }) }],
    });
    record(res.usage);
    const b = res.content.find((x) => x.type === "tool_use");
    if (!b || b.type !== "tool_use") throw new Error("clarify: no tool call");
    return b.input as ClarifyOut;
  });
  return value;
}
