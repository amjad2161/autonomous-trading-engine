// =============================================================================
// EXECUTION DECISION CORES  (Master Spec §2.6; #56–#60, #65)
// =============================================================================
// Pure ordering/staging logic for the execution layer. The orchestrator runs
// the actual HTTP calls through the safety-gated executor; this module decides
// WHAT order to act in and HOW to stage exits. Exits ALWAYS outrank entries.
// =============================================================================

export type ActionKind = "PANIC" | "STOP_LOSS" | "TAKE_PROFIT" | "REPRICE" | "ENTRY";

export interface TradeAction {
  kind: ActionKind;
  symbol: string;
  /** Higher = more urgent within the same kind (e.g. larger adverse move). */
  urgency?: number;
}

// Lower number = executed first. Exits/protection before entries (#56).
const PRIORITY: Record<ActionKind, number> = {
  PANIC: 0,
  STOP_LOSS: 1,
  TAKE_PROFIT: 2,
  REPRICE: 3,
  ENTRY: 4,
};

/** Stable priority sort: protective actions first, entries last (#56). */
export function prioritize(actions: TradeAction[]): TradeAction[] {
  return [...actions]
    .map((a, i) => ({ a, i }))
    .sort((x, y) => {
      const p = PRIORITY[x.a.kind] - PRIORITY[y.a.kind];
      if (p !== 0) return p;
      const u = (y.a.urgency ?? 0) - (x.a.urgency ?? 0);
      if (u !== 0) return u;
      return x.i - y.i; // stable
    })
    .map((z) => z.a);
}

export type ExitStep =
  | { type: "LIMIT_IOC"; aggressivenessBps: number }
  | { type: "MARKET" };

/**
 * Staged exit plan (#59, #60): try aggressive IOC limit steps first, fall back
 * to market ONLY at the end (or immediately when urgency is panic-level).
 * Returns the ordered steps to attempt.
 */
export function stagedExitPlan(urgency: "normal" | "elevated" | "panic"): ExitStep[] {
  if (urgency === "panic") return [{ type: "MARKET" }];
  if (urgency === "elevated") {
    return [{ type: "LIMIT_IOC", aggressivenessBps: 15 }, { type: "MARKET" }];
  }
  return [
    { type: "LIMIT_IOC", aggressivenessBps: 5 },
    { type: "LIMIT_IOC", aggressivenessBps: 15 },
    { type: "MARKET" },
  ];
}

export type RepriceDecision = "REPRICE" | "CANCEL" | "HOLD";

/**
 * Smart reprice (#58): reprice up to a cap, then cancel — never "chase" forever.
 * Cancels early if price has drifted beyond tolerance since the signal.
 */
export function repriceDecision(attempts: number, maxAttempts: number, driftBps: number, maxDriftBps: number): RepriceDecision {
  if (driftBps > maxDriftBps) return "CANCEL";
  if (attempts >= maxAttempts) return "CANCEL";
  return "REPRICE";
}

/**
 * Market-fallback trigger (#60): switch a stuck exit to market only when the
 * situation is deteriorating (slippage rising AND/OR depth vanishing), not
 * merely because a limit didn't fill instantly.
 */
export function shouldMarketFallback(input: { slippageRising: boolean; depthVanishing: boolean; secondsStuck: number; maxSecondsStuck: number }): boolean {
  if (input.secondsStuck >= input.maxSecondsStuck) return true;
  return input.slippageRising && input.depthVanishing;
}

/** Adaptive timeout (#65): widen REST/IOC timeouts under load. */
export function adaptiveTimeoutMs(baseMs: number, loadFactor: number): number {
  const f = Math.min(4, Math.max(1, loadFactor));
  return Math.round(baseMs * f);
}
