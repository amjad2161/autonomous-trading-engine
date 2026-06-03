// =============================================================================
// REAL-DATA LOADER  (Master Spec: replace synthetic backtests with real history)
// =============================================================================
// Pulls REAL public candlesticks from Gate.io (no API key needed) so the
// backtest + edge detector run on actual market history. This is the bridge
// from "looks like it works" to "we know if it works".
//
// (Network is required to run this — it is the real loader, not a mock.)
// =============================================================================

export interface Candle {
  t: number; // unix seconds
  o: number;
  h: number;
  l: number;
  c: number;
  v: number; // quote volume
}

/**
 * Fetch spot candlesticks. Gate.io v4 returns rows of:
 * [timestamp, quoteVolume, close, high, low, open, baseAmount, windowClosed].
 */
export async function fetchGateCandles(pair: string, interval = "1m", limit = 1000): Promise<Candle[]> {
  const url = `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${encodeURIComponent(pair)}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Gate candles ${pair} ${res.status}`);
  const rows = (await res.json()) as string[][];
  return rows.map((r) => ({
    t: Number(r[0]),
    v: Number(r[1]),
    c: Number(r[2]),
    h: Number(r[3]),
    l: Number(r[4]),
    o: Number(r[5]),
  })).filter((c) => Number.isFinite(c.c) && Number.isFinite(c.o));
}

/** Per-candle returns (close-to-close), as fractions. */
export function candlesToReturns(candles: Candle[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].c;
    if (prev > 0) out.push((candles[i].c - prev) / prev);
  }
  return out;
}

export interface UpDownDataset {
  /** outcome_i = 1 if the next candle closed up, else 0. */
  outcomes: number[];
  /** A naive market reference probability (base rate of "up"). */
  marketPreds: number[];
  /** A simple momentum model prediction, for comparison (not advice). */
  momentumPreds: number[];
}

/**
 * Build a binary "will the next candle close up?" dataset from real candles.
 * Provides a market base-rate reference and a trivial momentum model so the
 * edge detector (validation.ts) can be exercised on real data. The momentum
 * model is intentionally naive — usually it will show ~zero skill, which is the
 * honest, expected result.
 */
export function buildUpDownDataset(candles: Candle[]): UpDownDataset {
  const outcomes: number[] = [];
  const momentum: number[] = [];
  for (let i = 1; i < candles.length - 1; i++) {
    const up = candles[i + 1].c > candles[i].c ? 1 : 0;
    outcomes.push(up);
    // naive momentum: predict "up" prob from the last return, squashed to (0,1)
    const lastRet = (candles[i].c - candles[i - 1].c) / (candles[i - 1].c || 1);
    momentum.push(1 / (1 + Math.exp(-50 * lastRet)));
  }
  const baseRate = outcomes.length ? outcomes.reduce((a, b) => a + b, 0) / outcomes.length : 0.5;
  const marketPreds = outcomes.map(() => baseRate);
  return { outcomes, marketPreds, momentumPreds: momentum };
}
