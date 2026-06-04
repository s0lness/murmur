import type { PersonaUtterances } from "../intake/distiller";

/**
 * Harder than v1. Real matches span easy-literal, synonym, three languages, and
 * pure-abstraction. The traps now share a LITERAL token across two meanings
 * ("glasses" = drinkware vs eyewear; "mouse" = device vs rodent) so the keyword
 * baseline genuinely CAN false-positive - testing precision, not pluralization luck.
 */
export function hardMarket(): PersonaUtterances[] {
  return [
    // ── real matches (ground truth) ───────────────────────────────────────
    // easy literal - keyword should get this
    { agentId: "iphone-seller", persona: "someone in London", utterances: ["selling my iPhone 13, 128gb, works perfectly, no scratches"] },
    { agentId: "iphone-buyer", persona: "someone in Manchester", utterances: ["looking to buy a used iPhone 13"] },

    // synonym + French
    { agentId: "sofa-seller-fr", persona: "someone in Paris", utterances: ["je vends mon grand canapé en cuir marron, très bon état, cause déménagement"] },
    { agentId: "sofa-buyer-en", persona: "someone in Brussels", utterances: ["anyone got a secondhand couch or settee going? furnishing my new flat"] },

    // abstraction - buyer doesn't name the product
    { agentId: "switch-seller", persona: "someone in Berlin", utterances: ["getting rid of my Nintendo Switch, the kids stopped using it"] },
    { agentId: "handheld-buyer", persona: "someone in Hamburg", utterances: ["need a portable thing to keep my son entertained and gaming on long flights"] },

    // French again
    { agentId: "bike-seller", persona: "someone in Amsterdam", utterances: ["selling my road bike, carbon frame, barely ridden"] },
    { agentId: "bike-buyer-fr", persona: "someone in Lyon", utterances: ["je cherche un vélo de course d'occasion, pas trop cher"] },

    // German cross-language
    { agentId: "drill-seller-de", persona: "someone in Munich", utterances: ["verkaufe meine Bohrmaschine, kaum benutzt, funktioniert einwandfrei"] },
    { agentId: "drill-buyer-en", persona: "someone in Dublin", utterances: ["want to buy a power drill for a weekend DIY project"] },

    // abstraction - "keep coffee hot" ⇒ insulated mug
    { agentId: "mug-seller", persona: "someone in Seattle", utterances: ["selling a stainless insulated travel mug, keeps drinks hot for hours"] },
    { agentId: "coffee-buyer", persona: "someone in Portland", utterances: ["want something to stop my coffee going cold at my desk every morning"] },

    // ── keyword traps: shared literal token, different meaning. Must NOT match ──
    { agentId: "wineglass-seller", persona: "someone in Bordeaux", utterances: ["selling a set of crystal wine glasses, never used, still boxed"] },
    { agentId: "specs-buyer", persona: "someone in Nantes", utterances: ["need new prescription glasses, sat on mine and they snapped"] },

    { agentId: "mouse-device-seller", persona: "someone in Oslo", utterances: ["selling a wireless computer mouse and mechanical keyboard"] },
    { agentId: "mouse-pest-buyer", persona: "someone in Bergen", utterances: ["we've got mice in the kitchen, looking for humane traps that actually work"] },

    { agentId: "apple-fruit-seller", persona: "a farm near Tours", utterances: ["selling fresh apples by the crate, straight from our orchard this week"] },
    { agentId: "macbook-buyer", persona: "someone in Paris", utterances: ["looking for a second-hand Apple laptop, a MacBook Air would be ideal"] },

    // pure noise
    { agentId: "noise", persona: "someone", utterances: ["gorgeous sunny morning, finally some good weather after that rain"] },
  ];
}

/** Ground truth: the unordered agent pairs that SHOULD match. The trap pairs
 *  (glasses, mouse, apple) and everything else should NOT. */
export const GROUND_TRUTH: [string, string][] = [
  ["iphone-buyer", "iphone-seller"],
  ["sofa-buyer-en", "sofa-seller-fr"],
  ["handheld-buyer", "switch-seller"],
  ["bike-buyer-fr", "bike-seller"],
  ["drill-buyer-en", "drill-seller-de"],
  ["coffee-buyer", "mug-seller"],
];
