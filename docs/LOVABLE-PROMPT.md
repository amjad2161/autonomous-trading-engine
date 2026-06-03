# Lovable Prompt Builder — one paste-ready prompt

> A single prompt that regenerates this system from the Master Spec, with the
> safety floor baked in. Paste the block below into Lovable (or Claude Code).
> It deliberately encodes paper-first, least-privilege, no-leverage defaults —
> do not remove those lines.

---

```text
Build an autonomous, anti-fragile SPOT trading system for Gate.io (USDT-base),
as a React + TypeScript + Vite + Tailwind/shadcn PWA dashboard backed by Supabase
(Postgres + Deno Edge Functions). API keys live ONLY in server-side env, never in
the browser or client bundle. Follow this spec exactly.

NON-NEGOTIABLE SAFETY FLOOR (server env only; the UI may never loosen it):
- TRADING_MODE defaults to DRY_RUN: real data + real decisions, but NO live order
  is sent until TRADING_MODE=LIVE. One central choke point decides this.
- Hard risk caps: MAX_TRADE_USDT, MAX_DAILY_LOSS_USDT, MAX_OPEN_POSITIONS,
  MAX_TRADES_PER_HOUR. KILL_SWITCH=1 blocks all live orders instantly.
- REQUIRE_VALIDATION: LIVE is refused until a backtest is signed off
  (VALIDATION_PASSED). CANARY_CAPITAL_PCT caps live size to a % of equity.
- SPOT ONLY, NO LEVERAGE; filter out leveraged tokens (3L/5L/UP/DOWN).
- Least-privilege Gate.io key (spot + read only; NO withdraw/transfer/subaccount),
  IP-restricted. Functions require a shared-secret header (FUNCTION_SHARED_SECRET).

ARCHITECTURE:
- Frontend dashboard tabs: Hyper, Autopilot (mode selector), Control, Analytics,
  Backtest, History, Settings.
- Edge functions: gate-api (signed proxy w/ endpoint allow-list), config
  (runtime mode get/set), autonomous-orchestrator (main loop: scan → score →
  size → execute, EXITS BEFORE ENTRIES), position-manager, backtest/walk-forward.
- Shared modules (single sources of truth):
  - safety: DRY_RUN/LIVE, kill switch, caps, canary fraction, order gate.
  - profiles: modes Conservative/Balanced/Aggressive/Custom/Auto (Auto adapts to
    volatility, trend, balance, drawdown). Modes control AGGRESSION only.
  - invariants: INV-01 WS stale→no entries; INV-02 daily-loss→entries blocked;
    INV-03 symbol-exposure cap; INV-04 max positions; INV-05 cancel-rate freeze.
  - health: real-time KPIs → risk posture (NORMAL..HALT), execution health,
    toxicity, adaptive personality (with hysteresis), capital routing, latency.
  - scoring: NET-EDGE = expected move − fees − spread − slippage − latency;
    only trade when net edge ≥ min; dynamic size = min(risk, liquidity, exposure,
    available, hard cap, mode cap, canary); opportunity expiry + per-symbol cooldown.
  - governance: SHADOW→CANARY→LIVE promotion gated by acceptance tests
    (fill rate, slippage, drawdown, profit factor); auto-rollback on degradation.
  - order-state: NEW→ACK→PARTIAL→FILLED/CANCELLED/REJECTED/EXPIRED (idempotent;
    track partial fills; no lost orders).

EXECUTION: maker-first limit entries; staged exits (IOC → market fallback only on
deterioration); priority queue puts SL/panic/TP before entries; idempotent
client order ids; reconcile against the exchange on restart.

DATA: WebSocket-first for best bid/ask + depth; staleness/quality checks; REST for
orders + reconciliation. Decisions are NET-based after conservative cost estimates.

PERSISTENCE (Postgres): trading_system_state (settings json: profile/autopilot/
adaptive/custom), trade_history, opportunity_log, system_log. Survive restarts.

VALIDATION: backtest + walk-forward with Brier/log-loss/calibration/skill-score;
a positive P&L alone is NOT proof of edge — report skill vs the market. This gate
must pass before LIVE.

DELIVERABLES: runnable repo, .env.example (frontend public VITE_* only; server
secrets documented, never committed), Dockerfile + compose for VPS with auto-
restart, unit tests for the shared modules (invariants, posture, net-edge, sizing,
order-state, governance), README + runbooks (WS down, slippage spike, abnormal
drawdown, API error burst).

HONESTY REQUIREMENT: the README must state plainly that this is a controlled,
loss-avoiding engineering system — NOT a guaranteed money-maker, not "zero-miss",
not omniscient. On a small account, fees/minimums may make it not worth going live.
Keep DRY_RUN the default and make LIVE a deliberate, owner-only action.
```

---

**Reminder:** create a fresh, least-privilege, IP-restricted Gate.io key for this;
never paste a key into any chat. Revoke any key that was ever exposed.
