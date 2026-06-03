# Architecture — Autonomous Trading Engine

> Full system map produced from a file-by-file read of the repository.
> Companion docs: [`SECURITY-AND-ROADMAP.md`](./SECURITY-AND-ROADMAP.md).

## 1. What this project is

A single-user, browser-based **autonomous crypto-trading dashboard** for
**Gate.io** (spot). It was generated/iterated with Lovable. It is:

```
┌──────────────────────────┐     HTTPS / supabase-js      ┌───────────────────────────┐      Gate.io v4 REST
│  React PWA dashboard      │  ─────────────────────────▶  │  Supabase Edge Functions  │  ─────────────────────▶  api.gateio.ws
│  (Vite + TS + shadcn/ui)  │   functions.invoke(name)     │  (Deno, ~28 functions)    │   server-side signed     (spot trading,
│  "lives on the desktop"   │  ◀─────────────────────────  │  + Postgres (state/logs)  │  ◀─────────────────────  wallet, tickers)
└──────────────────────────┘     JSON results / polling    └───────────────────────────┘
```

- **Frontend** never holds Gate.io keys. It calls edge functions.
- **Edge functions** hold `GATE_API_KEY` / `GATE_API_SECRET` as server env vars,
  sign requests (HMAC-SHA512, Gate.io v4 spec), and talk to the exchange.
- **Postgres** stores system state, trade history, opportunity log, system log,
  and goal tracking.

## 2. Frontend (`src/`)

| Area | Files | Role |
|---|---|---|
| Entry | `main.tsx`, `App.tsx`, `pages/Index.tsx` | Boots the app; `Index.tsx` renders the dashboard as tabs: **Hyper / Autopilot / Control / Analytics / Scalping / History / Backtest / Settings**. |
| Autopilot / modes | `components/dashboard/TradingModePanel.tsx`, `hooks/useTradingConfig.ts` | Mode selector + autopilot/adaptive control; reads/writes the `config` function. |
| Gate / onboarding | `components/CredentialsScreen.tsx`, `hooks/useCredentials.ts` | "Cloud-secured" connection test — credentials live server-side; the screen only verifies the server is configured. |
| Dashboard panels | `components/dashboard/*` (22 panels) | Treasury, Positions, RiskControl, Opportunities, Backtest, ContinuousTrading, Autonomous control, TradingChat, Performance, CronJob setup, TickScalping, MasterControl, AdvancedAnalytics, TradeHistory, **HyperEngine**, Settings, TradingStats, RapidTrader, Goals, MarketOverview, ActivityLog. |
| Hooks (state/logic) | `hooks/use*.ts` | Thin clients over the edge functions: `useAutonomousSystem`, `useGateApi`, `useGateWebSocket`, `useRapidTrader`, `useTickScalping`, `useContinuousTrading`, `useAutoExecute`, `useBacktest`, `useWalkForward`, `useOptimization`, `useOpportunityScanner`. |
| Client libs | `lib/*.ts` | Browser-side mirrors: `gate-api.ts`, `gate-websocket.ts`, `trade-executor.ts`, `opportunity-scanner.ts`, `backtest.ts`, `walk-forward.ts`, `optimize.ts`. |
| Supabase glue | `integrations/supabase/client.ts`, `types.ts` | Client factory (now also injects the `x-function-secret` header) and generated DB types. |

The **default tab is "Hyper"** → the system is wired to foreground the
`hyper-engine` strategy.

## 3. Backend (`supabase/functions/`)

### 3.1 Infrastructure / shared

| Function | Lines | Role |
|---|---:|---|
| `gate-api` | 164 | Signed proxy to Gate.io with an **endpoint allow-list** (`/spot/accounts`, `/spot/tickers`, `/spot/orders`, `/spot/order_book`, `/spot/currency_pairs`, `/wallet/total_balance`). |
| `update-secrets` | 88 | Verifies Gate.io keys (key management surface). |
| `scheduler` | 149 | Keeps the orchestrator running in ~10-minute windows. |
| `cron-trigger` | 103 | External cron entrypoint. |
| `_shared/safety.ts` | NEW | Single source of truth: DRY_RUN/LIVE, kill switch, risk caps, order gate. |
| `_shared/auth.ts` | NEW | Shared-secret auth guard (replaces presence-only checks). |
| `_shared/profiles.ts` | NEW | Trading modes (Conservative/Balanced/Aggressive/Custom/Auto) + adaptive engine. |
| `_shared/invariants.ts` | NEW | Formal risk invariants (INV-01..05) — system-state gate on new entries. |
| `_shared/health.ts` | NEW | Real-time KPIs → risk posture, execution health, toxicity, personality, capital routing, latency. |
| `_shared/scoring.ts` | NEW | Net-edge cost model, dynamic sizing, opportunity scoring, expiry, cooldown. |
| `_shared/order-state.ts` | NEW | Order lifecycle state machine (NEW→…→FILLED), idempotent, partial fills. |
| `_shared/governance.ts` | NEW | SHADOW→CANARY→LIVE promotion gates + auto-rollback on KPI degradation. |
| `config` | NEW | Runtime get/set of the active mode + autopilot flags (stored in `trading_system_state.settings`). |

### 3.2 The orchestration brain

| Function | Lines | Role |
|---|---:|---|
| `autonomous-orchestrator` | 1275 | Master loop. Commands: `start` / `stop` / `cycle` / `status`. `trading_system_state.is_active` is the on/off (kill) flag. Scans, decides, places orders, logs. |
| `position-manager` | 506 | Trailing stops, take-profit ladders, stale-position alerts. |
| `auto-liquidate` | 227 | Emergency/auto exit of positions. |

### 3.3 Strategy / execution engines (HEAVY OVERLAP — see §5)

| Function | Lines | Notes |
|---|---:|---|
| `hyper-engine` | **2108** | The foreground engine. Scanning + scalping + dip-buy + dust conversion in one mega-file. Filters out leveraged tokens (UP/DOWN). |
| `master-brain` | 776 | Another "decide + execute" engine. |
| `ultimate-trader` | 690 | Another end-to-end trader. |
| `realtime-trader` | 661 | WebSocket-driven trader. |
| `continuous-trader` | 394 | Loop trader. |
| `rapid-trader` | 407 | Fast spot scalper (skips leveraged tokens). |
| `micro-scalper` | 469 | Micro-scalp variant. |
| `tick-processor` | 499 | Tick-level processing. |
| `execute-trade` | 271 | **Cleanest single-order executor** — input validation, caps, edge sanity (rejects >5%), R/R check, slippage + liquidity checks, IOC limit orders. Now the reference for the safety layer. |
| `opportunity-scanner` | 551 | Ranks symbols into opportunities. |
| `collect-all` | 332 | Sweeps balances / rewards. |
| `dust-converter` | 376 | Converts dust via `/wallet/small_balance`. |

### 3.4 Validation / optimization

| Function | Lines | Role |
|---|---:|---|
| `backtest` | 512 | Historical replay (the only place with simulation today). |
| `walk-forward` | 481 | Walk-forward out-of-sample evaluation. |
| `optimize-strategy` | 483 | Parameter search. |
| `ai-optimizer` | 318 | LLM-assisted tuning. |
| `trading-chat` | 300 | AI chat over the system. |

**15 functions place live `/spot/orders`** (see §5).

## 4. Data model (`supabase/migrations/`)

| Table | Purpose |
|---|---|
| `trading_system_state` | Singleton-ish runtime state: `is_active`, heartbeats, cycle/trade counters, pnl, balance, `settings`. |
| `trade_history` | Every order: symbol, side, type, amount, price, expected edge, realised pnl, status, error. |
| `opportunity_log` | Opportunities the scanners surfaced. |
| `system_log` | Structured logs (level/component/message/details). |
| `trading_goals`, `goal_progress` | Goal tracking + progress. |
| `rewards_collected` | Rewards/points sweeps. |

## 5. The redundancy map (why consolidation matters)

At least **five engines** (`hyper-engine`, `master-brain`, `ultimate-trader`,
`realtime-trader`, `continuous-trader`) plus the scalpers (`rapid-trader`,
`micro-scalper`, `tick-processor`) each independently:

1. fetch tickers/order books,
2. score opportunities,
3. **place orders with their own private `gate()` / `gateRequest()` helper**, and
4. apply their own (inconsistent) risk logic.

Each helper has a **different signature**, e.g.:

- `gate('POST', '/spot/orders', key, secret, body)` (hyper-engine, realtime-trader)
- `gateRequest('/spot/orders', 'POST', {}, body)` (rapid-trader, continuous-trader, …)
- `gateRequest('POST', '/api/v4/spot/orders', key, secret, {}, body)` (ultimate-trader, master-brain)

Consequences: a risk fix has to be made in ~10 places; DRY_RUN/kill-switch
historically existed in **zero** of them; behaviour drifts between engines. The
roadmap (`SECURITY-AND-ROADMAP.md` §3) is to route **all** order placement
through one shared executor that calls `_shared/safety.ts`.

## 6. Control & data flow (autonomous loop)

```
Index.tsx (Hyper tab)
  └─ useAutonomousSystem.start()
       ├─ invoke autonomous-orchestrator { command: 'start' }   → sets is_active=true
       └─ invoke scheduler { durationMinutes:10, intervalSeconds:30 }
             └─ repeatedly invoke autonomous-orchestrator { command:'cycle' }
                   ├─ scan (opportunity-scanner / inline)
                   ├─ decide
                   ├─ execute  →  POST /spot/orders   ◀── SAFETY GATE belongs here
                   ├─ position-manager (stops / TP)
                   └─ write trade_history + system_log
  └─ useAutonomousSystem polls { command:'status' } every 10s for the UI
```

## 7. External dependencies

- **Gate.io v4 REST** (`api.gateio.ws`) — spot trading, wallet, market data.
- **Supabase** — Postgres, Edge Functions (Deno), secrets vault.
- **Frontend stack** — React 18, Vite 5, TanStack Query, shadcn/Radix, Tailwind,
  Recharts, `vite-plugin-pwa`.

## 8. Companion repo: `tradingboy`

Currently a stub (README only). The intended consolidation is for this engine to
be the single canonical project; see `SECURITY-AND-ROADMAP.md` §4.
