// =============================================================================
// TREASURY & CAPITAL MANAGEMENT  (Master Spec §2.1; #1–#15)
// =============================================================================
// Pure capital-management logic: dynamic USDT target, rebalance plan to reach
// it, fee buffer, profit-lock, and per-symbol exposure room. No I/O — callers
// fetch balances and execute the returned plan through the safety-gated executor.
// =============================================================================

export interface Holding {
  asset: string;        // e.g. "BTC"
  amountUsdt: number;   // liquid value in USDT (use depth-based valuation, not last)
  inMission?: boolean;  // true if part of an open strategy position
}

/** Dynamic USDT dominance target (%), higher under stress/toxicity (#3). */
export function dynamicUsdtTargetPct(toxicity: number): number {
  // toxicity 0 -> 45% cash; toxicity 1 -> 80% cash
  const t = Math.min(1, Math.max(0, toxicity));
  return Math.round(45 + 35 * t);
}

export interface RebalanceAction {
  asset: string;
  action: "SELL_TO_USDT";
  amountUsdt: number;
  reason: string;
}

/**
 * Build a rebalance plan to raise USDT toward target by converting IDLE assets
 * (not in a mission) — largest first (#11). Never touches mission holdings.
 */
export function rebalancePlan(holdings: Holding[], equityUsdt: number, targetUsdtPct: number, currentUsdt: number): RebalanceAction[] {
  const targetUsdt = (equityUsdt * targetUsdtPct) / 100;
  let need = targetUsdt - currentUsdt;
  if (need <= 0) return [];
  const idle = holdings
    .filter((h) => !h.inMission && h.amountUsdt > 0)
    .sort((a, b) => b.amountUsdt - a.amountUsdt);
  const plan: RebalanceAction[] = [];
  for (const h of idle) {
    if (need <= 0) break;
    const sell = Math.min(h.amountUsdt, need);
    plan.push({ asset: h.asset, action: "SELL_TO_USDT", amountUsdt: round2(sell), reason: "raise USDT dominance" });
    need -= sell;
  }
  return plan;
}

/** Fee buffer check (#4): keep a fixed USDT reserve for fees; block entries if breached. */
export function feeBufferOk(usdt: number, feeBufferUsdt: number): boolean {
  return usdt >= feeBufferUsdt;
}

/**
 * Profit-lock (#6): amount to move into the protected vault when equity exceeds
 * the locked baseline by more than `lockStepPct`. Returns 0 if below threshold.
 */
export function profitLockAmount(equityUsdt: number, lockedBaselineUsdt: number, lockStepPct: number): number {
  const gain = equityUsdt - lockedBaselineUsdt;
  const stepUsdt = (lockedBaselineUsdt * lockStepPct) / 100;
  if (gain <= stepUsdt || stepUsdt <= 0) return 0;
  // lock the portion above the step, leaving the step as working room
  return round2(gain - stepUsdt);
}

/** Remaining room (USDT) under a per-symbol exposure cap (#7). */
export function exposureRoomUsdt(currentSymbolExposureUsdt: number, capUsdt: number): number {
  return Math.max(0, capUsdt - Math.max(0, currentSymbolExposureUsdt));
}

/** Liquidity-shock sizing (#9): shrink size when depth drops vs a baseline. */
export function liquidityShockSize(baseSize: number, depthNow: number, depthBaseline: number): number {
  if (!(depthBaseline > 0)) return baseSize;
  const ratio = Math.min(1, Math.max(0, depthNow / depthBaseline));
  return baseSize * ratio;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
