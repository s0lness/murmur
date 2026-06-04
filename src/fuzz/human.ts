import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "../core/anthropic";
import { money } from "../core/currency";
import { record } from "../core/usage";
import { modelId } from "../core/model";
import { cached, cacheKey } from "../intake/cache";

async function ask<T>(tool: Anthropic.Tool, sys: string, user: string, tag: string): Promise<T> {
  const key = cacheKey(tag, modelId(), sys, user);
  const { value } = await cached<T>(key, async () => {
    const res = await anthropic().messages.create({
      model: modelId(), max_tokens: 300,
      system: [{ type: "text", text: sys, cache_control: { type: "ephemeral" } }],
      tools: [tool], tool_choice: { type: "tool", name: tool.name },
      messages: [{ role: "user", content: user }],
    });
    record(res.usage);
    const b = res.content.find((x) => x.type === "tool_use");
    if (!b || b.type !== "tool_use") throw new Error(`${tag}: no tool call`);
    return b.input as T;
  });
  return value;
}

const HUMAN_SYS = (brief: string, wants: string[]) =>
  `You are role-playing a real person deciding what their marketplace agent just told them. Stay in character.
Who you are: ${brief}
What you actually want right now:
${wants.map((w) => `- ${w}`).join("\n")}
Decide CONSISTENTLY with these wants. "Connect" is low-stakes - it just means you're interested enough to see the price and details, which come next; only PASS if it clearly isn't one of your wants. Honour your budget at the price step; you may revise, abort, or change your mind like a real person.`;

const CONNECT_TOOL: Anthropic.Tool = {
  name: "decide_match", description: "Connect or pass on this match.", strict: true,
  input_schema: { type: "object", additionalProperties: false, properties: { connect: { type: "boolean" }, reason: { type: "string" } }, required: ["connect", "reason"] },
};
const REFINE_TOOL: Anthropic.Tool = {
  name: "answer_clarify", description: "Answer your agent's clarifying question.", strict: true,
  input_schema: { type: "object", additionalProperties: false, properties: { accept: { type: "boolean" }, reason: { type: "string" } }, required: ["accept", "reason"] },
};
const PRICE_TOOL: Anthropic.Tool = {
  name: "decide_price", description: "Approve, revise, or abort the proposed price.", strict: true,
  input_schema: { type: "object", additionalProperties: false, properties: { action: { type: "string", enum: ["approve", "revise", "abort"] }, newLimit: { type: ["number", "null"] }, reason: { type: "string" } }, required: ["action", "newLimit", "reason"] },
};

interface Who { brief: string; wants: string[] }

export const decideMatch = (p: Who, prompt: string) =>
  ask<{ connect: boolean; reason: string }>(CONNECT_TOOL, HUMAN_SYS(p.brief, p.wants), prompt, "fuzz-match");

export const decideRefine = (p: Who, question: string) =>
  ask<{ accept: boolean; reason: string }>(REFINE_TOOL, HUMAN_SYS(p.brief, p.wants),
    `Your agent asks: "${question}"\nAnswer honestly as yourself - only say yes if it genuinely fits one of your wants; say no if it's not what you actually want.`, "fuzz-refine");

export const decidePrice = (p: Who, item: string, price: number, side: "buy" | "sell") =>
  ask<{ action: "approve" | "revise" | "abort"; newLimit: number | null; reason: string }>(
    PRICE_TOOL, HUMAN_SYS(p.brief, p.wants),
    side === "buy"
      ? `You are the BUYER. A seller will let you BUY "${item}" for ${money(price)} (you pay). Approve, revise (give your new limit), or abort?`
      : `You are the SELLER. A buyer will PAY YOU ${money(price)} for your "${item}" (you receive the money). Approve, revise (give your new limit), or abort?`,
    "fuzz-price",
  );
