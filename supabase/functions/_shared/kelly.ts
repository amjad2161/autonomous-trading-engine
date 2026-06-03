// =============================================================================
// QUANT SIZING PRIMITIVES — expectancy, Kelly, risk-of-ruin, Sortino
// =============================================================================
// The financial backbone of disciplined sizing. Pure, unit-tested. These answer
// the questions a serious desk asks BEFORE risking a cent:
//   - expectancy: is the per-trade expected value even positive?
//   - Kelly: what fraction maximizes long-run growth (and why we bet LESS)?
//   - risk-of-ruin: what's the chance this sizing wipes the account?
// A negative-expectancy system sizes to ZERO here — by construction.
// =============================================================================

/**
 * Per-trade expected value (in the same units as avgWin/avgLoss; both passed as
 * POSITIVE magnitudes). expectancy = p*avgWin - (1-p)*avgLoss.
 * <= 0 means no edge — do not trade.
 */
export function expectancy(winProb: number, avgWin: number, avgLoss: number): number {
  const p = clamp01(winProb);
  return p * Math.max(0, avgWin) - (1 - p) * Math.max(0, avgLoss);
}

/**
 * Full Kelly fraction for a bet paying `winLossRatio` (b) to 1:
 *   f* = (b*p - q) / b = p - q/b.
 * Clamped at 0 — a non-positive edge yields 0 (never bet into negative EV).
 */
export function kellyFraction(winProb: number, winLossRatio: number): number {
  const p = clamp01(winProb);
  const b = winLossRatio;
  if (!(b > 0)) return 0;
  const f = (b * p - (1 - p)) / b;
  return Math.max(0, f);
}

/**
 * Fractional Kelly — what disciplined desks ACTUALLY use. Full Kelly is too
 * volatile (a wrong probability estimate over-bets badly), so we take a fraction
 * (default quarter-Kelly) and hard-cap it (default 20% of capital).
 */
export function fractionalKelly(winProb: number, winLossRatio: number, fraction = 0.25, cap = 0.2): number {
  const f = fractionalClamp(fraction) * kellyFraction(winProb, winLossRatio);
  return Math.min(Math.max(0, cap), Math.max(0, f));
}

/** Risk budget in USDT from fractional Kelly. Zero edge -> zero risk. */
export function kellyRiskUsdt(equityUsdt: number, winProb: number, winLossRatio: number, fraction = 0.25, cap = 0.2): number {
  return Math.max(0, equityUsdt) * fractionalKelly(winProb, winLossRatio, fraction, cap);
}

/**
 * Risk of ruin (even-money, fixed-fraction approximation; CONSERVATIVE — a real
 * payoff ratio > 1 only lowers it). Ruin = losing the whole bankroll given you
 * risk `riskFraction` of it per trade.
 *   p <= 0.5  -> 1 (certain ruin eventually)
 *   else      -> ((1-p)/p) ^ floor(1/riskFraction)
 */
export function riskOfRuin(winProb: number, riskFraction: number): number {
  const p = clamp01(winProb);
  if (p <= 0.5) return 1;
  if (!(riskFraction > 0)) return 0;
  const units = Math.max(1, Math.floor(1 / Math.min(1, riskFraction)));
  return Math.pow((1 - p) / p, units);
}

/**
 * Sortino ratio — like Sharpe but only penalizes DOWNSIDE volatility (the
 * volatility that actually hurts). Returns 0 for <2 points or no downside.
 */
export function sortino(returns: number[], target = 0): number {
  const n = returns.length;
  if (n < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / n;
  const downside = returns.filter((r) => r < target);
  if (downside.length === 0) return mean > target ? Infinity : 0;
  const dd = Math.sqrt(downside.reduce((s, r) => s + Math.pow(r - target, 2), 0) / n);
  return dd > 0 ? (mean - target) / dd : 0;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}
function fractionalClamp(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}
