// =============================================================================
// MARKET DATA HYGIENE & MICROSTRUCTURE  (Master Spec §2.2/§2.3; #16–#35)
// =============================================================================
// Pure helpers that turn raw book/ticker data into clean, decision-ready
// numbers: freshness, spread, depth-at-X%, slippage estimate from the book,
// a data-quality score, and tick/lot normalization. No I/O.
// =============================================================================

export type Level = [number, number]; // [price, amount]

export function dataAgeMs(lastUpdateMs: number, nowMs: number = Date.now()): number {
  return Math.max(0, nowMs - lastUpdateMs);
}

export function isStale(ageMs: number, thresholdMs: number): boolean {
  return ageMs > thresholdMs;
}

export function midPrice(bid: number, ask: number): number {
  return (bid + ask) / 2;
}

/** Spread in basis points. Returns Infinity if inputs are invalid/crossed. */
export function spreadBps(bid: number, ask: number): number {
  if (!(bid > 0) || !(ask > 0) || ask <= bid) return Infinity; // <= : a locked book (bid==ask) is not "zero spread", it's untradeable
  return ((ask - bid) / midPrice(bid, ask)) * 10000;
}

/** A book is "crossed" (bad data) when best bid >= best ask. */
export function isCrossed(bid: number, ask: number): boolean {
  return bid > 0 && ask > 0 && bid >= ask;
}

/** Cumulative notional (USDT) available within `pct`% of the reference price. */
export function depthWithinPct(levels: Level[], refPrice: number, pct: number, side: "buy" | "sell"): number {
  if (!(refPrice > 0)) return 0;
  const limit = side === "buy" ? refPrice * (1 + pct / 100) : refPrice * (1 - pct / 100);
  let notional = 0;
  for (const [price, amount] of levels) {
    if (side === "buy" && price <= limit) notional += price * amount;
    else if (side === "sell" && price >= limit) notional += price * amount;
  }
  return notional;
}

/**
 * Estimate slippage (%) for a market order of `sizeUsdt`, by walking the book.
 * buy walks asks (ascending), sell walks bids (descending). Returns the
 * volume-weighted average fill price's deviation from the best price. If the
 * book can't fill the size, returns Infinity (insufficient liquidity).
 */
export function estimateSlippagePct(levels: Level[], side: "buy" | "sell", sizeUsdt: number): number {
  if (levels.length === 0 || !(sizeUsdt > 0)) return Infinity;
  const sorted = [...levels].sort((a, b) => (side === "buy" ? a[0] - b[0] : b[0] - a[0]));
  const best = sorted[0][0];
  let remaining = sizeUsdt;
  let cost = 0; // USDT spent
  let qty = 0;  // base filled
  for (const [price, amount] of sorted) {
    const levelNotional = price * amount;
    const take = Math.min(levelNotional, remaining);
    cost += take;
    qty += take / price;
    remaining -= take;
    if (remaining <= 0) break;
  }
  if (remaining > 0 || qty <= 0) return Infinity;
  const avgPrice = cost / qty;
  return side === "buy" ? ((avgPrice - best) / best) * 100 : ((best - avgPrice) / best) * 100;
}

/**
 * Data quality score 0..1 (#24). Penalizes staleness, wide spread, crossed book.
 * Below ~0.5 a symbol should not be traded (or maker-only).
 */
export function dataQualityScore(input: { ageMs: number; staleMs: number; spreadBps: number; maxSpreadBps: number; crossed: boolean }): number {
  if (input.crossed) return 0;
  const freshness = clamp01(1 - input.ageMs / (input.staleMs * 2));
  const spreadQ = clamp01(1 - input.spreadBps / (input.maxSpreadBps * 2));
  return clamp01(0.5 * freshness + 0.5 * spreadQ);
}

/**
 * Liquidation value (#2): the USDT you'd ACTUALLY get selling `baseAmount` into
 * the bid book — walk the bids, not the last price. Conservative: if the book
 * can't absorb it all, returns only the realizable proceeds.
 */
export function liquidationValueUsdt(baseAmount: number, bids: Level[]): number {
  if (!(baseAmount > 0)) return 0;
  let remaining = baseAmount;
  let proceeds = 0;
  for (const [price, amt] of [...bids].sort((a, b) => b[0] - a[0])) {
    const take = Math.min(Math.max(0, amt), remaining);
    proceeds += take * price;
    remaining -= take;
    if (remaining <= 0) break;
  }
  return proceeds;
}

/** Round a quantity DOWN to the symbol's amount precision (#21). */
export function normalizeAmount(amount: number, precision: number): number {
  if (precision < 0) return amount;
  const f = Math.pow(10, precision);
  return Math.floor(amount * f) / f;
}

/** Round a price to the symbol's price precision (#21). */
export function normalizePrice(price: number, precision: number): number {
  if (precision < 0) return price;
  const f = Math.pow(10, precision);
  return Math.round(price * f) / f;
}

/** Leveraged tokens (3L/5L/UP/DOWN) — filtered out; spot/no-leverage only. */
export function isLeveragedToken(symbol: string): boolean {
  const base = symbol.split("_")[0];
  // Gate leveraged ETFs: <COIN>3L/3S/5L/5S ; UP/DOWN tokens: <COIN>UP/DOWN.
  // Require a real coin prefix so legit names ENDING in UP (e.g. JUP) or DOWN
  // are not misclassified. JUP -> not leveraged; BTCUP -> leveraged.
  return /[A-Z0-9]{2,}[35][LS]$/.test(base) || /[A-Z0-9]{3,}(?:UP|DOWN)$/.test(base);
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}
