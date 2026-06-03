// =============================================================================
// ORDER STATE MACHINE  (Master Spec #62, #61, #63)
// =============================================================================
// A pure, total state machine for an order's lifecycle. "No lost orders":
// every event maps to a defined transition or is rejected as invalid (no-op),
// and partial fills are tracked precisely. Idempotent: replaying an event on a
// terminal order does nothing.
// =============================================================================

export type OrderState = "NEW" | "ACK" | "PARTIAL" | "FILLED" | "CANCELLED" | "REJECTED" | "EXPIRED";
export type OrderEvent = "ack" | "partial_fill" | "fill" | "cancel" | "reject" | "expire";

const TRANSITIONS: Record<OrderState, Partial<Record<OrderEvent, OrderState>>> = {
  NEW: { ack: "ACK", reject: "REJECTED", cancel: "CANCELLED", expire: "EXPIRED" },
  ACK: { partial_fill: "PARTIAL", fill: "FILLED", cancel: "CANCELLED", expire: "EXPIRED", reject: "REJECTED" },
  PARTIAL: { partial_fill: "PARTIAL", fill: "FILLED", cancel: "CANCELLED", expire: "EXPIRED" },
  FILLED: {},
  CANCELLED: {},
  REJECTED: {},
  EXPIRED: {},
};

const TERMINAL: ReadonlySet<OrderState> = new Set(["FILLED", "CANCELLED", "REJECTED", "EXPIRED"]);

export function isTerminal(state: OrderState): boolean {
  return TERMINAL.has(state);
}

/** Next state for an event, or null if the transition is invalid. */
export function nextOrderState(state: OrderState, event: OrderEvent): OrderState | null {
  return TRANSITIONS[state][event] ?? null;
}

export interface OrderRecord {
  id: string;
  state: OrderState;
  totalQty: number;
  filledQty: number;
}

/**
 * Apply an event to an order record. Pure: returns a NEW record.
 * - Invalid transition (incl. events on terminal orders) -> unchanged (no-op).
 * - partial_fill adds qty (clamped to totalQty); fill marks fully filled.
 */
export function applyOrderEvent(rec: OrderRecord, event: OrderEvent, qty = 0): OrderRecord {
  const ns = nextOrderState(rec.state, event);
  if (ns === null) return rec; // idempotent / safe no-op

  let filled = rec.filledQty;
  if (event === "partial_fill") filled = Math.min(rec.totalQty, rec.filledQty + Math.max(0, qty));
  if (event === "fill") filled = rec.totalQty;

  return { ...rec, state: ns, filledQty: filled };
}

/** Remaining unfilled quantity — the amount any exit logic must act on (#61). */
export function remainingQty(rec: OrderRecord): number {
  return Math.max(0, rec.totalQty - rec.filledQty);
}
