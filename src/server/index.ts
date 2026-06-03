import { loadDotenv } from "../intake/env";
import { createBot } from "./bot";
import { startDashboard } from "./dashboard";
import { Store } from "./store";

loadDotenv();
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("Set TELEGRAM_BOT_TOKEN in murmur/.env (get one from @BotFather).");
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Set ANTHROPIC_API_KEY in murmur/.env.");
  process.exit(1);
}

const TTL_MS = 7 * 24 * 60 * 60 * 1000; // wants expire after 7 days

const store = new Store();
store.purgeSims();
store.purgeOrphanMatches();
store.purgeExpired(TTL_MS);
setInterval(() => store.purgeExpired(TTL_MS), 60 * 60 * 1000); // hourly housekeeping

const bot = createBot(token, store);
startDashboard(store);

console.log("murmur-server: connecting to Telegram (long-poll)…");
bot.start({
  onStart: (info) => console.log(`@${info.username} online — DM the bot to onboard. Ctrl+C to stop.`),
});
