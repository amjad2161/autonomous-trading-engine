# Security, Findings & Roadmap

> Produced from a full read of the codebase. Companion: [`ARCHITECTURE.md`](./ARCHITECTURE.md).
> This document is deliberately blunt: it is meant to protect a small, real account.

## 0. TL;DR

The codebase is better-engineered than a typical "scam bot" — keys are
server-side, the proxy has an endpoint allow-list, and `execute-trade` has
genuine risk checks. But before it points at real money there are **two
must-fix issues** (an auth hole and the absence of a unified paper/live gate)
and a large **consolidation debt**. The first commit on this branch fixes the
secrets hygiene, adds the unified safety layer, and closes the auth hole on the
three most dangerous endpoints. The rest is a staged plan below.

## 1. Findings (ranked)

### 🔴 F1 — World-invokable functions (auth bypass) — CRITICAL
`supabase/config.toml` sets `verify_jwt = false` on **every** function, and the
in-function check was presence-only (`if (!authHeader)`). Anyone who learns the
project URL could invoke `execute-trade`, `update-secrets`, `gate-api`, and the
live traders. They never need your Gate.io keys — **the server signs with its
own keys on their behalf.**
**Fix shipped:** `_shared/auth.ts` `requireAuth()` enforces a shared secret
(`FUNCTION_SHARED_SECRET` ↔ `x-function-secret`), constant-time compared, wired
into `execute-trade`, `gate-api`, `update-secrets`. Frontend sends the header
automatically via the Supabase client. **You must set the secret to actually
close it** (see §2). True multi-user security = Supabase Auth + RLS + `verify_jwt=true`.

### 🔴 F2 — No unified DRY_RUN / paper mode — CRITICAL for a small account
15 functions place live `/spot/orders`. Until now there was **no master switch**
to validate the whole system without sending real orders (only the isolated
`backtest` simulated anything). You could not safely watch it "trade" before
risking funds.
**Fix shipped:** `_shared/safety.ts` introduces `TRADING_MODE` (**DRY_RUN by
default**), a `KILL_SWITCH`, and hard risk caps. `execute-trade` now routes its
order through the gate: all market data / slippage / liquidity / edge checks run
against **real** data; only the final POST is withheld unless `TRADING_MODE=LIVE`.
This is the "real data, closed firing pin" model. **Now wired into all 15
live-order sites** (`execute-trade` directly; the other 14 via `guardSpotOrder()`
injected at each engine's order helper). A new optional gate
`REQUIRE_VALIDATION` downgrades LIVE→DRY_RUN until `VALIDATION_PASSED` is set, so
you can enforce "prove an edge before risking money" at the system level.

### 🟠 F3 — `.env` committed to git — MEDIUM
The tracked `.env` held only Supabase project id + anon (publishable) key — those
are public by design, so this is not a key leak — but committing env files is bad
hygiene and `.gitignore` did not exclude them.
**Fix shipped:** `.env` untracked, `.gitignore` updated, `.env.example` added.

### 🟠 F4 — Massive engine redundancy — HIGH (maintainability + safety drift)
5+ overlapping "mega" engines and 3+ scalpers each place orders through their own
helper with inconsistent risk logic (`ARCHITECTURE.md` §5). A safety fix must
currently be repeated ~10×. This is the root cause that let F2 exist.
**Plan:** §3 — collapse to one executor + one strategy interface.

### 🟡 F5 — CORS `Access-Control-Allow-Origin: *` on all functions — LOW/MED
Acceptable for a personal tool, dangerous combined with F1. Tighten to your own
origin once a domain is fixed.

### 🟡 F6 — `update-secrets` key verification was broken — FIXED
Its verification call to `/spot/accounts` sent `KEY` + `Timestamp` but **no
`SIGN`**, so Gate.io always rejected it — the "verified" path could never succeed.
**Fix shipped:** the call now computes the proper Gate.io v4 HMAC-SHA512
signature, so key verification actually works.

### 🟡 F7 — No pre-live test gate / thin tests — partially addressed
There is a `backtest` + `walk-forward`, and a growing unit suite (150+ Deno
tests over the safety floor, signer, quant cores and strategies).
**Added:** `npm run preflight` — a read-only GO/NO-GO check that verifies the
safety configuration (DRY_RUN default, kill switch, secret match, risk caps),
runs the core tests when Deno is present, and prints the exact remaining
operational steps. It returns non-zero on any hard failure, so it can gate a
launch. Still open: wiring a *passing backtest* as a hard precondition to
flipping `TRADING_MODE=LIVE`.

### 🔴 F8 — Spot MARKET BUY sized in base units (should be quote/USDT) — HIGH
Gate.io spot **market buy** orders take `amount` as the **quote (USDT)** to
spend; only limit/sell orders use base quantity. Several legacy engines computed
`amount = usdSize / price` (base units) for market buys, which (a) mis-sizes the
live order by a factor of `price` and (b) fools the safety cap, because
`safety.ts:notionalFromBody` reads a market order's `amount` as the notional.
**Fixed in all four affected engines.** Every market BUY now submits the
quote-USDT spend, and every engine stores the position's BASE size from the
*actual fill* rather than the submitted amount:
- `hyper-engine`, `realtime-trader` — already response-driven (sell the base read
  back from the fill); the buy now sends quote-USDT.
- `master-brain`, `ultimate-trader` — `executeOrder`/`placeOrder` now return the
  filled **base** quantity (preferring `filled_amount`, else
  `filled_total / avg_deal_price`), and each entry stores
  `result.filledAmount || (usd / price)` — a base estimate fallback, **never the
  quote**, so the later `sell position.amount` cannot oversell. This is safe
  offline because the stored size is always a base quantity by construction.

The fix also re-aligns the safety cap: `notionalFromBody` reads a market order's
`amount` as the notional, which is now correct (quote-USDT) for buys. The primary
live path (`autonomous-orchestrator`) was never affected — it uses **limit** buys,
where base units are correct. Long-term, F4 (collapse to one executor) removes the
duplication that let this drift across engines.

### 🔎 F10 — Follow-up code-review round on the F8/F9 fixes
A second review of the F8/F9 diff caught regressions/gaps the first pass left:
- **Phantom-fill via fallback (FIXED):** `master-brain`/`ultimate-trader` derived
  the buy base as `q = filled_total || parseFloat(amount)`. The `|| amount`
  fallback re-opened the phantom-fill hole — an unfilled LIVE market buy
  (`filled_total=0`) read back the submitted quote and opened a phantom position.
  Now uses `filled_total` only (DRY_RUN synthetics still populate it).
- **DRY_RUN base mis-read (FIXED):** `hyper-engine` read the synthetic order's
  `filled_amount`, which echoes the submitted *quote* for a market buy, so the
  simulated sell was sized wrong by a factor of price. Now derives base as
  `filled_total / price` (correct in LIVE and DRY_RUN).
- **Dead sell fallback (FIXED):** `master-brain` sell calls omitted `refPrice`, so
  the `filled_total/avg` base fallback was dead (avg=0) — a real fill that returned
  only `filled_total` would be misread as unfilled, leaving a phantom long. All
  sell sites now pass a market price.
- **Settings blind-overwrite (FIXED):** the orchestrator's `updateDBState` now
  *merges* the `settings` JSON onto the freshly-read row instead of overwriting it
  from a stale snapshot, so the day-start anchor write can't clobber concurrent
  keys (and the daily-loss breaker can't be silently re-anchored).
- **Partial-fill exit accounting:** `micro-scalper` exit now books P&L on the size
  actually sold and keeps the residual open (FIXED). `master-brain` exit/swap/dust
  sells still book the full position (mark-to-market `pos.usdValue*pnl%`) on a
  partial fill — left as-is (DEFERRED): the proportional rework across its four
  heterogeneous sell sites needs runtime fill data to verify, and IOC partials are
  low-probability. The orchestrator (primary path) is unaffected.

### 🟡 F9 — Phantom IOC fills in legacy scalpers — dangerous paths FIXED
`micro-scalper`, `rapid-trader`, `continuous-trader` treated an IOC order as fully
filled when only an `id` (or a `filled_amount || amount` fallback) was present.
The worst consequence was a **naked sell**: `rapid-trader` sold the full requested
base after an unfilled buy, and `micro-scalper` opened a phantom position then sold
base it never held.
**Fixed:** all three now require **positive fill evidence** (`filled_amount`, or
`filled_total / avg_deal_price`) before counting a fill, and size positions/sells to
the **actual filled base**. An unfilled IOC now changes nothing. This is the safe
direction — it can only *prevent* phantom trades, never create one.
**Still open (lower risk, needs runtime):** exact partial-fill exit P&L
attribution, and `continuous-trader`'s `maxDailyLoss`/`stopLossPercent` (it is a
stateless per-invocation function with no cross-call P&L memory, so a real daily
breaker belongs in the stateful `autonomous-orchestrator`, which already enforces
INV-02). The orchestrator remains the primary, fully fill-verified path.

## 2. How to run it safely

**Paper-first (default, no money at risk):**
```bash
# server (Supabase secrets) — do NOT commit these
supabase secrets set TRADING_MODE=DRY_RUN
supabase secrets set GATE_API_KEY=...        # spot + read ONLY, no withdraw/transfer
supabase secrets set GATE_API_SECRET=...
supabase secrets set FUNCTION_SHARED_SECRET=$(openssl rand -hex 32)
supabase secrets set MAX_TRADE_USDT=15 MAX_DAILY_LOSS_USDT=15 MAX_OPEN_POSITIONS=2
# frontend (.env, from .env.example) — must match the server secret
VITE_FUNCTION_SECRET=<same value as FUNCTION_SHARED_SECRET>
```
In DRY_RUN the system uses **real** market data and makes **real** decisions, but
sends **no** live orders — you watch it shadow-trade.

**Optional hard gate — require a passing backtest before live:**
```bash
supabase secrets set REQUIRE_VALIDATION=1   # LIVE is forced to DRY_RUN until...
supabase secrets set VALIDATION_PASSED=1    # ...you sign off after a good backtest
```

**Going live (a deliberate, owner-only act):** only after a backtest + a paper
forward-test look good, and with a **least-privilege, IP-restricted** key:
```bash
supabase secrets set TRADING_MODE=LIVE
```
Panic button at any time:
```bash
supabase secrets set KILL_SWITCH=1     # blocks all live orders immediately
```

**Verify the safety invariants (executable proofs):**
```bash
deno test supabase/functions/_shared/        # asserts DRY_RUN default, kill switch,
                                             # caps, validation gate, guardSpotOrder
```
These tests pin the guarantees this whole system leans on — a safety claim is
only trustworthy if it is verifiable.

## 3. Consolidation roadmap (staged — do NOT do recklessly)

Goal: **one** order path, **one** safety gate, **one** strategy interface.

1. **Central executor.** Promote `execute-trade`'s pattern into a shared
   `placeOrder()` in `_shared/` that every engine calls. It is the *only* code
   that POSTs `/spot/orders`, and it always goes through `_shared/safety.ts`.
2. **Strategy interface.** Define `Strategy { scan(); decide(); }` returning
   *intents*, not orders. Engines become strategies; the orchestrator owns the
   single execution + risk loop.
3. **Collapse engines.** Fold `master-brain`, `ultimate-trader`,
   `realtime-trader`, `continuous-trader`, `rapid-trader`, `micro-scalper`,
   `tick-processor` into strategies behind that interface; keep `hyper-engine`'s
   best signals. Delete duplicates only after parity is verified.
4. **Wire safety everywhere.** ✅ DONE — every order site now routes through the
   shared gate (`guardSpotOrder()` / `assertOrderAllowed()`). The remaining work
   is to collapse the duplicate helpers into one literal `placeOrder()` once the
   engines are merged (steps 1–3).
5. **Persist risk state.** Daily-loss / trades-per-hour / open-positions counters
   in Postgres so caps survive restarts and are enforced across functions.
6. **Pre-live gate.** CI/manual gate: backtest + walk-forward must pass before
   `TRADING_MODE=LIVE` is honoured (optionally enforce in code).
7. **Tighten infra.** CORS to your origin; consider Supabase Auth + RLS +
   `verify_jwt=true`; fix F6.

## 4. Repo unification (`tradingboy` + `autonomous-trading-engine`)

`tradingboy` is an empty stub. Unification = **this repo is the single canonical
project**; `tradingboy`'s README now points here. No code is split across two
repos. If a different split is desired (e.g. `tradingboy` = thin client,
engine = backend), define it explicitly before moving files.

## 5. Honest scope statement (carried over from prior design discussion)

- This is a **validation/learning system**, not a guaranteed money-maker. A
  positive backtest P&L is **not** proof of an edge — verify skill score /
  calibration out-of-sample (that machinery exists in `backtest`/`walk-forward`).
- On a ~$250–$1000 account, fees and minimums can dominate; a strategy whose edge
  is smaller than round-trip cost must be rejected.
- DRY_RUN-first and least-privilege keys are not limitations — they are the
  professional path and the main thing protecting the account.
- **Reminder:** any Gate.io API key that was ever pasted into a chat — especially
  one with **Withdraw** permission — must be treated as compromised and
  **revoked** in Gate.io → API Management. It does not appear anywhere in this
  repo (verified), but revoke it at the source.
