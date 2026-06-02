import type { PersonaUtterances } from "./distiller";

/**
 * Stage 1 — single, clean-ish utterances. Tests extraction + the public/private
 * split + round-trip matching, with natural language on BOTH ends and no human
 * structuring the data. The FR switch pair should distill, blur, and match;
 * the iPhone line is pure noise and should never broadcast.
 */
export function ambientMarket(): PersonaUtterances[] {
  return [
    { agentId: "seller-fr", persona: "someone in Paris", utterances: ["selling my old nintendo switch, comes with mario kart, hoping to get around 180€. i'm in the 19th."] },
    { agentId: "buyer-fr", persona: "someone in Lyon", utterances: ["looking for a cheap-ish switch for my kid's birthday, could go up to 240 if it's in good shape"] },
    { agentId: "buyer-de", persona: "someone in Berlin", utterances: ["anyone selling a switch? based in Berlin, can't really travel for it"] },
    { agentId: "seller-us", persona: "someone in New York", utterances: ["offloading a ps5, barely used, want at least $350. NYC pickup."] },
    { agentId: "buyer-us", persona: "someone in the US", utterances: ["been wanting a ps5 forever, finally have ~$430 saved up"] },
    { agentId: "noise-fr", persona: "someone in Paris", utterances: ["ugh my phone screen is so cracked lol"] },
  ];
}

/**
 * Stage 2 — messy multi-line journals: real wants buried in noise, plus one
 * half-formed/conditional want each. Tests segmentation, latent-intent recall,
 * and over-firing restraint (the conditional wants should come back active:false).
 */
export function ambientJournal(): PersonaUtterances[] {
  return [
    {
      agentId: "alice",
      persona: "Alice, lives in NYC",
      utterances: [
        "finally finished that Murakami novel on the train this morning",
        "we're moving next month so I really need to get rid of the grey couch before then, it's barely used",
        "honestly I'd love to be in Berlin in June if some easy apartment-swap thing ever came up",
      ],
    },
    {
      agentId: "bjorn",
      persona: "Björn, lives in Berlin",
      utterances: [
        "rainy week again",
        "thinking about subletting my Berlin place for June and crashing somewhere in New York — would swap if I found the right person",
        "need to return that library book",
      ],
    },
    {
      agentId: "chloe",
      persona: "Chloé, lives in Paris",
      utterances: [
        "great espresso at the new place downstairs",
        "anyone got a spare road bike they're not using? happy to pay something reasonable, mine got stolen",
        "might re-read Dune before the movie, who knows",
      ],
    },
  ];
}

/**
 * Mixed domains so intents route to different room types: priced goods → the
 * sealed-bid market; active apartment swaps → the barter bazaar. Swaps are
 * phrased as definite (not "I'd maybe…") so the distiller marks them active.
 */
export function mixedMarket(): PersonaUtterances[] {
  return [
    { agentId: "switch-seller", persona: "someone in Paris", utterances: ["selling my Nintendo Switch with Mario Kart, looking for around 180€"] },
    { agentId: "switch-buyer", persona: "someone in Lyon", utterances: ["want to buy a used Nintendo Switch, can go up to 240"] },
    { agentId: "alice-nyc", persona: "Alice in New York", utterances: ["I want to swap my New York apartment for a place in Berlin this June"] },
    { agentId: "bjorn-ber", persona: "Björn in Berlin", utterances: ["swapping my Berlin flat for somewhere in New York this June"] },
    { agentId: "chloe-par", persona: "Chloé in Paris", utterances: ["happy to swap my Paris apartment for New York this June"] },
    { agentId: "noise", persona: "someone", utterances: ["lovely weather today, nothing to report"] },
  ];
}
