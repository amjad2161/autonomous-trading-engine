# Run it locally on your own computer

> The intended setup: the whole system **installed and operated on your machine**.
> This is the most secure option — your Gate.io keys never leave your computer,
> nothing runs in the cloud, and you open/close it whenever you like. Defaults to
> DRY_RUN (real data, no live orders).

## What runs where

```
Your computer
├─ Dashboard (Vite)        npm run dev        → http://localhost:5173
├─ Local Supabase (Docker) supabase start     → Postgres + Edge Functions
│   └─ functions serve     supabase functions serve
├─ Local ticker            npm run ticker      → drives the autonomous loop
└─ .env (keys)             on disk only, never committed, never in chat
```

## Prerequisites

- **Node.js** 18+ and npm
- **Docker** (for the local Supabase stack)
- **Supabase CLI** — https://supabase.com/docs/guides/cli
- (optional) **Deno** — only to run the unit tests

## 1. Install

```bash
git clone <your repo> && cd autonomous-trading-engine
npm install
```

## 2. Start the local backend (Postgres + functions)

```bash
supabase start          # boots local Postgres + the edge runtime in Docker
supabase db reset       # applies migrations (creates the tables + event_log)
```
`supabase start` prints a local **API URL** (`http://127.0.0.1:54321`), an
**anon key**, and a **service_role key** — copy them for the next steps.

## 3. Put your keys on your machine ONLY (never in code/chat)

Create a **new, least-privilege** Gate.io key first: **Spot + read only, NO
withdraw / transfer / subaccount, IP-restricted.** Then set the server-side env
for the functions (local file, gitignored):

```bash
# supabase/functions/.env.local   (DO NOT COMMIT — .env.* is gitignored)
GATE_API_KEY=your_new_spot_read_key
GATE_API_SECRET=your_new_secret
TRADING_MODE=DRY_RUN
FUNCTION_SHARED_SECRET=pick-a-long-random-string
MAX_TRADE_USDT=15
MAX_DAILY_LOSS_USDT=15
MAX_OPEN_POSITIONS=2
KILL_SWITCH=0
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=the_service_role_key_from_step_2
```

Serve the functions with that env:
```bash
supabase functions serve --no-verify-jwt --env-file supabase/functions/.env.local
```

## 4. Point the dashboard at your local backend

```bash
# .env   (frontend; VITE_* are public-by-design — never put Gate.io keys here)
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=the_anon_key_from_step_2
VITE_SUPABASE_PROJECT_ID=local
VITE_FUNCTION_SECRET=same-value-as-FUNCTION_SHARED_SECRET
```

## 5. Run it

```bash
npm run dev      # dashboard at http://localhost:5173
# in a second terminal — the autonomous loop:
SUPABASE_ANON_KEY=<anon> FUNCTION_SECRET=<secret> npm run ticker
# in a third terminal — WS market-data freshness (feeds INV-01; if it stops,
# the system stops opening new entries — fail-safe):
SUPABASE_ANON_KEY=<anon> FUNCTION_SECRET=<secret> npm run ws
```
Open the dashboard → **Autopilot** tab → turn **Autopilot ON** and pick a mode.
With `TRADING_MODE=DRY_RUN` it shadow-trades on real data and sends **no** orders.

## Open / close (operate it through your computer)

- **Start:** run `npm run dev` + `npm run ticker`, turn Autopilot ON.
- **Pause instantly:** set `KILL_SWITCH=1` (restart `functions serve`) or just
  toggle Autopilot OFF in the dashboard.
- **Stop:** Ctrl-C the ticker (it flips the system inactive) and close the dev
  server. Nothing trades when it isn't running.

## Going live (deliberate, only after a real edge test passes)

1. Run the edge test on real data: invoke the `edge-test` function (it uses the
   public market API — no keys). It must show a genuine edge **out-of-sample**.
2. Only then: `TRADING_MODE=LIVE` in `.env.local`, restart `functions serve`,
   start with tiny `CANARY_CAPITAL_PCT` (e.g. 10).
3. Keep `KILL_SWITCH` one edit away at all times.

> Reality check already done: on a real-data sample the edge detector returned
> **no edge** (negative skill). Do not go live without your own passing test.

## Verify the build/tests locally

```bash
npx tsc --noEmit -p tsconfig.app.json     # typecheck
npm run test                              # frontend tests
npm run build                             # production build (PWA)
deno test --allow-env supabase/functions/_shared/   # 77 logic tests (needs Deno)
```
