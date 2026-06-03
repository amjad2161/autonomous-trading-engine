// =============================================================================
// NET-EDGE SCORING & SIZING  (Master Spec §1.3, items #10, #26–35, #41, #46–47, #54)
// =============================================================================
// The whole system is "net-based": never act unless expected move beats ALL
// costs (fees + spread + slippage + latency). These are pure, conservative
// helpers — costs are always estimated UP (item #34), so the gate is strict.
// =============================================================================

export interface CostInputs {
  /** Round-trip taker/maker fee in basis points (e.g. 20 = 0.20%). */
  feeBps: number;
  /** Half-spread you expect to cross, in basis points. */
  spreadBps: number;
  /** Expected slippage as a percent (e.g. 0.05 = 0.05%). */
  slippagePct?: number;
  /** Latency penalty as a percent — slower execution demands more edge (#35). */
  latencyPenaltyPct?: number;
}

/** Total estimated round-trip cost, in PERCENT. Conservative (sums everything). */
export function estimatedCostsPct(c: CostInputs): number {
  const fee = Math.max(0, c.feeBps) / 100;        // bps -> %
  const spread = Math.max(0, c.spreadBps) / 100;  // bps -> %
  const slip = Math.max(0, c.slippagePct ?? 0);
  const lat = Math.max(0, c.latencyPenaltyPct ?? 0);
  return fee + spread + slip + lat;
}

/** Net edge in percent: expected move minus all estimated costs. */
export function netEdgePct(expectedMovePct: number, costs: CostInputs): number {
  return expectedMovePct - estimatedCostsPct(costs);
}

/** The gate: only act when net edge clears the minimum threshold. */
export function passesNetEdgeGate(expectedMovePct: number, costs: CostInputs, minNetEdgePct: number): boolean {
  return netEdgePct(expectedMovePct, costs) >= minNetEdgePct;
}

export interface SizingInputs {
  /** Risk budget for this trade in USDT (e.g. equity * riskPerTradePct). */
  riskUsdt: number;
  /** Per-unit risk fraction (stop distance as a fraction, e.g. 0.008 = 0.8%). */
  stopDistanceFrac: number;
  /** Safe size given current order-book liquidity, USDT (#9). */
  liquiditySafeUsdt: number;
  /** Remaining room under the per-symbol exposure cap, USDT (#7). */
  exposureRoomUsdt: number;
  /** Available USDT to deploy. */
  availableUsdt: number;
  /** Hard per-order cap from the safety floor, USDT. */
  hardMaxUsdt: number;
}

/**
 * Dynamic position sizing (#10): the MINIMUM of every binding constraint.
 * size = min(riskBudget/stop, liquiditySafe, exposureRoom, availableUSDT, hardCap)
 * Never negative. Risk-budget term guards against oversizing on tight stops.
 */
export function positionSizeUsdt(s: SizingInputs): number {
  const byRisk = s.stopDistanceFrac > 0 ? s.riskUsdt / s.stopDistanceFrac : Infinity;
  const size = Math.min(
    byRisk,
    Math.max(0, s.liquiditySafeUsdt),
    Math.max(0, s.exposureRoomUsdt),
    Math.max(0, s.availableUsdt),
    Math.max(0, s.hardMaxUsdt),
  );
  return Number.isFinite(size) && size > 0 ? size : 0;
}

export interface OpportunityScoreInputs {
  expectedMovePct: number;
  costs: CostInputs;
  /** Risk penalty in percent (toxicity, correlation, regime stress, etc.). */
  riskPenaltyPct?: number;
}

/**
 * Unified opportunity score (#46): net edge minus a risk penalty. Higher is
 * better; negative means "do not take". Use to rank Top-N across scanners.
 */
export function scoreOpportunity(o: OpportunityScoreInputs): number {
  return netEdgePct(o.expectedMovePct, o.costs) - Math.max(0, o.riskPenaltyPct ?? 0);
}

/** Opportunity expiry (#41): true once the signal is older than its TTL. */
export function opportunityExpired(createdAtMs: number, ttlMs: number, nowMs: number = Date.now()): boolean {
  return nowMs - createdAtMs > ttlMs;
}

/** Per-symbol cooldown (#54): true while still cooling down after the last exit. */
export function cooldownActive(lastExitMs: number | undefined, cooldownMs: number, nowMs: number = Date.now()): boolean {
  if (!lastExitMs) return false;
  return nowMs - lastExitMs < cooldownMs;
}
