# Requests coverage — every ask vs. its status

> Cross-references each request made across the conversation to what was built
> and where. ✅ done · 🟡 partial/blocked-on-you · ⛔ declined (with reason).

| # | Your request | Status | Where / note |
|---|---|---|---|
| 1 | Analyze the repos from the foundation, architecture; unify into one project | ✅ | `docs/ARCHITECTURE.md` + `ARCHITECTURE-DIAGRAM.md`; `tradingboy` now points to this canonical repo |
| 2 | Security: fix the committed `.env`, the auth hole, the leaked key | ✅ | `.env` untracked + `.gitignore`; `_shared/auth.ts` closes `verify_jwt=false`; **leaked key: revoke it** (urged repeatedly) |
| 3 | Autonomous autopilot bot for Gate.io: modes, aggressiveness, **mode selector**, full control | ✅ | `_shared/profiles.ts`, `TradingModePanel`, `config` function, orchestrator wired (two-level: is_active + Autopilot) |
| 4 | Autopilot **by the market and the balance** (adaptive) | ✅ | AUTO mode in `profiles.adaptiveParams()` (volatility/trend/balance/drawdown) |
| 5 | All info: methodology, technologies, rules, platform rules, when-to/when-not | ✅ | `docs/TRADING-GUIDE.md` |
| 6 | Spline dashboard **design** | ✅ | Embedded as the default dashboard background (`SplineScene` + `DashboardLayout`), scene `xrddGswnEh9JfZEJ`. Override/disable via `VITE_SPLINE_SCENE_URL` |
| 7 | Institutional spec: Layers 2 & 3, 100 improvements, runbooks | ✅ cores | `docs/MASTER-SPEC.md` (100-item traceability), `INSTITUTIONAL-SPEC.md`; pure cores built, runtime-only items marked 📄 |
| 8 | "Decipher Gate.io's algorithms / data collection" | ✅ | `_shared/gate-rules.ts` — public mechanics modelled precisely (fees/VIP/GT, TIF, price-time matching, precision/min, rate limits, WS) + per-symbol rules loader |
| 9 | Install & operate it **on my own computer** | ✅ | `docs/RUN-LOCAL.md` + `scripts/local-ticker.mjs` (`npm run ticker`); keys stay in a gitignored local `.env` |
| 10 | Embed my live API key in the code | ⛔ | Declined — a secret in code goes to git/GitHub (leaves your machine) and this key has **Withdraw**. Code already reads keys from env; that IS the integration |
| 11 | Continue end-to-end until the project is finished | ✅* | All buildable logic done + tested; *operational finish (deploy, live HTTP wiring, WS telemetry, running it) needs **your** runtime — see `PROJECT-STATUS.md` |
| 12 | Edge detector — is there actually an edge? | ✅ | `_shared/validation.ts` (Brier/log-loss/skill/calibration/Sharpe) + **walk-forward**; `edge-test` function on real data. Verdict on real BTC/ETH: **no reliable edge** |
| 13 | "Super-maximal profit from every action", "zero-miss", "all-knowing, self-improving" | ⚠️ | Honest: structurally impossible — not a missing module. Built the **discipline** (governance, invariants, validation) that protects capital instead |

## Quality bar (verified this session)
- **86** Deno logic tests pass (`deno test supabase/functions/_shared/`).
- Frontend: `tsc --noEmit` exit 0, `vite build` OK, ESLint clean on touched files.
- Edge detector run on **real** market data → honest "no edge" verdict.

## Genuinely open items (need you)
- **Deploy & go-live path** (#11): run locally per `RUN-LOCAL.md`, then deploy;
  pass `edge-test` on real data before ever setting `TRADING_MODE=LIVE`.
- **Revoke the exposed key** (#2/#10) and create a least-privilege one.
