# Master Specification — Anti-Fragile Autonomous Trading System (Gate.io, USDT-base)

> Canonical blueprint, integrated from the uploaded Master Specification docs
> (v1.0, v1.1, Clean draft) + the 100 super-improvements. This file is the index
> and the **traceability matrix**: every capability is tagged with where it lives.
> Deep dives: [`ARCHITECTURE.md`](./ARCHITECTURE.md) ·
> [`INSTITUTIONAL-SPEC.md`](./INSTITUTIONAL-SPEC.md) ·
> [`TRADING-GUIDE.md`](./TRADING-GUIDE.md) ·
> [`SECURITY-AND-ROADMAP.md`](./SECURITY-AND-ROADMAP.md).
>
> Status: ✅ implemented · 🟡 pure core implemented (telemetry/wiring queued) · 📄 specified (queued).

## 0. Goal & philosophy

Build an autonomous, hard-to-topple trading system on Gate.io (API key/secret)
that manages capital intelligently, scans in real time, acts only on **legitimate
market inefficiencies**, locks profit fast, cuts losses fast, and — above all —
**survives**. Explicitly **not** a promise of profit or invincibility. Its job:
(1) turn the market into digestible information (data/features/toxicity/regime);
(2) act only on **net edge after costs** (fees + spread + slippage + latency);
(3) hold a multi-layer protective envelope (risk, execution, wallet, infra,
monitoring, recovery, gated learning); (4) improve itself **carefully**, never
breaking safety rules.

Legality: only legitimate inefficiency (legal arbitrage, market making,
microstructure, smart filtering). No spoofing/wash/manipulation, no ToS evasion.

## 1. Real-time operating rules

- **WebSocket-first** — WS is the primary feed; if data is stale → no new
  entries, go Risk-Off/Freeze (INV-01). 🟡 (`riskPosture` + INV-01; WS telemetry queued)
- **Autonomy inside a safety cage** — Hard guardrails never auto-change; soft
  params tune only via Shadow→Canary. ✅ floor in `_shared/safety.ts`; 📄 Shadow/Canary
- **Net-based decisions** — no entry without sufficient net edge after costs.
  🟡 `_shared/scoring.ts: netEdge()` (wiring into scanners queued)

## 2. System layer map

| Layer | Spec | Where / status |
|---|---|---|
| Intelligent Treasury | USDT target, Reserve, Profit-Lock, exposure caps | 🟡 `routeCapital()` (rebalancer queued); `TreasuryPanel` |
| Market Data + Hygiene | WS best bid/ask, depth, staleness, quality score | 🟡 `gate-websocket`, `useGateWebSocket` (hygiene scoring queued) |
| Features / Regime / Toxicity | spread, depth, imbalance, jumps, vol regime, toxicity | 🟡 `toxicityScore()`, regime in `profiles.adaptiveParams()` |
| Opportunity (multi-scanner) | tri-arb, maker spread, microstructure, breakout, reversion | 🟡 `opportunity-scanner`, `hyper-engine` (normalize/expiry queued) |
| Scoring + Planning | unified net-edge score, correlation gate, budgeting | 🟡 `_shared/scoring.ts` (planning queued) |
| Execution (exits-first) | priority queue, maker-first, staged exit, partial fills | 🟡 `execute-trade`, `position-manager` (full state machine queued) |
| Hard Risk Core | daily loss, max positions/exposure, kill switch | ✅ `_shared/safety.ts` + `_shared/invariants.ts` |
| Controlled Learning | Shadow always-on, offline train, canary, rollback | 📄 maps to `optimize-strategy`/`ai-optimizer` + governance |
| Reliability / Recovery | failover, reconciliation, circuit breakers | 🟡 reconcile in `position-manager` (failover queued) |
| Security / Compliance / Ops | least-privilege keys, secrets, IP allowlist, audit | ✅ keys server-side + auth guard; 🟡 audit/observability |

## 2b. Implemented shared cores (this build)

Pure, unit-tested modules in `supabase/functions/_shared/` now cover the cores of
most of the 100 items (the live HTTP wiring + telemetry that need a real runtime
are the remaining 📄):

| Module | Covers (item ranges) |
|---|---|
| `safety.ts` + `invariants.ts` | floor + INV-01..05; #14, #66–75 |
| `profiles.ts` + `health.ts` | regimes, toxicity, personality, posture, routing; A1.1/1.2/1.3/1.5, B1, #30–33 |
| `scoring.ts` | net-edge cost model + sizing + score + expiry + cooldown; #10, #34, #41, #46–47, #54 |
| `kelly.ts` | quant sizing: expectancy, fractional-Kelly, risk-of-ruin, Sortino; #10, #46, #68 |
| `market-data.ts` | hygiene + microstructure; #16–29, #35 |
| `treasury.ts` | capital management; #1–13, #15 |
| `execution.ts` + `order-state.ts` | exits-first queue, staging, FSM; #56–65 |
| `governance.ts` | Shadow/Canary/rollback; #78–80, A2.3 |
| `replay.ts` (+ `event_log`) | deterministic replay; #25, A2.2 |
| `metrics.ts` | observability KPIs + alerts; #64, #98–100 |
| `validation.ts` + `dataset.ts` | the edge-detector LIVE gate on real Gate.io data |

8 Deno test suites prove these (`*.test.ts`). Run: `deno test supabase/functions/_shared/`.

## 3. The 100 super-improvements (traceability)

### A) Treasury & Wallet Control
1 bi-dir balance recon 🟡 · 2 liquid valuation (depth, not last) ✅ `market-data.liquidationValueUsdt` · 3 auto-USDT dominance 🟡 ·
4 fee buffer ✅ wired (FEE_BUFFER_USDT) · 5 reserve vault ✅ wired (RESERVE_PCT) · 6 profit-lock vault ✅ wired (PROFIT_LOCK_PCT) · 7 per-asset exposure cap ✅ ·
8 correlation exposure cap ✅ wired (`correlation.ts`) · 9 liquidity-shock sizing 🟡 · 10 dynamic sizing ✅ `scoring.positionSize()` ·
11 auto-rebalance idle 🟡 `dust-converter` · 12 dust mgmt ✅ `dust-converter` · 13 locked-funds resolver 📄 ·
14 wallet invariants ✅ `invariants` · 15 capital-velocity meter 📄

### B) Market Data & Hygiene
16 WS-first ✅ (ws-telemetry) · 17 staleness detection ✅ wired (INV-01) · 18 clock-drift guard ✅ `opportunities.ts` · 19 integrity filters 📄 ·
20 universe auto-discovery 🟡 · 21 tick normalization ✅ wired · 22 snapshot+deltas 🟡 · 23 feed redundancy 📄 ·
24 data quality score 🟡 `dataQualityScore` · 25 event sourcing ✅ wired (event_log)

### C) Features, Regimes, Toxicity
26 spread health 🟡 · 27 depth-at-X% ✅ `market-data.depthWithinPct` · 28 imbalance stability ✅ `microstructure.ts` · 29 jump detector ✅ `microstructure.ts` ·
30 vol regime classifier 🟡 · 31 toxicity score ✅ `toxicityScore()` · 32 session awareness 📄 ·
33 market stress index 🟡 `riskPosture` · 34 conservative cost model ✅ `scoring.estimatedCosts()` · 35 latency penalty ✅ `scoring`/`latencyScore`

### D) Opportunity Detection (legal)
36 tri-arb 🟡 · 37 maker spread harvest 🟡 · 38 microstructure scalp 🟡 · 39 compression breakout 🟡 ·
40 safe mean-reversion 🟡 · 41 opportunity expiry ✅ `scoring.opportunityExpired()` · 42 normalized output ✅ `opportunities.ts` ·
43 dedup ✅ `opportunities.ts` · 44 false-positive filters 🟡 toxicity · 45 arb leg-risk check 📄

### E) Scoring, Planning, Autonomy
46 unified net-edge score ✅ `scoring.scoreOpportunity()` · 47 risk-weighted allocation 🟡 · 48 multi-horizon brain 📄 ·
49 pre-trade exit plan 🟡 `execute-trade` · 50 scenario micro-sim ✅ `scenario.ts` · 51 regime switcher ✅ profiles/personality ·
52 opportunity budgeting 🟡 caps · 53 correlation selection ✅ wired (`correlation.ts`) · 54 cooldown per symbol ✅ `scoring`/profiles ·
55 trade-frequency governor ✅ maxTradesPerHour

### F) Execution Quality
56 priority queue (exits first) ✅ wired · 57 maker-first entry ✅ (MAKER_FIRST_ENTRIES) · 58 smart reprice 📄 · 59 IOC exit first ✅ wired ·
60 market fallback ✅ wired (staged exit) · 61 partial-fill handler ✅ `order-state.ts` · 62 order state machine ✅ `order-state.ts` · 63 idempotency 🟡 clientOrderId ·
64 execution health score ✅ `executionHealth()` · 65 adaptive timeouts 📄

### G) Hard Risk Core
66 daily loss limit ✅ · 67 max open positions ✅ INV-04 · 68 max per-trade risk ✅ caps ·
69 portfolio VaR guard ✅ wired (`portfolio-risk.ts`) · 70 drawdown pattern guard 🟡 · 71 slippage spike guard 🟡 `riskPosture` ·
72 API error-burst guard 🟡 `riskPosture` · 73 WS-down guard 🟡 INV-01 · 74 liquidity-vacuum guard ✅ wired (MAX_ENTRY_SPREAD) · 75 kill-switch levels 🟡 `RiskPosture` ladder

### H) Controlled Learning
76 shadow twin 📄 · 77 offline training 📄 · 78 soft-params only 🟡 `governance` · 79 canary rollout 🟡 `governance` + `getCanaryFraction()` ·
80 auto rollback 🟡 `governance.shouldRollback()` · 81 drift detection 📄 · 82 feature-store versioning 📄 · 83 A/B testing 📄 ·
84 strategy darwinism 📄 · 85 meta "don't trade" 📄  (all gated by `REQUIRE_VALIDATION`)

### I) Reliability & Recovery
86 hot failover 📄 · 87 stateless workers + state store 🟡 (Postgres state) · 88 graceful shutdown 📄 ·
89 crash-only design 🟡 · 90 reconciliation loop 🟡 · 91 backpressure 📄 · 92 central throttler 📄 ·
93 retry+jitter 🟡 `withRetry` · 94 circuit breakers 🟡 `riskPosture`

### J) Security, Compliance, Ops
95 least-privilege keys ✅ · 96 secrets hygiene ✅ (`.env` untracked, server-side) · 97 IP allowlist + rotation 🟡 (documented) ·
98 audit trail 🟡 `system_log` · 99 observability 🟡 · 100 runbooks ✅ `INSTITUTIONAL-SPEC` §C

## 4. Recommended defaults (to get the requested behaviour)

USDT base · Spot only (Futures only if consciously enabled) · max open positions
6–12 (raise only after stable KPIs) · SL ~1% (staged exit) · TP net-based (~1%
net if costs allow, else no entry) · time-stop 30–180s for scalps · **daily loss
1.5–3% hard**. Start Paper/Shadow → Canary 5–10% → scale on stable fill-rate /
slippage / drawdown. (Maps to the **Conservative** profile + risk-off defaults.)

## 5. Operating runbook (short)

1. **Connect:** least-privilege key + IP allowlist; keys in env; WS up + fresh.
2. **Paper/Shadow:** every decision logged; measure fill/slippage/frequency/net edge;
   tighten filters until few false positives.
3. **Canary live:** 5–10% capital, profit-lock + reserve on, hard daily loss.
4. **Scale:** raise positions gradually; add scanners one at a time; auto-tune
   only after full monitoring works.
5. **Incident:** WS stale / API burst / slippage spike / abnormal DD → reduce →
   maker-only → freeze → halt (kill-switch ladder) → reconcile → postmortem → resume.

## 6. Honest bottom line

This is a "spider-web" of layers: everything connected, controlled, logged,
backed up — so there are no holes and no uncontrolled leakage of risk or capital.
That discipline is the deliverable. It does **not** promise profit, "zero-miss",
or omniscience — those are structural limits, not missing modules. Built this way,
trading becomes a **controlled engineering process**, which is exactly the goal.
