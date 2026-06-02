import type { PrivateIntent } from "../core/intent";

/** Raw input to the intake layer: who the user is + what they said. */
export interface PersonaUtterances {
  agentId: string;
  persona: string;
  /** One or more natural-language lines from the user (a journal). */
  utterances: string[];
}

/** The distiller turns words into structured intents. M1 ships an LLM impl;
 *  a passthrough impl keeps the hand-authored M0 scenarios/tests working. */
export interface Distiller {
  distill(input: PersonaUtterances): Promise<PrivateIntent[]>;
}
