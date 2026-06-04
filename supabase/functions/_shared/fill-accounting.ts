// =============================================================================
// FILL ACCOUNTING  —  shared, pure decision for "how much of the position did
// this sell actually close, and is anything left?"
// =============================================================================
//
// Every engine that exits a position via an IOC market sell faces the same
// subtlety: the order may only PARTIALLY cross. If the code books P&L on the
// full requested size and drops the whole position, it overstates realized P&L
// (which feeds the daily-loss gate) and orphans the unsold base. The fix is
// always the same three-part decision — fall back safely when the exchange
// omits the filled amount, clamp the sold size to the position, and decide
// "fully closed" against a small threshold. That decision lives here once so it
// is identical across micro-scalper, master-brain, and any future engine, and
// so it can be unit-tested in isolation (the P&L *value* model — price-delta vs
// percentage — stays with each caller).
// =============================================================================

export interface FillSplit {
  /** Base amount actually sold (the exchange's filled amount, or a safe fallback). */
  soldBase: number;
  /** soldBase / positionAmount, clamped to [0, 1]. Multiply mark-to-market P&L by this. */
  fraction: number;
  /** True when the sell effectively closed the whole position (≥ threshold). */
  fullyClosed: boolean;
  /** Base still held after this sell (0 when fully closed). */
  residualBase: number;
}

/**
 * Decide how a sell fill splits a position into "closed" vs "residual".
 *
 * @param positionAmount  Base size of the open position before this sell.
 * @param filledAmount    Base reported filled by the exchange. When missing,
 *                        zero, or non-finite we fall back to treating the sell
 *                        as fully filled — exits must never silently under-book
 *                        a real fill into a phantom residual.
 * @param fullCloseThreshold Fraction at/above which the position is considered
 *                        closed (default 0.999, absorbing rounding + the ~0.2%
 *                        sell-amount haircut engines apply).
 */
export function splitFill(
  positionAmount: number,
  filledAmount?: number,
  fullCloseThreshold = 0.999,
): FillSplit {
  // Guard a degenerate / empty position: nothing to split, treat as closed.
  if (!Number.isFinite(positionAmount) || positionAmount <= 0) {
    return { soldBase: 0, fraction: 1, fullyClosed: true, residualBase: 0 };
  }

  // Safe fallback: a missing/zero/non-finite fill means "assume fully sold"
  // rather than risk leaving a phantom residual on the books.
  const reported = Number.isFinite(filledAmount as number) && (filledAmount as number) > 0
    ? (filledAmount as number)
    : positionAmount;

  // Never claim to have sold more than we held.
  const soldBase = Math.min(reported, positionAmount);
  const fraction = Math.min(1, soldBase / positionAmount);
  const fullyClosed = fraction >= fullCloseThreshold;

  return {
    soldBase,
    fraction,
    fullyClosed,
    residualBase: fullyClosed ? 0 : positionAmount - soldBase,
  };
}
