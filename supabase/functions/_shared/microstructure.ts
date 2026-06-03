// =============================================================================
// MICROSTRUCTURE FEATURES  (Master Spec #27, #28, #29)
// =============================================================================
// Pure order-book / price-action features that feed toxicity, regime and the
// no-trade decision. No I/O.
// =============================================================================

export type Level = [number, number]; // [price, amount]

/** Top-N cumulative size on a side, in base units. */
function topSize(levels: Level[], n: number): number {
  return levels.slice(0, n).reduce((s, [, amt]) => s + Math.max(0, amt), 0);
}

/**
 * Order-book imbalance in [-1, 1] over the top N levels:
 *   +1 = all bids (buy pressure), -1 = all asks (sell pressure).
 */
export function orderBookImbalance(bids: Level[], asks: Level[], n = 5): number {
  const b = topSize(bids, n);
  const a = topSize(asks, n);
  if (b + a <= 0) return 0;
  return (b - a) / (b + a);
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}
function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

/**
 * Imbalance STABILITY in [0, 1] (#28): a persistent imbalance is meaningful; a
 * flickering one is noise. 1 = rock-steady, → 0 = noisy. Computed as
 * 1 - stddev (imbalance is already bounded to [-1,1], so stddev ≤ 1).
 */
export function imbalanceStability(imbalanceSeries: number[]): number {
  if (imbalanceSeries.length < 2) return 0;
  return Math.max(0, Math.min(1, 1 - stddev(imbalanceSeries)));
}

/** Fraction of returns whose absolute move exceeds `thresholdPct` (#29). */
export function jumpRate(returnsPct: number[], thresholdPct = 1): number {
  if (returnsPct.length === 0) return 0;
  const jumps = returnsPct.filter((r) => Math.abs(r) >= thresholdPct).length;
  return jumps / returnsPct.length;
}

/** True when jump rate is too high to trade safely (#29). */
export function isJumpy(rate: number, maxRate = 0.2): boolean {
  return rate > maxRate;
}
