// Deno tests for the delta-neutral funding-carry strategy. deno test supabase/functions/_shared/

import { assert, assertAlmostEquals, assertEquals } from "./_test_assert.ts";
import {
  annualizedCarryPct, basisBps, breakevenIntervals, deltaNeutralLegs,
  fundingArbSignal, fundingBpsPerInterval, roundTripCostBps, type FundingInputs,
} from "./funding-arb.ts";

Deno.test("basis + round-trip cost + per-interval funding math", () => {
  assertAlmostEquals(basisBps(100, 100.5), 50, 1e-9);
  assertEquals(roundTripCostBps(10, 5), 30); // 2*10 + 2*5
  assertAlmostEquals(fundingBpsPerInterval(0.0001), 1, 1e-9);
});

Deno.test("annualized carry: 0.01%/8h ≈ 10.95%/yr", () => {
  assertAlmostEquals(annualizedCarryPct(0.0001, 8), 10.95, 0.05);
});

Deno.test("breakeven: cost/carry intervals; Infinity when carry <= 0", () => {
  assertEquals(breakevenIntervals(30, 1), 30);
  assertEquals(breakevenIntervals(30, 0), Infinity);
});

const base: FundingInputs = {
  fundingRate: 0.0003, // 3 bps / interval
  fundingIntervalHours: 8,
  spotPrice: 100,
  perpMark: 100.1, // 10 bps basis
  spotFeeBps: 2,
  perpFeeBps: 2,
};

Deno.test("signal OPENs on healthy positive funding + tight basis", () => {
  const s = fundingArbSignal(base);
  assertEquals(s.action, "OPEN");
  assert(s.annualizedPct > 0);
});

Deno.test("signal CLOSEs when funding flips non-positive", () => {
  assertEquals(fundingArbSignal({ ...base, fundingRate: -0.0001 }).action, "CLOSE");
});

Deno.test("signal SKIPs tiny funding and wide basis", () => {
  assertEquals(fundingArbSignal({ ...base, fundingRate: 0.000005 }).action, "SKIP"); // 0.05 bps < 1
  assertEquals(fundingArbSignal({ ...base, perpMark: 101 }).action, "SKIP"); // 100 bps basis > 50
});

Deno.test("delta-neutral legs scale with equity (capital-agnostic)", () => {
  const small = deltaNeutralLegs(1000, 0.5, 50000);
  const big = deltaNeutralLegs(1_000_000, 0.5, 50000);
  assertEquals(small.notionalUsdt, 500);
  assertEquals(small.spotQty, 0.01);
  assertEquals(small.spotQty, small.perpQty); // delta-neutral
  assertEquals(big.notionalUsdt, 500000);     // same logic, scaled
});
