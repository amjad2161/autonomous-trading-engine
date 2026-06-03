// =============================================================================
// VALIDATION — THE EDGE DETECTOR  (Master Spec §validation; the LIVE gate)
// =============================================================================
// Pure scoring metrics that answer the only question that matters before risking
// money: does the model actually beat the market, or is positive P&L just luck?
// A positive backtest P&L is NOT proof of edge — skill score vs the market is.
// =============================================================================

function clampProb(p: number, eps = 1e-9): number {
  return Math.min(1 - eps, Math.max(eps, p));
}

/** Brier score: mean squared error of probabilistic predictions (lower better). */
export function brierScore(preds: number[], outcomes: number[]): number {
  const n = Math.min(preds.length, outcomes.length);
  if (n === 0) return NaN;
  let s = 0;
  for (let i = 0; i < n; i++) s += (preds[i] - outcomes[i]) ** 2;
  return s / n;
}

/** Log loss (cross-entropy), lower is better. */
export function logLoss(preds: number[], outcomes: number[]): number {
  const n = Math.min(preds.length, outcomes.length);
  if (n === 0) return NaN;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const p = clampProb(preds[i]);
    s += -(outcomes[i] * Math.log(p) + (1 - outcomes[i]) * Math.log(1 - p));
  }
  return s / n;
}

/**
 * Skill score vs a reference (e.g. the market's implied probability):
 *   1 - modelBrier / refBrier.
 * > 0  => the model is better than the reference (real edge signal).
 * ~ 0  => no edge over the market. < 0 => worse than the market.
 */
export function skillScore(modelBrier: number, refBrier: number): number {
  if (!(refBrier > 0)) return 0;
  return 1 - modelBrier / refBrier;
}

export interface CalibrationBin {
  low: number;
  high: number;
  predMean: number;
  outcomeRate: number;
  count: number;
}

/** Reliability/calibration curve: predicted prob vs realized frequency. */
export function calibration(preds: number[], outcomes: number[], bins = 10): CalibrationBin[] {
  const n = Math.min(preds.length, outcomes.length);
  const out: CalibrationBin[] = [];
  for (let b = 0; b < bins; b++) {
    const low = b / bins;
    const high = (b + 1) / bins;
    let ps = 0, os = 0, c = 0;
    for (let i = 0; i < n; i++) {
      const p = preds[i];
      if (p >= low && (p < high || (b === bins - 1 && p <= high))) {
        ps += p; os += outcomes[i]; c++;
      }
    }
    out.push({ low, high, predMean: c ? ps / c : 0, outcomeRate: c ? os / c : 0, count: c });
  }
  return out;
}

/** Simple Sharpe of a per-trade return series (mean/stddev). Guarded. */
export function sharpe(returns: number[]): number {
  const n = returns.length;
  if (n < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / n;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  const sd = Math.sqrt(variance);
  return sd > 0 ? mean / sd : 0;
}

export interface EdgeVerdict {
  hasEdge: boolean;
  skill: number;
  modelBrier: number;
  marketBrier: number;
  reason: string;
}

/**
 * The LIVE gate: declares an edge ONLY if the model beats the market reference
 * by at least `minSkill` (default tiny, deliberately strict-but-fair).
 */
export function edgeVerdict(preds: number[], marketPreds: number[], outcomes: number[], minSkill = 0.01): EdgeVerdict {
  const modelBrier = brierScore(preds, outcomes);
  const marketBrier = brierScore(marketPreds, outcomes);
  const skill = skillScore(modelBrier, marketBrier);
  const hasEdge = skill >= minSkill;
  return {
    hasEdge,
    skill: Number.isFinite(skill) ? skill : 0,
    modelBrier,
    marketBrier,
    reason: hasEdge
      ? `skill ${skill.toFixed(4)} >= ${minSkill} — beats the market reference`
      : `skill ${skill.toFixed(4)} < ${minSkill} — no edge over the market`,
  };
}
