/**
 * The negotiation menu. A room's charter says which protocols are allowed; a
 * per-deal "Protocol Agreement" picks one. Same two parties can reach the same
 * deal very differently — different message cost and different surplus split.
 *
 * Reserves are private: buyer.max = most they'll pay, seller.min = least they'll
 * take. seller.list is the public asking price.
 */
export interface Buyer { max: number }
export interface Seller { min: number; list: number }

export interface Outcome {
  protocol: string;
  price: number;
  buyerSurplus: number;
  sellerSurplus: number;
  messages: number;
}

const round = (n: number) => Math.round(n);
const split = (protocol: string, price: number, b: Buyer, s: Seller, messages: number): Outcome => ({
  protocol, price, buyerSurplus: b.max - price, sellerSurplus: price - s.min, messages,
});

/** Buyer accepts the asking price outright. One message, but buyer captures no surplus below list. */
export function instantMatch(b: Buyer, s: Seller): Outcome | null {
  return b.max >= s.list ? split("instant-match", s.list, b, s, 1) : null;
}

/** Both reveal reserves at once; if a zone of agreement exists, settle at the midpoint. Two messages, surplus split evenly. */
export function sealedBid(b: Buyer, s: Seller): Outcome | null {
  return b.max >= s.min ? split("sealed-bid", round((b.max + s.min) / 2), b, s, 2) : null;
}

/** Iterative haggling — converges near the midpoint but costs many rounds. */
export function naturalLanguage(b: Buyer, s: Seller): Outcome | null {
  if (b.max < s.min) return null;
  // simulate alternating 40%-of-gap concessions from list↔lowball to count rounds
  let bid = round(b.max * 0.6), ask = s.list;
  let msgs = 0;
  while (ask - bid > 0.05 * b.max && msgs < 12) {
    if (msgs % 2 === 0) ask = round(ask - 0.4 * (ask - bid));
    else bid = round(bid + 0.4 * (ask - bid));
    msgs++;
  }
  return split("natural-language", round((b.max + s.min) / 2), b, s, msgs + 2);
}

const REGISTRY: Record<string, (b: Buyer, s: Seller) => Outcome | null> = {
  "instant-match": instantMatch,
  "sealed-bid": sealedBid,
  "natural-language": naturalLanguage,
};

/** The Protocol Agreement: choose from the room's allowed set, fastest viable first. */
export function agree(allowed: string[], b: Buyer, s: Seller): Outcome | null {
  const order = ["instant-match", "sealed-bid", "natural-language"];
  for (const name of order) {
    if (!allowed.includes(name)) continue;
    const fn = REGISTRY[name];
    const out = fn?.(b, s);
    if (out) return out;
  }
  return null;
}
