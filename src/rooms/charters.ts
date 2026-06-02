import type { Charter } from "./charter";

/** Strict commodity room: trust-gated, goods-only, low rate, fast protocols. */
export const sealedBidMarket: Charter = {
  id: "sealed-bid-market",
  etiquette:
    "Post one structured listing/want per item. Goods only. Negotiate via sealed-bid; no chit-chat in the public room. Do not repost.",
  minTrust: 0.5,
  allowedDomains: ["goods."],
  maxSignalsPerWindow: 2,
  windowTicks: 5,
  protocols: ["sealed-bid", "instant-match"],
};

/** Open barter room: anyone, any domain, generous rate, swap/barter protocols. */
export const barterBazaar: Charter = {
  id: "barter-bazaar",
  etiquette:
    "Anything goes — goods, swaps, services, favors. Describe what you have and what you want. Be patient; barter takes rounds.",
  minTrust: 0,
  allowedDomains: undefined,
  maxSignalsPerWindow: 6,
  windowTicks: 5,
  protocols: ["barter", "natural-language", "multi-hop"],
};
