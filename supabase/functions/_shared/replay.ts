// =============================================================================
// DETERMINISTIC REPLAY / EVENT SOURCING  (Master Spec A2.2; #25)
// =============================================================================
// A pure, deterministic ledger reducer. Persist an ordered event log (see the
// `event_log` table) and replay it to reconstruct exact state — for debugging,
// "what should have happened vs what did", and reproducible analysis.
// =============================================================================

export type ReplayEvent =
  | { ts: number; type: "fill"; symbol: string; side: "buy" | "sell"; qty: number; price: number; feeUsdt?: number }
  | { ts: number; type: "deposit"; usdt: number }
  | { ts: number; type: "note"; tag: string };

export interface Position {
  qty: number;
  avgPrice: number;
}

export interface ReplayState {
  cashUsdt: number;
  positions: Record<string, Position>;
  realizedPnlUsdt: number;
  fills: number;
}

export function initialState(cashUsdt = 0): ReplayState {
  return { cashUsdt, positions: {}, realizedPnlUsdt: 0, fills: 0 };
}

/** Pure reducer: apply one event, returning a NEW state. Deterministic. */
export function reduceEvent(state: ReplayState, e: ReplayEvent): ReplayState {
  if (e.type === "deposit") {
    return { ...state, cashUsdt: round8(state.cashUsdt + e.usdt) };
  }
  if (e.type === "note") return state;

  // fill
  const fee = Math.max(0, e.feeUsdt ?? 0);
  const positions = { ...state.positions };
  const pos = positions[e.symbol] ?? { qty: 0, avgPrice: 0 };
  let cash = state.cashUsdt;
  let realized = state.realizedPnlUsdt;

  if (e.side === "buy") {
    cash -= e.qty * e.price + fee;
    const newQty = pos.qty + e.qty;
    const newAvg = newQty > 0 ? (pos.qty * pos.avgPrice + e.qty * e.price) / newQty : 0;
    positions[e.symbol] = { qty: round8(newQty), avgPrice: round8(newAvg) };
  } else {
    const qtySold = Math.min(e.qty, pos.qty);
    cash += e.qty * e.price - fee;
    realized += (e.price - pos.avgPrice) * qtySold - fee;
    const newQty = pos.qty - e.qty;
    positions[e.symbol] = { qty: round8(newQty), avgPrice: newQty <= 0 ? 0 : pos.avgPrice };
  }

  return {
    cashUsdt: round8(cash),
    positions,
    realizedPnlUsdt: round8(realized),
    fills: state.fills + 1,
  };
}

/** Fold the reducer over a (sorted-by-ts) event log to reconstruct state. */
export function replay(events: ReplayEvent[], startCashUsdt = 0): ReplayState {
  const ordered = [...events].sort((a, b) => a.ts - b.ts);
  return ordered.reduce(reduceEvent, initialState(startCashUsdt));
}

function round8(x: number): number {
  return Math.round(x * 1e8) / 1e8;
}
