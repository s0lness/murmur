import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

/** What the distiller returns per extracted intent. Mirrors the tool's
 *  input_schema below; Zod is the runtime guard after the tool call returns. */
export const DistilledIntent = z.object({
  kind: z.enum(["seek", "offer", "swap", "barter"]),
  domain: z.string(),
  /** Full descriptors (private — may be finer-grained than publicTags). */
  tags: z.array(z.string()),
  /** The blurred subset that is safe to broadcast. */
  publicTags: z.array(z.string()),
  region: z.string(),
  /** Commerce reserve (private). null when the user named no price. */
  valuation: z.number().nullable(),
  have: z.array(z.string()),
  want: z.array(z.string()),
  confidence: z.number(),
  /** Broadcast now, or hold back as a half-formed ambient want. */
  active: z.boolean(),
  rationale: z.string(),
});
export type DistilledIntent = z.infer<typeof DistilledIntent>;

export const DistillerOutput = z.object({
  intents: z.array(DistilledIntent),
});
export type DistillerOutput = z.infer<typeof DistillerOutput>;

/**
 * JSON Schema for the forced tool call. Structured-output constraints apply:
 * no min/max, no minLength — every object sets additionalProperties:false and
 * lists all keys in `required` (nullable fields use a type union instead of
 * being optional, so the model must always emit them).
 */
export const EMIT_INTENTS_TOOL: Anthropic.Tool = {
  name: "emit_intents",
  description:
    "Emit the structured intents distilled from the user's words. Call exactly once.",
  // strict: true hard-enforces the schema (incl. the kind enum) at the API layer.
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      intents: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: {
              type: "string",
              enum: ["seek", "offer", "swap", "barter"],
              description: "Always one of these four — NOT a domain prefix like 'social'.",
            },
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
          required: [
            "kind", "domain", "tags", "publicTags", "region",
            "valuation", "have", "want", "confidence", "active", "rationale",
          ],
        },
      },
    },
    required: ["intents"],
  },
};
