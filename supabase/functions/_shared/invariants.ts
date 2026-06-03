// =============================================================================
// FORMAL RISK INVARIANTS (Spec v1.1 — A2.1)
// =============================================================================
// Hard rules the system must never violate, even with a bug elsewhere. These
// are pure, side-effect-free checks. Every entry path runs evaluateInvariants()
// and refuses to open new positions if ANY invariant is breached.
//
// Design rule: a missing input means "not monitored yet" — that invariant is
// simply skipped (it cannot fire). The invariants we CAN compute from real
// state (daily loss, open positions, exposure) fire fail-closed. Telemetry-only
// invariants (WS staleness, cancel-rate) activate once that telemetry exists.
//
// This complements safety.ts: safety.ts caps a SINGLE order; invariants govern
// the SYSTEM STATE (should we be opening anything at all right now?).
// =============================================================================

export interface InvariantContext {
  /** Market-data websocket considered stale (no fresh ticks within budget). */
  wsStale?: boolean;
  /** Realised P&L today in USDT (negative = loss). */
  dailyPnlUsdt?: number;
  /** Daily loss cap in USDT (positive number; breach when dailyPnl <= -cap). */
  dailyLossCapUsdt?: number;
  /** Current number of open positions. */
  openPositions?: number;
  /** Max allowed open positions. */
  maxOpenPositions?: number;
  /** Exposure to the symbol about to be traded, in USDT. */
  symbolExposureUsdt?: number;
  /** Max allowed per-symbol exposure, in USDT. */
  maxSymbolExposureUsdt?: number;
  /** Order cancellations per minute (cancel-storm guard). */
  cancelRatePerMin?: number;
  /** Max allowed cancellations per minute. */
  maxCancelRatePerMin?: number;
}

export interface InvariantViolation {
  id: string;
  message: string;
}

export interface InvariantResult {
  ok: boolean;
  violations: InvariantViolation[];
  /** True when no NEW entries may be opened (exits are always allowed). */
  blockEntries: boolean;
}

/**
 * Evaluate all formal invariants against the current context.
 * Pure: returns violations; never throws, never mutates.
 */
export function evaluateInvariants(ctx: InvariantContext): InvariantResult {
  const v: InvariantViolation[] = [];

  // INV-01: WS stale -> no new entries.
  if (ctx.wsStale === true) {
    v.push({ id: "INV-01", message: "Market data stale — new entries blocked" });
  }

  // INV-02: daily loss cap -> no new entries (exits only).
  if (
    ctx.dailyPnlUsdt !== undefined &&
    ctx.dailyLossCapUsdt !== undefined &&
    ctx.dailyPnlUsdt <= -Math.abs(ctx.dailyLossCapUsdt)
  ) {
    v.push({
      id: "INV-02",
      message: `Daily loss ${ctx.dailyPnlUsdt.toFixed(2)} <= -${Math.abs(ctx.dailyLossCapUsdt)} cap — entries blocked`,
    });
  }

  // INV-03: per-symbol exposure must never exceed its cap.
  if (
    ctx.symbolExposureUsdt !== undefined &&
    ctx.maxSymbolExposureUsdt !== undefined &&
    ctx.symbolExposureUsdt > ctx.maxSymbolExposureUsdt
  ) {
    v.push({
      id: "INV-03",
      message: `Symbol exposure ${ctx.symbolExposureUsdt.toFixed(2)} > ${ctx.maxSymbolExposureUsdt} cap`,
    });
  }

  // INV-04: open positions must never exceed the cap.
  if (
    ctx.openPositions !== undefined &&
    ctx.maxOpenPositions !== undefined &&
    ctx.openPositions >= ctx.maxOpenPositions
  ) {
    v.push({
      id: "INV-04",
      message: `Open positions ${ctx.openPositions} >= ${ctx.maxOpenPositions} cap`,
    });
  }

  // INV-05: cancel-rate ceiling (cancel-storm guard) -> throttle + freeze entries.
  if (
    ctx.cancelRatePerMin !== undefined &&
    ctx.maxCancelRatePerMin !== undefined &&
    ctx.cancelRatePerMin > ctx.maxCancelRatePerMin
  ) {
    v.push({
      id: "INV-05",
      message: `Cancel rate ${ctx.cancelRatePerMin}/min > ${ctx.maxCancelRatePerMin}/min — freeze`,
    });
  }

  return { ok: v.length === 0, violations: v, blockEntries: v.length > 0 };
}

/** Convenience: a single human-readable reason string (or empty). */
export function invariantReason(result: InvariantResult): string {
  return result.violations.map((x) => `${x.id}:${x.message}`).join(" | ");
}
