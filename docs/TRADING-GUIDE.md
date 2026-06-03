# Trading Guide — methodology, platform rules, and when-to / when-not

> The knowledge base behind the engine: how it trades, the Gate.io rules it must
> obey, and the operational "yes / no" logic. Companions:
> [`ARCHITECTURE.md`](./ARCHITECTURE.md), [`SECURITY-AND-ROADMAP.md`](./SECURITY-AND-ROADMAP.md).
>
> ⚠️ Fees, limits and rate caps below are approximate and **change over time** —
> verify the live numbers in Gate.io's docs/account before relying on them.

## 1. The honest premise (read first)

This system is a **disciplined execution + validation framework**, not a money
printer. Two truths it is built around:

- **Engineering problems have solutions** — fees, latency, risk, persistence,
  observability — and the roadmap solves them one by one.
- **A guaranteed market edge is not an engineering problem; it is structural.**
  A known, repeatable edge attracts capital that arbitrages it away
  (reflexivity). So the system's job is to (a) cost as little as possible,
  (b) control risk ruthlessly, and (c) *measure honestly* whether any edge
  exists before risking money — never to assume one.

Everything below serves those three goals.

## 2. Strategy methodology (what the engine actually does)

| Strategy | Idea | When it can work | Main risk |
|---|---|---|---|
| **Scalping** (rapid/micro/tick) | Many tiny moves, quick in/out | Liquid pairs, tight spreads, low fees | Fees/slippage eat the edge |
| **Dip-buy / mean-reversion** | Buy panic drops that overshoot | Real overreactions with returning bid | "Falling knife" — keeps dropping |
| **Momentum / breakout** | Ride a confirmed move | Clean trends, real volume | False breakouts, chop |
| **Spread / market-making** | Quote both sides, earn the spread | Stable, liquid books | Inventory risk, adverse selection |
| **Cross-venue / funding** (roadmap) | Capture mispricings / carry | Delta-neutral setups | Basis drift, leg risk |

**Cost gate (the rule that kills most "opportunities"):** a trade is only taken
if `expected_edge > round-trip_fees + expected_slippage`. On a small account this
single rule rejects the majority of signals — correctly.

## 3. Technology stack (and why)

- **Frontend:** React + Vite + TypeScript + shadcn/Tailwind, PWA — a fast,
  installable desktop dashboard.
- **Backend:** Supabase Edge Functions (Deno) hold the keys server-side and sign
  requests; Postgres stores state/trades/logs. Keys never touch the browser.
- **Exchange:** Gate.io v4 REST (and WebSocket on the roadmap for low latency).
- **Validation:** backtest + walk-forward + skill-score/calibration — the truth
  detector that says whether an edge is real or noise.

## 4. Gate.io platform rules (what the code must obey)

- **Base / auth:** `https://api.gateio.ws/api/v4`. Private calls need headers
  `KEY`, `Timestamp`, and `SIGN` = `HMAC-SHA512( METHOD \n PATH \n query \n
  SHA512(body) \n timestamp )`. (Missing `SIGN` → rejected; this was bug F6.)
- **Order types:** `limit` and `market`; `time_in_force`: `gtc` (rest on book),
  `ioc` (immediate-or-cancel, taker), `poc` (post-only / maker-only). The engine
  uses **limit + ioc** for controlled fills and prefers maker where possible.
- **Fees:** ≈ **0.2% per side** standard spot; **reduced** by holding **GT** and
  by **VIP volume tiers**. Maker ≤ taker on higher tiers. Fees compound with
  turnover — fewer, better trades beat churn. *Verify current rates.*
- **Minimums & precision:** each pair has a **min order size** (often ~$1–3
  notional) and **amount/price precision** (tick/lot). Orders must be rounded to
  the pair's precision or they are rejected.
- **Leveraged tokens** (`*3L/3S/5L/5S`, `*UP/DOWN`): high time-decay, not true
  leverage you control. The engine **filters these out** on purpose.
- **Rate limits:** private endpoints are throttled (order ops in the
  hundreds/min range). Cache market data, batch, and back off on 429/`TOO_MANY`.
- **Settlement:** spot is real coins in your account (no liquidation). Futures
  *do* have liquidation — this project is **spot-only** and **no leverage**.

## 5. Operational rules — when YES, when NO

**Enter only when ALL hold:**
- Liquidity: order-book depth ≥ ~1.5× the intended size (else partial/slippage).
- Spread: tighter than the strategy's max (wider in high vol, see profiles).
- Edge: `expected_edge > fees + slippage` (the cost gate).
- Risk: within per-trade cap, open-positions cap, trades/hour throttle.
- Health: not in daily-loss halt, kill switch off, data fresh (not stale).

**Do NOT enter when ANY holds:**
- Thin book / wide spread / size too small (< pair minimum).
- Edge ≤ cost, or edge suspiciously huge (> ~5% ⇒ likely stale data — rejected).
- Daily-loss limit hit, drawdown defense mode, or kill switch engaged.
- Leveraged token, or price drifted past tolerance since the signal.

**Exit / manage:** stop-loss always set; take-profit ladders; trailing stop after
profit; time-stop for stale positions; reconcile against the exchange on restart.

## 6. The autopilot modes (the selector)

Set in the **Autopilot** tab. A mode controls **aggression only** — never the
safety floor.

| Mode | Size | Frequency | Edge bar | Use when |
|---|---|---|---|---|
| **Conservative** | small | low | high | proving the system, thin balance |
| **Balanced** | medium | medium | medium | sensible default |
| **Aggressive** | larger | high | low | confident regime — *still capped, still no leverage* |
| **Custom** | you set | you set | you set | you want explicit control (clamped to safe bounds) |
| **Auto** | adaptive | adaptive | adaptive | let it read volatility, trend, **balance & drawdown** live |

**AUTO logic:** start from Balanced, then size **down** in high volatility,
thin balance, or drawdown; lean **in** modestly on clean trends in calm markets.
Everything is clamped to hard bounds.

**Two-level control:** the system trades only when **(a)** the loop is *started*
(`is_active`) **and (b)** **Autopilot is ON**. Default autopilot is **OFF** —
nothing opens until you enable it.

## 7. The safety floor (server-only, mode-independent)

No mode — not even Aggressive or Custom — can cross these. They live in server
env (`_shared/safety.ts`) and are owner-only:

- **DRY_RUN by default** — real data, real decisions, **no live order** until
  `TRADING_MODE=LIVE`.
- **Per-order USDT cap**, **daily-loss halt**, **open-positions** and
  **trades/hour** ceilings.
- **KILL_SWITCH** — instant global stop.
- **REQUIRE_VALIDATION** — LIVE is refused until a backtest is signed off.
- **No leverage; spot only.** Least-privilege, IP-restricted keys (no withdraw).

> **aggressive ≠ leveraged ≠ unsafe.** Aggression is "more of the allowed thing",
> bounded by a floor you alone control.

## 8. What's possible vs. not

**Possible (engineering — on the roadmap):** lower fees (maker, GT/VIP),
lower latency (VPS + WebSocket), robust risk/persistence, real backtests, full
position lifecycle, alerts, adaptive sizing, clean consolidation.

**Not possible (structural):** a guaranteed, permanent, risk-free edge; "no
simulation, always wins"; turning a tiny account into a fortune with aggression.
Those aren't unsolved bugs — they contradict how markets work. The system is
honest about this on purpose; that honesty is the feature.
