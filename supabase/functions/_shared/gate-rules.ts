// =============================================================================
// GATE.IO MECHANICS — public, documented rules encoded for precise interaction
// =============================================================================
// There is no secret algorithm to "crack": Gate.io's spot mechanics are public.
// The real win is modelling them ACCURATELY — fees, order types, matching
// (price-time priority), precision/minimums, and rate limits — so the system
// trades efficiently and never loses on avoidable cost/precision mistakes.
//
// All numbers here are PUBLIC and APPROXIMATE (they change and depend on your
// VIP tier / GT holdings). Treat them as configurable defaults and update them
// from your live account. This module gives the engine an exchange-accurate
// cost/precision view; it does NOT manufacture an edge.
// =============================================================================

// ---------- Fees -------------------------------------------------------------
// Standard Gate.io spot ≈ 0.20% maker/taker. VIP tiers (30d volume / GT) lower
// both; paying fees in GT applies a further discount. Ladders are short and
// approximate — index = VIP level (0 = standard).

export const SPOT_TAKER_BPS_BY_VIP = [20, 18.5, 16.5, 14, 12, 10, 8.5, 7, 6, 5.5] as const;
export const SPOT_MAKER_BPS_BY_VIP = [20, 16, 14, 12, 9, 6.5, 5, 4, 2.5, 2] as const;
export const GT_FEE_DISCOUNT = 0.25; // ~25% off when deducting fees in GT

function ladderAt(ladder: readonly number[], vip: number): number {
  const i = Math.max(0, Math.min(ladder.length - 1, Math.floor(vip)));
  return ladder[i];
}

export interface FeeContext {
  isMaker: boolean;
  vipLevel?: number;     // 0 = standard
  payWithGt?: boolean;
}

/** Effective per-side fee in basis points for the given context. */
export function effectiveFeeBps(ctx: FeeContext): number {
  const base = ctx.isMaker
    ? ladderAt(SPOT_MAKER_BPS_BY_VIP, ctx.vipLevel ?? 0)
    : ladderAt(SPOT_TAKER_BPS_BY_VIP, ctx.vipLevel ?? 0);
  return ctx.payWithGt ? base * (1 - GT_FEE_DISCOUNT) : base;
}

/** Round-trip fee (entry + exit) in basis points — feed this into net-edge. */
export function roundTripFeeBps(entry: FeeContext, exit: FeeContext): number {
  return effectiveFeeBps(entry) + effectiveFeeBps(exit);
}

// ---------- Order types & time-in-force --------------------------------------

export const ORDER_TYPES = ["limit", "market"] as const;

/** time_in_force semantics (Gate.io v4 spot). */
export const TIME_IN_FORCE = {
  gtc: "Good-Til-Cancelled — rests on the book (maker if it doesn't cross).",
  ioc: "Immediate-Or-Cancel — fills what it can now, cancels the rest (taker).",
  poc: "Pending-Or-Cancelled — POST-ONLY: only ever maker, else cancelled.",
  fok: "Fill-Or-Kill — fill entirely immediately or cancel.",
} as const;
export type TimeInForce = keyof typeof TIME_IN_FORCE;

/** Recommended TIF per strategy intent (maker-first where possible to cut fees). */
export function recommendedTif(intent: "maker_harvest" | "scalp_taker" | "exit_urgent" | "exit_passive"): TimeInForce {
  switch (intent) {
    case "maker_harvest": return "poc";   // guarantee maker or skip
    case "scalp_taker": return "ioc";
    case "exit_urgent": return "ioc";      // then market fallback in execution.ts
    case "exit_passive": return "gtc";
  }
}

// ---------- Matching engine --------------------------------------------------
// Gate.io matches with PRICE-TIME PRIORITY (FIFO at a price level): better price
// first, then earlier order. Implications the engine uses:
//  - a maker order improves fill odds by being early in the queue at its price;
//  - cancel/replace ("repricing") sends you to the BACK of the new queue — so
//    reprice sparingly (see execution.repriceDecision).

export const MATCHING = "price-time-priority (FIFO per price level)";

/** Rough queue-ahead estimate: notional resting at your price before you join. */
export function queueAheadUsdt(levelNotionalUsdt: number): number {
  return Math.max(0, levelNotionalUsdt);
}

// ---------- Precision & minimums ---------------------------------------------

export interface SymbolRules {
  pricePrecision: number;   // decimals for price
  amountPrecision: number;  // decimals for base amount
  minBaseAmount: number;    // minimum base qty
  minQuoteAmount: number;   // minimum quote (USDT) notional
}

/** Does an order meet the pair's minimum notional + base amount? */
export function meetsMinimums(notionalUsdt: number, baseAmount: number, rules: SymbolRules): boolean {
  return notionalUsdt >= rules.minQuoteAmount && baseAmount >= rules.minBaseAmount;
}

export interface SpotPair extends SymbolRules {
  symbol: string;
  tradable: boolean;
}

/**
 * Parse Gate.io's public /spot/currency_pairs response into per-symbol rules.
 * Pure — fed by fetchSpotPairRules() or any cached payload. Models real
 * precision/minimums per symbol so orders are never rejected on format.
 */
export function parseSpotPairRules(raw: Array<Record<string, unknown>>): Record<string, SpotPair> {
  const out: Record<string, SpotPair> = {};
  for (const p of raw ?? []) {
    const symbol = String(p.id ?? `${p.base}_${p.quote}`);
    out[symbol] = {
      symbol,
      pricePrecision: Number(p.precision ?? 0),
      amountPrecision: Number(p.amount_precision ?? 0),
      minBaseAmount: Number(p.min_base_amount ?? 0),
      minQuoteAmount: Number(p.min_quote_amount ?? 0),
      tradable: (p.trade_status ?? "tradable") === "tradable",
    };
  }
  return out;
}

/** Fetch live per-symbol trading rules (public, no key). */
export async function fetchSpotPairRules(): Promise<Record<string, SpotPair>> {
  const res = await fetch("https://api.gateio.ws/api/v4/spot/currency_pairs", { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`currency_pairs ${res.status}`);
  return parseSpotPairRules((await res.json()) as Array<Record<string, unknown>>);
}

// ---------- Rate limits (public, approximate) --------------------------------
// Respect per-endpoint limits; use a central throttler + backoff and avoid
// cancel storms. Numbers are approximate and per-key — verify in the docs.

export const RATE_LIMITS = {
  spotOrderPlacePerSec: 10,
  spotOrderCancelPerSec: 10,
  publicMarketDataPerSec: 100,
} as const;

// ---------- WebSocket channels (public) --------------------------------------

export const WS_CHANNELS = {
  tickers: "spot.tickers",
  bookTicker: "spot.book_ticker",      // best bid/ask stream (low latency)
  orderBook: "spot.order_book",
  trades: "spot.trades",
  candles: "spot.candlesticks",
  userOrders: "spot.orders",           // private: your order updates
  userBalance: "spot.balances",        // private: your balances
} as const;
