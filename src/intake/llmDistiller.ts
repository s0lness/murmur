import Anthropic from "@anthropic-ai/sdk";
import type { PrivateIntent } from "../core/intent";
import { modelId } from "../core/model";
import { record } from "../core/usage";
import { cached, cacheKey } from "./cache";
import type { Distiller, PersonaUtterances } from "./distiller";
import { SYSTEM_PROMPT, SYSTEM_PROMPT_ANSWER, SYSTEM_PROMPT_RECONCILE, SYSTEM_PROMPT_ROUTER } from "./prompt";
import { ANSWER_TOOL, AnswerOutput, DistillerOutput, type DistilledIntent, EMIT_INTENTS_TOOL, RECONCILE_TOOL, ReconcileOutput, ROUTE_TOOL, RouteOutput } from "./schema";

/**
 * Distills natural-language utterances into structured PrivateIntents via a
 * forced tool call (most version-robust structured-output path), validated with
 * Zod. The big static prompt + tool schema form the cached prefix; only the
 * per-agent utterance varies, so it lands after the cache breakpoint.
 */
export class LLMDistiller implements Distiller {
  private _client?: Anthropic;
  private system: string;
  private cacheTag: string;

  constructor(opts: { client?: Anthropic; system?: string; cacheTag?: string } = {}) {
    // Reads ANTHROPIC_API_KEY from the environment. Never hardcode the key.
    this._client = opts.client;
    this.system = opts.system ?? SYSTEM_PROMPT;
    this.cacheTag = opts.cacheTag ?? "normalized";
  }
  // Lazy: build after .env is loaded, so import order can't strand the key.
  private client(): Anthropic {
    return (this._client ??= new Anthropic());
  }

  async distill(input: PersonaUtterances): Promise<PrivateIntent[]> {
    const userText = input.utterances.map((u) => `- ${u}`).join("\n");

    // Disk-cached so the same words always distill the same way (reproducibility).
    const key = cacheKey("distill-v2", this.cacheTag, modelId(), this.system, input.persona, input.utterances);
    const { value: intents } = await cached<DistilledIntent[]>(key, async () => {
      const response = await this.client().messages.create({
        model: modelId(),
        max_tokens: 4096,
        system: [
          // cache_control on the last (only) system block → caches tools + system.
          { type: "text", text: this.system, cache_control: { type: "ephemeral" } },
        ],
        tools: [EMIT_INTENTS_TOOL],
        tool_choice: { type: "tool", name: EMIT_INTENTS_TOOL.name },
        messages: [{ role: "user", content: `The user (${input.persona}) said:\n${userText}` }],
      });
      record(response.usage);
      record(response.usage);
    const block = response.content.find((b) => b.type === "tool_use");
      if (!block || block.type !== "tool_use") {
        throw new Error(`distiller: model did not call ${EMIT_INTENTS_TOOL.name}`);
      }
      return DistillerOutput.parse(block.input).intents;
    });

    const sourceText = input.utterances.join(" / ");
    return intents.map((d, i) => toIntent(d, `${input.agentId}-i${i}`, sourceText));
  }

  /** Counterpart agent: answer the question on the user's behalf, or escalate. */
  async answer(question: string, userContext: string): Promise<AnswerOutput> {
    const response = await this.client().messages.create({
      model: modelId(),
      max_tokens: 512,
      system: [{ type: "text", text: SYSTEM_PROMPT_ANSWER, cache_control: { type: "ephemeral" } }],
      tools: [ANSWER_TOOL],
      tool_choice: { type: "tool", name: ANSWER_TOOL.name },
      messages: [{ role: "user", content: `Your user: ${userContext}\n\nThe other party asks: "${question}"` }],
    });
    record(response.usage);
    const block = response.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") throw new Error("answer: no tool call");
    return AnswerOutput.parse(block.input);
  }

  /** Triage a message: a portfolio update, or a question to relay to a match. */
  async route(message: string, matchSummary: string): Promise<RouteOutput> {
    const response = await this.client().messages.create({
      model: modelId(),
      max_tokens: 512,
      system: [{ type: "text", text: SYSTEM_PROMPT_ROUTER, cache_control: { type: "ephemeral" } }],
      tools: [ROUTE_TOOL],
      tool_choice: { type: "tool", name: ROUTE_TOOL.name },
      messages: [{ role: "user", content: `Active match: ${matchSummary}\n\nMessage: "${message}"` }],
    });
    record(response.usage);
    const block = response.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") throw new Error("route: no tool call");
    return RouteOutput.parse(block.input);
  }

  /**
   * Reconcile a new message against the user's standing portfolio: returns
   * intents to remove, updates, and brand-new adds - so corrections replace
   * instead of piling up. Not cached (it's interactive, per-user state).
   */
  async reconcile(
    existing: { id: string; kind: string; domain: string; tags: string[]; valuation: number | null; active: boolean }[],
    persona: string,
    utterance: string,
  ): Promise<{ removeIds: string[]; updates: { id: string; valuation: number | null; active: boolean }[]; adds: PrivateIntent[] }> {
    const response = await this.client().messages.create({
      model: modelId(),
      max_tokens: 4096,
      system: [{ type: "text", text: SYSTEM_PROMPT_RECONCILE, cache_control: { type: "ephemeral" } }],
      tools: [RECONCILE_TOOL],
      tool_choice: { type: "tool", name: RECONCILE_TOOL.name },
      messages: [{
        role: "user",
        content: `Current intents (JSON):\n${JSON.stringify(existing)}\n\nNew message from ${persona}: "${utterance}"`,
      }],
    });
    record(response.usage);
    const block = response.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") throw new Error("reconcile: no tool call");
    const out = ReconcileOutput.parse(block.input);
    return {
      removeIds: out.removeIds,
      updates: out.updates,
      adds: out.adds.map((d, i) => toIntent(d, `add-${i}`, utterance)),
    };
  }
}

function toIntent(d: DistilledIntent, id: string, source: string): PrivateIntent {
  return {
    id,
    kind: d.kind,
    domain: d.domain,
    tags: d.tags,
    publicTags: d.publicTags,
    region: d.region,
    qty: d.qty,
    valuation: d.valuation ?? undefined,
    fallback: d.fallback ?? undefined,
    substitutes: d.substitutes.length ? d.substitutes : undefined,
    have: d.have.length ? d.have : undefined,
    want: d.want.length ? d.want : undefined,
    source,
    confidence: d.confidence,
    active: d.active,
    rationale: d.rationale,
  };
}
