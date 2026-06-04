import type { PrivateIntent } from "../core/intent";

/** Raw input to the intake layer: who the user is + what they said. */
export interface PersonaUtterances {
  agentId: string;
  persona: string;
  /** One or more natural-language lines from the user (a journal). */
  utterances: string[];
}

/** The distiller turns words into structured intents. An LLM impl is the real
 *  one; a passthrough impl keeps the hand-authored scenarios/tests working. */
export interface Distiller {
  distill(input: PersonaUtterances): Promise<PrivateIntent[]>;
}
