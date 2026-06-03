// =============================================================================
// AI GOVERNANCE  (Master Spec A2.3, #76–#80)
// =============================================================================
// Stops a model/strategy from "grabbing the wheel". Pure decision helpers:
//   - roles: LIVE (approved) / SHADOW (paper twin) / CANARY (tiny live %)
//   - passesAcceptance(): no promotion without acceptance tests (#79)
//   - shouldRollback(): auto-revert on KPI degradation vs baseline (#80)
//   - canPromote(): gated SHADOW -> CANARY -> LIVE progression
// A model may only ever adjust SOFT params; hard guardrails (safety.ts) are
// off-limits and not represented here on purpose.
// =============================================================================

export type ModelRole = "SHADOW" | "CANARY" | "LIVE";

export interface KpiSnapshot {
  fillRatePct: number;     // 0..100
  avgSlippagePct: number;  // lower is better
  maxDrawdownPct: number;  // positive number, lower is better
  profitFactor: number;    // >1 is good
  winRatePct?: number;
}

export interface AcceptanceThresholds {
  minFillRatePct: number;
  maxSlippagePct: number;
  maxDrawdownPct: number;
  minProfitFactor: number;
}

export const DEFAULT_ACCEPTANCE: AcceptanceThresholds = {
  minFillRatePct: 55,
  maxSlippagePct: 0.4,
  maxDrawdownPct: 6,
  minProfitFactor: 1.1,
};

export interface GateResult {
  ok: boolean;
  failures: string[];
}

/** Acceptance test gate (#79): a candidate may not be promoted unless it passes. */
export function passesAcceptance(kpi: KpiSnapshot, t: AcceptanceThresholds = DEFAULT_ACCEPTANCE): GateResult {
  const failures: string[] = [];
  if (kpi.fillRatePct < t.minFillRatePct) failures.push(`fillRate ${kpi.fillRatePct}% < ${t.minFillRatePct}%`);
  if (kpi.avgSlippagePct > t.maxSlippagePct) failures.push(`slippage ${kpi.avgSlippagePct}% > ${t.maxSlippagePct}%`);
  if (kpi.maxDrawdownPct > t.maxDrawdownPct) failures.push(`drawdown ${kpi.maxDrawdownPct}% > ${t.maxDrawdownPct}%`);
  if (kpi.profitFactor < t.minProfitFactor) failures.push(`profitFactor ${kpi.profitFactor} < ${t.minProfitFactor}`);
  return { ok: failures.length === 0, failures };
}

/** Allowed promotion path: SHADOW -> CANARY -> LIVE, each gated by acceptance. */
export function canPromote(from: ModelRole, kpi: KpiSnapshot, t: AcceptanceThresholds = DEFAULT_ACCEPTANCE): { to: ModelRole | null; gate: GateResult } {
  const gate = passesAcceptance(kpi, t);
  if (!gate.ok) return { to: null, gate };
  if (from === "SHADOW") return { to: "CANARY", gate };
  if (from === "CANARY") return { to: "LIVE", gate };
  return { to: null, gate }; // already LIVE
}

export interface RollbackThresholds {
  /** Relative profit-factor drop that triggers rollback, e.g. 0.25 = -25%. */
  profitFactorDropFrac: number;
  /** Absolute drawdown worsening (pp) that triggers rollback. */
  drawdownWorsenPp: number;
  /** Absolute fill-rate drop (pp) that triggers rollback. */
  fillRateDropPp: number;
  /** Absolute slippage rise (pp) that triggers rollback. */
  slippageRisePp: number;
}

export const DEFAULT_ROLLBACK: RollbackThresholds = {
  profitFactorDropFrac: 0.25,
  drawdownWorsenPp: 3,
  fillRateDropPp: 15,
  slippageRisePp: 0.2,
};

export interface RollbackDecision {
  rollback: boolean;
  reasons: string[];
}

/**
 * Auto-rollback (#80): compare current KPIs to the approved baseline and revert
 * if performance has materially degraded. Conservative: ANY breach -> rollback.
 */
export function shouldRollback(
  baseline: KpiSnapshot,
  current: KpiSnapshot,
  t: RollbackThresholds = DEFAULT_ROLLBACK,
): RollbackDecision {
  const reasons: string[] = [];

  if (baseline.profitFactor > 0) {
    const drop = (baseline.profitFactor - current.profitFactor) / baseline.profitFactor;
    if (drop >= t.profitFactorDropFrac) reasons.push(`profitFactor down ${(drop * 100).toFixed(0)}%`);
  }
  if (current.maxDrawdownPct - baseline.maxDrawdownPct >= t.drawdownWorsenPp) {
    reasons.push(`drawdown worse by ${(current.maxDrawdownPct - baseline.maxDrawdownPct).toFixed(1)}pp`);
  }
  if (baseline.fillRatePct - current.fillRatePct >= t.fillRateDropPp) {
    reasons.push(`fillRate down ${(baseline.fillRatePct - current.fillRatePct).toFixed(1)}pp`);
  }
  if (current.avgSlippagePct - baseline.avgSlippagePct >= t.slippageRisePp) {
    reasons.push(`slippage up ${(current.avgSlippagePct - baseline.avgSlippagePct).toFixed(2)}pp`);
  }

  return { rollback: reasons.length > 0, reasons };
}
