import Anthropic from "@anthropic-ai/sdk";
import type { PrivateIntent } from "../core/intent";
import { cached, cacheKey } from "./cache";
import type { Distiller, PersonaUtterances } from "./distiller";
import { SYSTEM_PROMPT } from "./prompt";
import { DistillerOutput, type DistilledIntent, EMIT_INTENTS_TOOL } from "./schema";

const MODEL = "claude-opus-4-8";

/**
 * Distills natural-language utterances into structured PrivateIntents via a
 * forced tool call (most version-robust structured-output path), validated with
 * Zod. The big static prompt + tool schema form the cached prefix; only the
 * per-agent utterance varies, so it lands after the cache breakpoint.
 */
export class LLMDistiller implements Distiller {
  private client: Anthropic;
  private system: string;
  private cacheTag: string;

  constructor(opts: { client?: Anthropic; system?: string; cacheTag?: string } = {}) {
    // Reads ANTHROPIC_API_KEY from the environment. Never hardcode the key.
    this.client = opts.client ?? new Anthropic();
    this.system = opts.system ?? SYSTEM_PROMPT;
    this.cacheTag = opts.cacheTag ?? "normalized";
  }

  async distill(input: PersonaUtterances): Promise<PrivateIntent[]> {
    const userText = input.utterances.map((u) => `- ${u}`).join("\n");

    // Disk-cached so the same words always distill the same way (reproducibility).
    const key = cacheKey("distill-v2", this.cacheTag, MODEL, this.system, input.persona, input.utterances);
    const { value: intents } = await cached<DistilledIntent[]>(key, async () => {
      const response = await this.client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: [
          // cache_control on the last (only) system block → caches tools + system.
          { type: "text", text: this.system, cache_control: { type: "ephemeral" } },
        ],
        tools: [EMIT_INTENTS_TOOL],
        tool_choice: { type: "tool", name: EMIT_INTENTS_TOOL.name },
        messages: [{ role: "user", content: `The user (${input.persona}) said:\n${userText}` }],
      });
      const block = response.content.find((b) => b.type === "tool_use");
      if (!block || block.type !== "tool_use") {
        throw new Error(`distiller: model did not call ${EMIT_INTENTS_TOOL.name}`);
      }
      return DistillerOutput.parse(block.input).intents;
    });

    const sourceText = input.utterances.join(" / ");

    return intents.map((d, i): PrivateIntent => ({
      id: `${input.agentId}-i${i}`,
      kind: d.kind,
      domain: d.domain,
      tags: d.tags,
      publicTags: d.publicTags,
      region: d.region,
      valuation: d.valuation ?? undefined,
      have: d.have.length ? d.have : undefined,
      want: d.want.length ? d.want : undefined,
      source: sourceText,
      confidence: d.confidence,
      active: d.active,
      rationale: d.rationale,
    }));
  }
}
