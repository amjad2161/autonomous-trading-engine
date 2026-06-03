// Deno tests for correlation-aware exposure. deno test supabase/functions/_shared/

import { assert, assertAlmostEquals, assertEquals } from "./_test_assert.ts";
import { assetGroup, correlationGate, groupExposureUsdt, pearson } from "./correlation.ts";

Deno.test("assetGroup: known assets group, unknown -> own group", () => {
  assertEquals(assetGroup("BTC_USDT"), "majors");
  assertEquals(assetGroup("ETH_USDT"), "majors");
  assertEquals(assetGroup("DOGE_USDT"), "meme");
  assertEquals(assetGroup("XYZ_USDT"), "xyz");
});

Deno.test("groupExposure: sums only the same correlation group", () => {
  const items = [
    { symbol: "BTC_USDT", notionalUsdt: 50 },
    { symbol: "ETH_USDT", notionalUsdt: 30 }, // also majors
    { symbol: "DOGE_USDT", notionalUsdt: 20 }, // meme
  ];
  assertEquals(groupExposureUsdt(items, "BTC_USDT"), 80); // majors = 50 + 30
  assertEquals(groupExposureUsdt(items, "DOGE_USDT"), 20);
});

Deno.test("correlationGate: blocks adding beyond the group cap", () => {
  const items = [{ symbol: "BTC_USDT", notionalUsdt: 80 }];
  // majors already 80; cap 100 -> adding 30 (ETH) breaches
  assert(!correlationGate(items, "ETH_USDT", 30, 100).ok);
  // adding 15 is fine
  assert(correlationGate(items, "ETH_USDT", 15, 100).ok);
  // a different group is unaffected
  assert(correlationGate(items, "DOGE_USDT", 50, 100).ok);
});

Deno.test("pearson: +1 for identical, ~-1 for opposite, 0 for <2 pts", () => {
  assertAlmostEquals(pearson([1, 2, 3, 4], [1, 2, 3, 4]), 1, 1e-9);
  assertAlmostEquals(pearson([1, 2, 3, 4], [4, 3, 2, 1]), -1, 1e-9);
  assertEquals(pearson([1], [1]), 0);
});
