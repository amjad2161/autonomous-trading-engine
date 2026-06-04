// Deno tests for funding-scanner, funding-backtest, market-making.
//   deno test supabase/functions/_shared/

import { assert, assertAlmostEquals, assertEquals } from "./_test_assert.ts";
import { scanFundingOpportunities, topN, type PerpFunding } from "./funding-scanner.ts";
import { backtestFunding } from "./funding-backtest.ts";
import { inventorySkew, mmViable, quotePrices, roundTripSpreadCaptureBps } from "./market-making.ts";

const perp = (symbol: string, fundingRate: number, quoteVolumeUsdt: number, perpMark = 100.1): PerpFunding => ({
  symbol, fundingRate, fundingIntervalHours: 8, spotPrice: 100, perpMark, spotFeeBps: 2, perpFeeBps: 2, quoteVolumeUsdt,
});

// ---------- funding scanner ----------

Deno.test("scanner: ranks OPEN perps by annualized carry, filters illiquid & non-OPEN", () => {
  const opps = scanFundingOpportunities([
    perp("AAA", 0.0003, 5_000_000),   // OPEN, ~32.8%/yr
    perp("BBB", 0.0001, 5_000_000),   // OPEN, ~10.9%/yr
    perp("CCC", 0.0003, 100_000),     // illiquid -> filtered
    perp("DDD", -0.0001, 5_000_000),  // funding negative -> CLOSE -> filtered
    perp("EEE", 0.0003, 5_000_000, 101), // basis 100bps > 50 -> SKIP -> filtered
  ]);
  assertEquals(opps.map((o) => o.symbol), ["AAA", "BBB"]);
  assert(opps[0].annualizedPct > opps[1].annualizedPct);
  assertEquals(topN(opps, 1).map((o) => o.symbol), ["AAA"]);
});

// ---------- funding backtest ----------

Deno.test("backtest: steady positive funding -> reliable net carry", () => {
  const r = backtestFunding(Array(20).fill(0.0001), 8); // 20 intervals @ 1bps, rt 8bps
  assertAlmostEquals(r.grossCarryPct, 0.2, 1e-9);  // 20 * 0.01%
  assertAlmostEquals(r.netCarryPct, 0.12, 1e-9);   // - 0.08%
  assertEquals(r.pctTimePositive, 100);
  assert(r.reliableCarry);
});

Deno.test("backtest: mostly-negative funding -> NOT reliable", () => {
  const r = backtestFunding([-0.0002, -0.0001, 0.00005, -0.0001, -0.0002], 8);
  assert(!r.reliableCarry);
  assert(r.netCarryPct < 0);
});

Deno.test("backtest: empty series -> no data", () => {
  assertEquals(backtestFunding([]).verdict, "no data");
});

// ---------- market making ----------

Deno.test("mm: quotes straddle mid; positive skew shifts both down (offload longs)", () => {
  const q = quotePrices(100, 10, 0);
  assertAlmostEquals(q.bid, 99.9, 1e-9);
  assertAlmostEquals(q.ask, 100.1, 1e-9);
  const skewed = quotePrices(100, 10, 1);
  assert(skewed.bid < q.bid && skewed.ask < q.ask);
  assert(skewed.ask > 100, "even at full skew the ask must keep edge over mid (never null a side)");
});

Deno.test("mm: viable only when spread beats round-trip maker fees", () => {
  assertEquals(roundTripSpreadCaptureBps(10, 2), 16); // 2*10 - 2*2
  assert(mmViable(10, 2));
  assert(!mmViable(1, 2));            // 2 - 4 < 0
  assertEquals(inventorySkew(5, 10), 0.5);
  assertEquals(inventorySkew(99, 10), 1); // clamped
});
