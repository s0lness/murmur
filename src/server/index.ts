import { loadDotenv } from "../intake/env";
import { createBot } from "./bot";

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

const bot = createBot(token);
console.log("murmur-server: connecting to Telegram (long-poll)…");
bot.start({
  onStart: (info) => console.log(`@${info.username} online — DM the bot to onboard. Ctrl+C to stop.`),
});
