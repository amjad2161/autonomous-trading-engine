// =============================================================================
// ENTRY GATE — the single, explicit "may we open a new position?" decision.
// =============================================================================
// Consolidates every entry pre-condition into one pure, testable function so the
// rule is in ONE place (not scattered across the engine). Exits are never gated
// here — only NEW entries. Any false condition blocks, with a named reason.
// =============================================================================

export interface EntryGateContext {
  /** Master autopilot switch. */
  autopilot: boolean;
  /** A formal invariant (INV-01..05) is breached. */
  invariantsBlocked: boolean;
  /** Real-time risk posture forbids new entries (FREEZE/HALT/RISK_OFF). */
  postureBlocks: boolean;
  /** USDT is below the fee buffer. */
  belowFeeBuffer: boolean;
  // ---- per-signal (optional; omit when not evaluated) ----
  /** Would breach a correlated-group exposure cap. */
  correlationOk?: boolean;
  /** Would breach the portfolio VaR cap. */
  varOk?: boolean;
  /** Spread/liquidity acceptable. */
  spreadOk?: boolean;
  /** Net edge clears the threshold after costs. */
  netEdgeOk?: boolean;
}

export interface EntryDecision {
  allowed: boolean;
  reasons: string[];
}

/**
 * Decide whether a new entry is allowed. Pure: returns the decision + the list
 * of blocking reasons (empty when allowed). Optional per-signal fields only
 * block when explicitly false (undefined = "not evaluated, don't block").
 */
export function evaluateEntryGate(ctx: EntryGateContext): EntryDecision {
  const reasons: string[] = [];
  if (!ctx.autopilot) reasons.push("autopilot-off");
  if (ctx.invariantsBlocked) reasons.push("invariant");
  if (ctx.postureBlocks) reasons.push("risk-posture");
  if (ctx.belowFeeBuffer) reasons.push("fee-buffer");
  if (ctx.correlationOk === false) reasons.push("correlation-cap");
  if (ctx.varOk === false) reasons.push("portfolio-var");
  if (ctx.spreadOk === false) reasons.push("spread/liquidity");
  if (ctx.netEdgeOk === false) reasons.push("net-edge");
  return { allowed: reasons.length === 0, reasons };
}
