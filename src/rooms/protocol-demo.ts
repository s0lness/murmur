import { agree, type Buyer, type Seller } from "../negotiate/protocols";

/** Same deals, three rooms with different allowed protocols → different outcomes. */
const rooms = [
  { id: "fast-market", allowed: ["instant-match", "sealed-bid"] },
  { id: "fair-market", allowed: ["sealed-bid"] },
  { id: "bazaar", allowed: ["natural-language"] },
];

const deals: { item: string; buyer: Buyer; seller: Seller }[] = [
  { item: "switch", buyer: { max: 240 }, seller: { min: 180, list: 220 } },
  { item: "ps5", buyer: { max: 430 }, seller: { min: 350, list: 460 } },
];

console.log("\n▶ protocol menu — same pairs, different rooms\n");
for (const r of rooms) {
  console.log(`─ room: ${r.id}   (allows: ${r.allowed.join(", ")}) ─`);
  for (const d of deals) {
    const o = agree(r.allowed, d.buyer, d.seller);
    if (!o) {
      console.log(`  ${d.item.padEnd(7)} no deal`);
      continue;
    }
    console.log(
      `  ${d.item.padEnd(7)} ${o.protocol.padEnd(16)} @ ${String(o.price).padStart(3)}` +
        `   buyer +${o.buyerSurplus}  seller +${o.sellerSurplus}   ${o.messages} msg`,
    );
  }
  console.log("");
}
console.log("note: fast-market's instant-match is 1 message but the buyer overpays to list;");
console.log("fair-market's sealed-bid splits the surplus evenly in 2; the bazaar's haggle");
console.log("reaches the same price as sealed-bid but burns many more messages.\n");
