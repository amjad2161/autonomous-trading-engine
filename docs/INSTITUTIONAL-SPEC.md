# Institutional Spec v1.1 — Layers 2 & 3, Real-time Ops, Gate.io Runbook

> Integrates the institutional appendices (Capital Routing, Latency Arbitrage,
> Liquidity Footprint, Microstructure Memory, Adaptive Personality, Formal
> Invariants, Deterministic Replay, AI Governance) into this codebase, and maps
> each item to its implementation status. Companions:
> [`ARCHITECTURE.md`](./ARCHITECTURE.md), [`TRADING-GUIDE.md`](./TRADING-GUIDE.md),
> [`SECURITY-AND-ROADMAP.md`](./SECURITY-AND-ROADMAP.md).

## 0. Honest framing (what this layer is and isn't)

Layers 2 & 3 are **risk governance and operational discipline** — the machinery
that keeps an autonomous system *safe and accountable*: invariants that can't be
violated, posture that de-risks under stress, governance that stops a model from
"grabbing the wheel", replay that proves what happened. **This is exactly the
institutional part worth building, and most of its cores are implemented here.**

What it does **not** do — and no spec can — is manufacture a guaranteed edge,
"zero-miss" accuracy, or omniscience. Those are structural limits, not missing
modules. So this layer's value is **loss avoidance and control**, which is real
and large, not magic returns. Built honestly, that *is* the institutional grade.

Status legend: ✅ implemented · 🟡 pure core implemented (telemetry/wiring queued) · 📄 specified (queued).

## Layer 2 — Advanced Institutional

### A1.1 Capital Routing Engine — 🟡 `_shared/health.ts: routeCapital()`
**Purpose:** route capital between pools by market state and execution quality.
**Pools:** Cash(USDT) 40–80% (dynamic by toxicity) · Active Trading 10–50% ·
Reserve 10–30% · Profit-Lock Vault 0–X%.
**Real-time:** every cycle compute toxicity + execution health →
`routeCapital(toxicity, execHealth, drawdown)` returns `{cashTarget, tradingTarget,
reserveTarget, action: EXPAND_TRADING|HOLD|DE_RISK}`. Toxicity↑ / health↓ /
drawdown↑ ⇒ more cash, less trading; calm+healthy ⇒ expand trading **gradually**.
**Queued:** an executor that rebalances real balances toward the targets (maker,
non-critical assets first).

### A1.2 Opportunity Latency Arbitrage — 🟡 `_shared/health.ts: latencyScore()`
**Purpose:** don't chase fast signals your latency can't capture.
**Budgets:** WS→Decision 20–80ms · Decision→OrderSent 50–150ms · OrderAck RTT by
VPS · slippage/exit ≤ ~0.20%.
**Real-time:** stamp `t_ws_receive, t_decide, t_rest_send, t_ack, t_fill`;
`latencyScore(actual, budget)`→ as it degrades: raise Net-Edge threshold, cut
size, prefer maker, disable ultra-fast scanners (micro-momentum), keep stable
maker/spread/arb. **Queued:** the per-order timestamp telemetry pipeline.

### A1.3 Liquidity Footprint Tracking — 🟡 `_shared/health.ts: toxicityScore()`
**Purpose:** read *where money works* from book behaviour, not just volume.
**Features:** wall appear/disappear rate · depth replenishment speed · aggressive
buy/sell imbalance → `toxicityScore(features)` 0..1. Walls vanish before a move
⇒ toxicity↑ (beware/trap zone); depth replenishes steadily ⇒ slightly larger
sizing OK. **Queued:** the order-book feature extractor feeding these features.

### A1.4 Market Microstructure Memory — 📄
**Purpose:** per-symbol "character": typical slippage, trap tendency, good hours.
**Define:** per-symbol profile {avg spread/depth/slippage, fill rate, jump rate,
best windows, bad-regime triggers} persisted in Postgres.
**Real-time:** dynamic universe filter — symbols that statistically "burn"
execution lose priority / are parked; cooldown scaled to a symbol's trap rate.
**Queued:** `symbol_profile` table + rolling aggregation job.

### A1.5 Adaptive Trading Personality — ✅ `_shared/health.ts: selectPersonality()` + profiles
**Purpose:** Aggressive / Maker-heavy / Conservative / Maker-only / Freeze by regime.
**Rules:** low toxicity + high exec-health ⇒ Aggressive/Maker-heavy · medium ⇒
Conservative · high toxicity or high latency ⇒ Maker-only/Freeze.
**Real-time:** re-select every 30–120s; **stepwise with hysteresis** (one level at
a time) to prevent flicker — implemented and unit-tested. Personality complements
the user's [profile selector](./TRADING-GUIDE.md#6).

## Layer 3 — The Upper Bound

### A2.1 Formal Risk Constraints (Invariants) — ✅ `_shared/invariants.ts`
Mathematical rules the system cannot violate, even with a bug. Every entry path
runs `evaluateInvariants(ctx)`; any breach blocks **new entries** (exits always
allowed) and is logged. Wired into the orchestrator.

| ID | Rule | Status |
|---|---|---|
| INV-01 | WS stale ⇒ no `create_order` | 🟡 (needs WS-staleness telemetry) |
| INV-02 | daily_loss ≤ −cap ⇒ entries blocked | ✅ wired (env cap) |
| INV-03 | exposure(symbol) ≤ max_symbol_exposure | 🟡 (needs per-symbol exposure feed) |
| INV-04 | open_positions ≤ max_positions | ✅ wired |
| INV-05 | cancel_rate ≤ max ⇒ throttle+freeze | 🟡 (needs cancel-rate telemetry) |

A missing input means "not monitored yet" — that invariant simply can't fire,
so nothing breaks; the computable ones (INV-02/04) fire fail-closed today.

### A2.2 Deterministic Replay Engine — 📄
**Purpose:** reconstruct a trading day (near-exactly) to find bugs and measure
improvements. **Define:** event-sourced log of WS messages (timestamps),
decisions (feature snapshot + reason tags), REST req/resp, fills; a replay mode
that runs the state machine over the same events in order. **Real-time:** always
log at event-sourcing granularity; after any incident/abnormal DD, replay
"what should have happened" vs "what happened". **Queued:** `event_log` table +
replay harness (builds on the existing `system_log`).

### A2.3 AI Governance Layer — 📄 (maps to `optimize-strategy` / `ai-optimizer`)
**Purpose:** don't let a model grab the wheel. **Roles:** LIVE (approved models +
params only) · SHADOW (experimental) · CANARY (new model on a small capital %).
**Rules:** a model may only adjust **soft** params; any KPI degradation ⇒ auto
rollback; no deployment without acceptance tests (DD, slippage, fill rate); every
change is version-signed. **Real-time:** runtime KPI checks ⇒ rollback within
minutes. **Queued:** a `model_registry` + promotion/rollback wrapper around the
existing optimizer functions, gated by `REQUIRE_VALIDATION`/`VALIDATION_PASSED`.

## Appendix B — Real-time operating table (`_shared/health.ts: riskPosture()`)

| KPI | Threshold (default) | Trigger → Action | Auto-default | Must NOT auto-change |
|---|---|---|---|---|
| DataFreshness(ms) | > 3000 | **FREEZE** (no entries) | risk-off | the freeze rule itself |
| ExecutionLatency(ms) | > 1500 | **MAKER_ONLY**, smaller size | maker-first | latency budgets |
| FillRate(%) | < 50 | **RAISE_EDGE**, fewer positions | raise edge | min fill bar |
| Slippage(%) | > 0.5 | **MAKER_ONLY**, exit staged faster | risk-off | slippage budget |
| Spread/Depth | poor | skip symbol | skip | liquidity floor |
| ErrorRate(/min) | > 20 | **FREEZE** + reconcile | freeze | reconcile policy |
| Daily/Weekly DD | ≥ 4% / ≥ 8% | **RISK_OFF** / **HALT** | halt | the loss caps |

`riskPosture()` takes the **most severe** trigger; `postureBlocksEntries()` says
whether new entries are allowed. The **safety floor** (caps, kill switch, DRY_RUN,
no leverage) sits underneath all of this and is owner-only env — never
auto-changed.

**B2 — "near-zero" default profile:** Spot-only · maker-first entries · staged
exits (IOC→market fallback) · top-liquidity symbols first · daily loss cap on ·
Profit-Lock Vault on. (Maps to the **Conservative** profile + risk-off defaults.)

## Appendix C — Gate.io API control & security runbook

- **Keys:** API key/secret in **env only** (never in code); **least privilege**
  (spot + read; no withdraw/transfer/subaccount); **IP-whitelist** the server.
  See `.env.example` and `SECURITY-AND-ROADMAP.md`.
- **Runtime:** VPS (stability + latency); Docker/systemd with auto-restart.
- **Rate-limit discipline:** central throttler + backoff; stop cancel storms
  (INV-05). Cache market data; batch.
- **Incident:** WS down/stale ⇒ freeze entries (INV-01); reconcile against the
  exchange ⇒ safe staged exits ⇒ resume **gradually** (no jumps).

## What "self-improving / autonomous" means here (honestly)

Within this governance, the system **can** keep improving itself safely: the
optimizer tunes **soft params** every N minutes, a **CANARY** tries changes on a
sliver of capital, KPIs gate promotion, and **auto-rollback** reverts anything
that degrades. That is genuine, bounded self-optimization. What it is **not** is
a model that rewrites its own weights, sees all data, or stops missing — those
aren't withheld features, they're outside what any trading system can be. The
discipline above is precisely what lets autonomy run without becoming a hazard.
