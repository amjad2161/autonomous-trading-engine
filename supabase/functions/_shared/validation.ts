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

export interface WalkForwardFold {
  n: number;
  skill: number;
  modelBrier: number;
  marketBrier: number;
}

export interface WalkForwardReport {
  folds: WalkForwardFold[];
  meanSkill: number;
  foldsWithEdge: number;
  totalFolds: number;
  /** Edge only if it beats the market in a MAJORITY of out-of-sample windows. */
  consistentEdge: boolean;
}

/**
 * Walk-forward / out-of-sample evaluation: split the timeline into contiguous
 * folds and score each independently. A real edge should persist across windows
 * — a single lucky window does not count. This is the backtest-trap defense.
 */
export function walkForwardReport(
  modelPreds: number[],
  marketPreds: number[],
  outcomes: number[],
  folds = 5,
  minSkill = 0.01,
  minFoldSize = 5,
): WalkForwardReport {
  const n = Math.min(modelPreds.length, marketPreds.length, outcomes.length);
  const k = Math.max(1, Math.min(folds, Math.floor(n / minFoldSize) || 1));
  const size = Math.floor(n / k);
  const out: WalkForwardFold[] = [];
  for (let f = 0; f < k; f++) {
    const start = f * size;
    const end = f === k - 1 ? n : start + size;
    const mp = modelPreds.slice(start, end);
    const rp = marketPreds.slice(start, end);
    const oc = outcomes.slice(start, end);
    if (oc.length < minFoldSize) continue;
    const mb = brierScore(mp, oc);
    const rb = brierScore(rp, oc);
    out.push({ n: oc.length, skill: skillScore(mb, rb), modelBrier: mb, marketBrier: rb });
  }
  const totalFolds = out.length;
  const foldsWithEdge = out.filter((x) => x.skill >= minSkill).length;
  const meanSkill = totalFolds ? out.reduce((a, b) => a + b.skill, 0) / totalFolds : 0;
  const consistentEdge = totalFolds > 0 && foldsWithEdge / totalFolds >= 0.6 && meanSkill >= minSkill;
  return { folds: out, meanSkill, foldsWithEdge, totalFolds, consistentEdge };
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
export function edgeVerdict(preds: number[], marketPreds: number[], outcomes: number[], minSkill = 0.01, minSamples = 30): EdgeVerdict {
  const n = Math.min(preds.length, marketPreds.length, outcomes.length);
  const modelBrier = brierScore(preds, outcomes);
  const marketBrier = brierScore(marketPreds, outcomes);
  const skill = skillScore(modelBrier, marketBrier);
  // A few lucky samples must NOT open the live gate — require a minimum sample.
  if (n < minSamples) {
    return {
      hasEdge: false,
      skill: Number.isFinite(skill) ? skill : 0,
      modelBrier,
      marketBrier,
      reason: `insufficient samples (${n} < ${minSamples}) — no verdict`,
    };
  }
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
