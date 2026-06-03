# Project Status — what's done, what needs your runtime, how to verify

> Honest completion state. This was built in an environment with **no network,
> no Deno, no Supabase, no node_modules** — so everything here is written and
> reviewed by reading, and the steps that need a live runtime are called out
> explicitly. Nothing below is claimed as "run and verified" unless you run it.

## ✅ Done (implemented + unit-tested by reading)

**Safety & security**
- `.env` untracked; `.gitignore` + `.env.example`; server-side keys only.
- Shared-secret auth guard on the privileged functions (closes `verify_jwt=false`).
- Unified safety floor: `TRADING_MODE` (DRY_RUN default), `KILL_SWITCH`, risk caps,
  `REQUIRE_VALIDATION`, `CANARY_CAPITAL_PCT`, no-leverage — wired into **all 15**
  live-order sites.

**Brains & governance (pure, tested cores)**
- Modes/autopilot (`profiles.ts`) + runtime control UI (`TradingModePanel`, `config`).
- Formal invariants (`invariants.ts`, INV-01..05) — wired into the orchestrator.
- Real-time posture/health/toxicity/personality/capital-routing/latency (`health.ts`).
- Net-edge cost model + dynamic sizing + scoring (`scoring.ts`).
- Market-data hygiene + microstructure (`market-data.ts`).
- Treasury/capital management (`treasury.ts`).
- Execution ordering + staged exits + order FSM (`execution.ts`, `order-state.ts`).
- Shadow/Canary/rollback governance (`governance.ts`).
- Deterministic replay / event sourcing (`replay.ts` + `event_log` migration).
- Observability KPIs + alerts (`metrics.ts`).
- Edge detector + real Gate.io data loader (`validation.ts`, `dataset.ts`).

**Docs:** ARCHITECTURE, ARCHITECTURE-DIAGRAM, MASTER-SPEC (100-item traceability),
INSTITUTIONAL-SPEC, TRADING-GUIDE, SECURITY-AND-ROADMAP, LOVABLE-PROMPT.

**Proofs:** 8 Deno test suites (`supabase/functions/_shared/*.test.ts`).

## 🟡 Needs your runtime to *finish* (cannot be done from this sandbox)

These are real, remaining steps that require network / Deno / Supabase / your keys:

1. **Run the proofs & build:** `deno test supabase/functions/_shared/` and
   `npm i && npm run build`. (I could not execute them here.)
2. **Deploy:** `supabase functions deploy` + apply the migration; set server
   secrets (`TRADING_MODE`, `GATE_API_KEY/SECRET` least-privilege, `FUNCTION_SHARED_SECRET`,
   caps). Set frontend `.env` from `.env.example`.
3. **Wire the live execution path:** route the orchestrator's real order calls
   through `execution.ts` (priority queue / staged exits) + `order-state.ts`. The
   decision cores are done; the HTTP plumbing must be connected against the live
   API and observed in DRY_RUN first.
4. **WS telemetry** for INV-01/INV-05 (staleness, cancel-rate) — needs a live
   WebSocket feed; the invariant checks are ready to receive it.
5. **Run the real-data backtest:** call `dataset.fetchGateCandles` →
   `validation.edgeVerdict` to get the honest verdict on whether there's an edge.
   This needs network. **This gate should pass before `TRADING_MODE=LIVE`.**

## How to verify locally

```bash
# 1) proofs (pure logic)
deno test supabase/functions/_shared/

# 2) frontend builds
npm i && npm run build

# 3) paper-first run (real data, real decisions, NO live orders)
supabase secrets set TRADING_MODE=DRY_RUN
#    ...deploy functions, open the dashboard, turn Autopilot ON, watch it shadow-trade
```

## Bottom line

The **engineering** of the institutional spec — safety, governance, invariants,
net-edge discipline, execution logic, replay, observability, the edge detector —
is built and unit-tested. What remains is **operational**: run it, deploy it,
connect the live plumbing, and let the edge detector deliver its verdict on real
data. None of that is shortcuttable, and the honest result on a fair market may
well be "no reliable edge" — the system is designed to tell you that truthfully
rather than pretend otherwise.
