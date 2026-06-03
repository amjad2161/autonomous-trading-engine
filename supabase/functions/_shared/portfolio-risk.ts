// =============================================================================
// PORTFOLIO RISK — parametric VaR guard  (Master Spec #69)
// =============================================================================
// Conservative aggregate-risk control: a simple parametric Value-at-Risk that
// assumes positions can move TOGETHER (worst case, no diversification benefit),
// so it never understates risk. Used as an entry gate. Pure, no I/O.
// =============================================================================

export interface RiskPosition {
  notionalUsdt: number;
  volatilityPct: number; // e.g. 24h volatility, percent
}

/** z-score for a one-sided confidence level. */
export function zScore(confidence: number): number {
  if (confidence >= 0.99) return 2.326;
  if (confidence >= 0.975) return 1.96;
  if (confidence >= 0.95) return 1.645;
  if (confidence >= 0.90) return 1.282;
  return 1.0;
}

/**
 * Parametric VaR in USDT. Conservative: sums notional*volatility across all
 * positions (perfect-correlation / worst-case), then scales by the z-score.
 * Returns the estimated worst-case loss at the given confidence.
 */
export function parametricVaRUsdt(positions: RiskPosition[], confidence = 0.95): number {
  const stress = positions.reduce(
    (s, p) => s + Math.max(0, p.notionalUsdt) * (Math.max(0, p.volatilityPct) / 100),
    0,
  );
  return zScore(confidence) * stress;
}

/**
 * Entry gate: may we add `add` without the portfolio VaR exceeding `capUsdt`?
 */
export function varGate(
  positions: RiskPosition[],
  add: RiskPosition,
  capUsdt: number,
  confidence = 0.95,
): { ok: boolean; varUsdt: number; cap: number } {
  const varUsdt = parametricVaRUsdt([...positions, add], confidence);
  return { ok: varUsdt <= capUsdt, varUsdt, cap: capUsdt };
}
