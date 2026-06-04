import Anthropic from "@anthropic-ai/sdk";
import { modelId } from "../core/model";
import { record } from "../core/usage";
import { cached, cacheKey } from "../intake/cache";
import { loadDotenv } from "../intake/env";

loadDotenv();
if (!process.env.ANTHROPIC_API_KEY) { console.error("ANTHROPIC_API_KEY not set."); process.exit(1); }

const client = new Anthropic();

interface Turn { role: "buyer" | "seller"; action: "offer" | "accept" | "walk"; price?: number; message: string }
interface Move { action: "offer" | "accept" | "walk"; price: number; message: string }

const MOVE_TOOL: Anthropic.Tool = {
  name: "negotiate_move",
  description: "Your next move in the negotiation. Call exactly once.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      action: { type: "string", enum: ["offer", "accept", "walk"] },
      price: { type: "number", description: "Your offer price (for action=offer); for accept/walk echo the price on the table or 0." },
      message: { type: "string", description: "One short line to the other agent." },
    },
    required: ["action", "price", "message"],
  },
};

const sys = (role: "buyer" | "seller", limit: number, fallback: number | null) =>
  `You are an automated negotiation agent acting ON BEHALF of your user, the ${role}.
Your user's strict private limit: ${role === "buyer" ? `do NOT pay more than €${limit}` : `do NOT accept less than €${limit}`}. Honour it absolutely — agreeing beyond it harms your user.${
    fallback != null ? `\nYour user can get an equivalent deal elsewhere for €${fallback} (their fallback) — a deal here must beat that.` : ""
  }
You do NOT know the other side's limit. Each turn: make an offer, accept the other side's last offer if it is good for your user, or walk away if no agreement seems reachable in a few rounds. Get a good price but close when it is favourable. Do NOT state your exact private limit number. Call negotiate_move once.`;

const render = (transcript: Turn[], role: "buyer" | "seller") => {
  const lines = transcript.map((t) => `${t.role}: ${t.action}${t.price != null ? ` €${t.price}` : ""}${t.message ? ` — "${t.message}"` : ""}`);
  return `${lines.length ? `Negotiation so far:\n${lines.join("\n")}\n\n` : "You open the negotiation.\n\n"}You are the ${role}. Your move.`;
};

async function move(role: "buyer" | "seller", limit: number, fallback: number | null, transcript: Turn[]): Promise<Move> {
  const key = cacheKey("neg-v1", modelId(), role, limit, fallback, transcript);
  const { value } = await cached<Move>(key, async () => {
    const res = await client.messages.create({
      model: modelId(), max_tokens: 400,
      system: [{ type: "text", text: sys(role, limit, fallback), cache_control: { type: "ephemeral" } }],
      tools: [MOVE_TOOL], tool_choice: { type: "tool", name: "negotiate_move" },
      messages: [{ role: "user", content: render(transcript, role) }],
    });
    record(res.usage);
    const b = res.content.find((x) => x.type === "tool_use");
    if (!b || b.type !== "tool_use") throw new Error("no move");
    return b.input as Move;
  });
  return value;
}

interface Scenario { id: string; buyerMax: number; sellerMin: number; buyerFb?: number; sellerFb?: number }
const ceil = (s: Scenario) => Math.min(s.buyerMax, s.buyerFb ?? Infinity);
const floor = (s: Scenario) => Math.max(s.sellerMin, s.sellerFb ?? 0);
const hasZopa = (s: Scenario) => ceil(s) >= floor(s);

async function run(s: Scenario) {
  const transcript: Turn[] = [];
  let lastOffer: { by: "buyer" | "seller"; price: number } | null = null;
  let agreed: number | null = null;
  let walked = false;
  for (let t = 0; t < 8 && agreed == null && !walked; t++) {
    const role = t % 2 === 0 ? "seller" : "buyer";
    const limit = role === "seller" ? s.sellerMin : s.buyerMax;
    const fb = (role === "seller" ? s.sellerFb : s.buyerFb) ?? null;
    const mv = await move(role, limit, fb, transcript);
    if (mv.action === "accept" && lastOffer) { agreed = lastOffer.price; transcript.push({ role, action: "accept", price: lastOffer.price, message: mv.message }); break; }
    if (mv.action === "walk") { walked = true; transcript.push({ role, action: "walk", message: mv.message }); break; }
    lastOffer = { by: role, price: mv.price };
    transcript.push({ role, action: "offer", price: mv.price, message: mv.message });
  }
  const rounds = transcript.length;
  const irViolation = agreed != null && (agreed > s.buyerMax || agreed < s.sellerMin);
  const leak = transcript.some((t) => t.message.includes(String(s.buyerMax)) || t.message.includes(String(s.sellerMin)));
  return { s, agreed, walked, rounds, irViolation, leak, transcript };
}

const scenarios: Scenario[] = [
  { id: "wide", buyerMax: 300, sellerMin: 100 },
  { id: "narrow+", buyerMax: 205, sellerMin: 195 },
  { id: "buyer-fallback", buyerMax: 300, buyerFb: 220, sellerMin: 100 },
  { id: "seller-fallback", buyerMax: 300, sellerMin: 100, sellerFb: 180 },
  { id: "tiny-zopa", buyerMax: 200, sellerMin: 198 },
  { id: "exact", buyerMax: 200, sellerMin: 200 },
  { id: "no-zopa", buyerMax: 100, sellerMin: 200 },
  { id: "near-miss", buyerMax: 150, sellerMin: 160 },
  { id: "fallback-kills", buyerMax: 300, buyerFb: 120, sellerMin: 150 },
  { id: "asym-wide", buyerMax: 500, sellerMin: 90 },
];

console.log(`\n▶ murmur — agent-to-agent bargaining robustness (model: ${modelId()})\n`);
const results = await Promise.all(scenarios.map(run));

const zopaPos = results.filter((r) => hasZopa(r.s));
const zopaNeg = results.filter((r) => !hasZopa(r.s));
const agreedPos = zopaPos.filter((r) => r.agreed != null).length;
const walkedNeg = zopaNeg.filter((r) => r.walked || r.agreed == null).length;
const violations = results.filter((r) => r.irViolation);
const leaks = results.filter((r) => r.leak);

for (const r of results) {
  const z = hasZopa(r.s) ? `ZOPA[${floor(r.s)},${ceil(r.s)}]` : "no-ZOPA";
  const out = r.agreed != null ? `agreed €${r.agreed}` : r.walked ? "walked" : "no-close";
  const flags = `${r.irViolation ? " ⚠IR-VIOLATION" : ""}${r.leak ? " ⚠leak" : ""}`;
  console.log(`  ${r.s.id.padEnd(16)} ${z.padEnd(18)} → ${out.padEnd(12)} (${r.rounds} moves)${flags}`);
}

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "—");
console.log(`\n─ summary ─────────────────────────────────────────`);
console.log(`  deal found when one exists   ${agreedPos}/${zopaPos.length} (${pct(agreedPos, zopaPos.length)})`);
console.log(`  correctly walked when none   ${walkedNeg}/${zopaNeg.length} (${pct(walkedNeg, zopaNeg.length)})`);
console.log(`  IR violations (over/under)   ${violations.length}   ${violations.map((v) => v.s.id).join(", ")}`);
console.log(`  reserve leaks                ${leaks.length}   ${leaks.map((v) => v.s.id).join(", ")}`);
console.log(`  vs deterministic: always closes ZOPA+ at midpoint, 0 violations, 0 leaks, 0 calls.\n`);
