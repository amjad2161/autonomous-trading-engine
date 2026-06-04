// =============================================================================
// MARKET MAKING / SPREAD CAPTURE  (analysis rank #2 viable method)
// =============================================================================
// Pure quoting logic: where to place bid/ask, how much spread you actually keep
// after maker fees, and how to skew quotes to offload inventory. Viable ONLY
// when the spread exceeds round-trip maker fees — otherwise you pay to provide
// liquidity. Capital-agnostic. No I/O.
// =============================================================================

export interface Quotes {
  bid: number;
  ask: number;
}

/**
 * Bid/ask around `mid` at +/- `halfSpreadBps`, shifted by inventory `skew`
 * (-1..1). Positive skew = too long -> shift both quotes DOWN (more likely to
 * sell, less to buy) to mean-revert inventory toward flat.
 */
// How much inventory skew may shift the quote center, as a fraction of the
// half-spread. Capped below 1 so even at full skew BOTH sides keep positive
// edge over mid (at skew=1: ask = mid*(1 + (1-SKEW_MAX)*half) > mid).
const SKEW_MAX = 0.6;

export function quotePrices(mid: number, halfSpreadBps: number, skew = 0): Quotes {
  const half = Math.max(0, halfSpreadBps) / 10000;
  const shift = Math.max(-1, Math.min(1, skew)) * half * SKEW_MAX;
  return {
    bid: mid * (1 - half - shift),
    ask: mid * (1 + half - shift),
  };
}

/**
 * Net spread captured on a full round trip (buy bid, sell ask), in bps:
 *   captured spread (2*halfSpread) minus round-trip maker fees (2*fee).
 * Negative => you lose money making markets at this spread.
 */
export function roundTripSpreadCaptureBps(halfSpreadBps: number, makerFeeBps: number): number {
  return 2 * Math.max(0, halfSpreadBps) - 2 * Math.max(0, makerFeeBps);
}

/** Market making is only viable when the spread more than covers round-trip maker fees. */
export function mmViable(halfSpreadBps: number, makerFeeBps: number): boolean {
  return roundTripSpreadCaptureBps(halfSpreadBps, makerFeeBps) > 0;
}

/** Inventory skew in [-1, 1]: how far current position is toward its cap. */
export function inventorySkew(position: number, maxInventory: number): number {
  if (!(maxInventory > 0)) return 0;
  return Math.max(-1, Math.min(1, position / maxInventory));
}
