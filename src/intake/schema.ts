import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

/** What the distiller returns per extracted intent. */
export const DistilledIntent = z.object({
  kind: z.enum(["seek", "offer", "swap", "barter"]),
  domain: z.string(),
  tags: z.array(z.string()),
  publicTags: z.array(z.string()),
  region: z.string(),
  valuation: z.number().nullable(),
  have: z.array(z.string()),
  want: z.array(z.string()),
  confidence: z.number(),
  active: z.boolean(),
  rationale: z.string(),
});
export type DistilledIntent = z.infer<typeof DistilledIntent>;

export const DistillerOutput = z.object({ intents: z.array(DistilledIntent) });
export type DistillerOutput = z.infer<typeof DistillerOutput>;

/** Reconcile a new message against the user's standing portfolio. */
export const ReconcileOutput = z.object({
  removeIds: z.array(z.string()),
  updates: z.array(z.object({ id: z.string(), valuation: z.number().nullable(), active: z.boolean() })),
  adds: z.array(DistilledIntent),
});
export type ReconcileOutput = z.infer<typeof ReconcileOutput>;

/** Triage a message: update the user's own wants, or relay a question to a match. */
export const RouteOutput = z.object({
  action: z.enum(["portfolio", "ask"]),
  question: z.string(),
});
export type RouteOutput = z.infer<typeof RouteOutput>;

export const ROUTE_TOOL: Anthropic.Tool = {
  name: "route_message",
  description: "Classify the user's message. Call exactly once.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      action: { type: "string", enum: ["portfolio", "ask"], description: "ask = a question to relay to a matched counterpart; portfolio = anything about the user's own wants" },
      question: { type: "string", description: "If action=ask, the question rephrased as a direct question to the counterpart; else empty string." },
    },
    required: ["action", "question"],
  },
};

/** The counterpart agent answers on its user's behalf, or escalates to the human. */
export const AnswerOutput = z.object({ answer: z.string(), escalate: z.boolean() });
export type AnswerOutput = z.infer<typeof AnswerOutput>;

export const ANSWER_TOOL: Anthropic.Tool = {
  name: "answer_or_escalate",
  description: "Answer the counterparty's question on your user's behalf, or escalate to the human. Call once.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      answer: { type: "string", description: "A short answer on the user's behalf if you can; otherwise a brief note." },
      escalate: { type: "boolean", description: "true ONLY if the question needs the human (info you don't have)." },
    },
    required: ["answer", "escalate"],
  },
};

/** JSON Schema for one intent — shared by both tools. additionalProperties:false
 *  and every key in `required` (nullable via type union, never optional). */
const INTENT_ITEM = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: { type: "string", enum: ["seek", "offer", "swap", "barter"], description: "Always one of these four — NOT a domain prefix like 'social'." },
    domain: { type: "string", description: "A dotted taxonomy node, e.g. goods.games" },
    tags: { type: "array", items: { type: "string" } },
    publicTags: { type: "array", items: { type: "string" } },
    region: { type: "string", description: 'Coarse geo like "FR", "FR-75", or "*"' },
    valuation: { type: ["number", "null"] },
    have: { type: "array", items: { type: "string" } },
    want: { type: "array", items: { type: "string" } },
    confidence: { type: "number" },
    active: { type: "boolean" },
    rationale: { type: "string" },
  },
  required: ["kind", "domain", "tags", "publicTags", "region", "valuation", "have", "want", "confidence", "active", "rationale"],
};

export const EMIT_INTENTS_TOOL: Anthropic.Tool = {
  name: "emit_intents",
  description: "Emit the structured intents distilled from the user's words. Call exactly once.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: { intents: { type: "array", items: INTENT_ITEM } },
    required: ["intents"],
  },
};

export const RECONCILE_TOOL: Anthropic.Tool = {
  name: "reconcile_portfolio",
  description: "Reconcile the new message against the user's current intents. Call exactly once.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      removeIds: { type: "array", items: { type: "string" }, description: "ids of current intents this message cancels or contradicts" },
      updates: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: { id: { type: "string" }, valuation: { type: ["number", "null"] }, active: { type: "boolean" } },
          required: ["id", "valuation", "active"],
        },
      },
      adds: { type: "array", items: INTENT_ITEM },
    },
    required: ["removeIds", "updates", "adds"],
  },
};
