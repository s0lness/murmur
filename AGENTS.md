# murmur

An ambient-intent layer for agents (Node + TypeScript). A human tells their agent what they want in
plain words; the agent distills it into a structured intent, broadcasts only a *blur* (category +
tags + coarse region, never price, name or exact location), matches privately against a shared pool,
and proposes a fair price the two humans confirm and settle in the real world. Two entry points
today: a live Telegram pilot (`@mmmmurmur_bot`) and an LLM-driven fuzz lab that pushes synthetic
humans through the same pipeline.

## Run

Needs Node >= 20.19.

```
npm install
npm run smoke      # wires the bot up without connecting to Telegram
npm run server     # bot (long-poll) + host dashboard on http://localhost:4319
npm run fuzz 30 help    # 30 LLM "humans" through the real pipeline
npm run view            # then http://localhost:5050/fuzz.html
npm test                # vitest, deterministic matching/privacy tests
npm run typecheck
npm run rematch         # re-run matching over the whole pool by hand
```

`.env` at the repo root (gitignored): `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `MURMUR_MODEL`,
`MURMUR_CURRENCY`, optional `MURMUR_HOST_HANDLE` / `MURMUR_HOST_ID`, `MURMUR_ENRICH=0` to disable the
enrich pass. Full guides in `PILOT.md` (run it) and `FINDINGS.md` (what the experiments proved).

## Architecture

- `src/core/intent.ts` `blur()` is the *entire* public/private boundary. Anything added to
  `PublicSignal` is a privacy decision, not a refactor.
- `src/intake/` distiller (LLM, `llmDistiller.ts` + `prompt.ts` + zod `schema.ts`), `enrich.ts` (one
  quiet sharpening pass on a vague fresh intent, kept only if it improved), `env.ts` dotenv loader.
- `src/matching/` `keywordMatcher` -> `bigramMatcher` (fuzzy prefilter widening recall) ->
  `semanticMatcher` (LLM judge on the shortlist).
- `src/multilateral/` group-buy and barter-ring detection; `src/solver/` the deterministic close and
  its measurements; `src/negotiate/`, `src/rooms/` (charters) are the research tracks.
- `src/server/` the pilot: `bot.ts` (grammy), `store.ts` (JSON file `murmur.db.json`, plus
  housekeeping: expiry at 7 days, orphan/sim purge), `dashboard.ts`, `i18n.ts`, `eventlog.ts`.
- `src/fuzz/` the lab (personas, LLM humans, refinement loop); `viewer/` its static dashboards,
  served by `viewer/serve.mjs` on :5050.
- `runs/log.md` is the experiment + decision log; `docs/` the diagrams.

## Conventions

- Pricing is deterministic: midpoint of the fallback-bounded zone of agreement, individual-rational
  by construction. Live LLM bargaining was tried, it leaks information and misses narrow deals. Do
  not reintroduce it.
- The split that keeps proving itself: LLM as preference oracle (express, refine, recall),
  deterministic engine as combinatorial core, human as the gate. Nothing auto-executes.
- Model resolution goes through `modelId()` in `src/core/model.ts` (reads `MURMUR_MODEL`, defaults to
  `claude-haiku-4-5`). Never hardcode a model id elsewhere.
- Tags are normalised to English internally so "vélo" matches "bike"; replies are localized. Adding a
  language = one entry in `src/server/i18n.ts`, nothing else.
- No em dashes anywhere in the prose (a commit stripped them all, keep it that way).

## Gotchas

- Only ONE process may long-poll a given bot token. A second one gets Telegram `409 Conflict`; that
  error means another copy is already running, not a bug.
- The host dashboard binds to `127.0.0.1` only and shows FULL intents. During the pilot the host sees
  everything; peers only ever see each other's blur. Say so to anyone you onboard.
- `logs/events.jsonl` holds real user messages. Gitignored, and it stays out of anything you publish
  or paste. `.env` likewise, and any key ever pasted into a chat should be rotated.
- Wants expire after 7 days (hourly housekeeping), so an old pool goes quiet on its own.
- The bot cannot DM a handle: it captures the numeric id the first time you `/start` it, which is why
  `MURMUR_HOST_HANDLE` needs one message before `/feedback` reaches you.
- A fresh 30-agent lab run costs real money (~$6 on opus). The dashboard has a live token/cost meter,
  watch it before launching big runs.
