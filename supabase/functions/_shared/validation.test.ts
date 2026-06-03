// Deno tests for the edge detector + dataset builder (pure parts).
//   deno test supabase/functions/_shared/

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { brierScore, calibration, edgeVerdict, logLoss, sharpe, skillScore } from "./validation.ts";
import { buildUpDownDataset, candlesToReturns, type Candle } from "./dataset.ts";

Deno.test("brier: perfect predictions = 0, coinflip on certain outcome = 0.25", () => {
  assertEquals(brierScore([1, 0], [1, 0]), 0);
  assertAlmostEquals(brierScore([0.5, 0.5], [1, 0]), 0.25, 1e-9);
});

Deno.test("logLoss is finite and penalizes confident wrong calls", () => {
  const good = logLoss([0.9, 0.1], [1, 0]);
  const bad = logLoss([0.1, 0.9], [1, 0]);
  assert(bad > good);
});

Deno.test("skillScore: better-than-ref > 0, equal = 0", () => {
  assert(skillScore(0.1, 0.25) > 0);
  assertEquals(skillScore(0.25, 0.25), 0);
});

Deno.test("edgeVerdict: detects edge when model beats market, none when equal", () => {
  const outcomes = [1, 1, 0, 0];
  const market = [0.5, 0.5, 0.5, 0.5];
  const sharp = [0.9, 0.9, 0.1, 0.1];
  assert(edgeVerdict(sharp, market, outcomes).hasEdge);
  assert(!edgeVerdict(market, market, outcomes).hasEdge); // identical -> skill 0
});

Deno.test("calibration returns the requested number of bins", () => {
  const c = calibration([0.05, 0.15, 0.95], [0, 0, 1], 10);
  assertEquals(c.length, 10);
});

Deno.test("sharpe is 0 for <2 points, positive for steady gains", () => {
  assertEquals(sharpe([0.01]), 0);
  assert(sharpe([0.01, 0.012, 0.009, 0.011]) > 0);
});

Deno.test("dataset: returns + up/down labels from candles (pure)", () => {
  const candles: Candle[] = [
    { t: 1, o: 10, h: 10, l: 10, c: 10, v: 1 },
    { t: 2, o: 10, h: 11, l: 10, c: 11, v: 1 },
    { t: 3, o: 11, h: 12, l: 11, c: 12, v: 1 },
    { t: 4, o: 12, h: 12, l: 11, c: 11, v: 1 },
  ];
  assertEquals(candlesToReturns(candles).length, 3);
  const ds = buildUpDownDataset(candles);
  // i runs 1..len-2 -> 2 labels: next>cur? (11->12 up=1), (12->11 down=0)
  assertEquals(ds.outcomes, [1, 0]);
  assertEquals(ds.marketPreds.length, 2);
});
