# Running the murmur pilot

A central-hosted Telegram bot (`@mmmmurmur_bot`) for a small friends group. You host one
instance on your own Anthropic credits; peers just DM the bot in plain words. Your agent
distills their words into intents, broadcasts only a *blur*, matches privately, and proposes
a fair price.

## Prerequisites

- Node on PATH (`node -v`). On Windows PowerShell: `$env:Path = "$env:ProgramFiles\nodejs;$env:Path"`.
- `npm install` once.
- `murmur/.env` (gitignored) with:

```
ANTHROPIC_API_KEY=sk-ant-...
TELEGRAM_BOT_TOKEN=...            # from @BotFather
MURMUR_MODEL=claude-opus-4-8     # see "Model & cost" below
MURMUR_CURRENCY=$                # symbol shown to users ($, £, €)
```

> **Rotate any key that's ever been pasted into a chat.** `.env` is gitignored — keep it that way.

## Launch

```bash
npm run smoke      # 1. verify the bot wires up cleanly (no Telegram connection)
npm run server     # 2. start the bot (long-polls Telegram) + host dashboard on :4319
```

- Only **one** instance may poll a given bot token at a time — a second one gets Telegram
  `409 Conflict`. If you see that, another copy is already running.
- Host dashboard: <http://localhost:4319> — your god's-eye view of the pool, matches, deals.
  Bound to `127.0.0.1` only; peers never see it.
- Wants expire after **7 days** (hourly housekeeping).

## Model & cost

Every inbound message can trigger several LLM calls (distill, route, semantic match, the
multilateral helper). The bot shares `MURMUR_MODEL` with the lab.

| model | per-Mtok (in/out) | use for |
| --- | --- | --- |
| `claude-haiku-4-5` | ~$1 / $5 | **the live pilot** — structured tasks it handles well, ~15× cheaper |
| `claude-sonnet-4-6` | ~$3 / $15 | if match quality dips on hard cases |
| `claude-opus-4-8` | ~$15 / $75 | the lab / one-off quality runs — too pricey to leave running live |

**Current choice:** running everything on **`claude-opus-4-8`** for now — best quality while
the pilot is small, cost-streamlining comes later. The dashboard/run cost meter makes the
spend visible (a fresh 30-agent lab run ≈ $6), so it's easy to revisit. When credits matter,
drop `MURMUR_MODEL` to `claude-haiku-4-5` (≈15× cheaper) — it handles these structured tasks
well.

## What peers do

DM the bot in plain words — `"selling my road bike, around 150, around till Sunday"`,
`"looking for a cheap monitor under 80"`, `"swap my breadmaker for a blender"`. The bot:

1. **distills** the message into structured intents (only a blur is ever broadcast);
2. **matches** against the pool (semantic judge for pairs; group-buys + barter rings, now
   with an LLM fuzzy-edge **failover** for substitutes the keyword matcher misses);
3. proposes a **fair price** = midpoint of the fallback-bounded zone of agreement (no LLM
   haggling — research showed deterministic pricing is safer);
4. on mutual *Connect* + *Approve*, drops the two into a direct connection to settle IRL.

Commands: `/start /me /clear /pass /status /rematch /simulate`.

## Privacy caveat (tell your friends)

During this pilot the **host can see everything** (the dashboard shows full intents). Peers
only ever see each other's *blur* — category + tags + coarse region, never price, name, or
exact address. `blur()` in `src/core/intent.ts` is the entire public/private boundary.

## If something breaks

- `409 Conflict` → another instance is polling; stop it.
- Auth errors → check `.env` is loaded and `ANTHROPIC_API_KEY` is valid.
- Re-run matching over the whole pool manually: `npm run rematch`.
- Inspect what the bot would do offline: `npm run smoke`.
