// Deno tests for microstructure features. deno test supabase/functions/_shared/

import { assert, assertAlmostEquals, assertEquals } from "./_test_assert.ts";
import { imbalanceStability, isJumpy, jumpRate, orderBookImbalance } from "./microstructure.ts";

Deno.test("imbalance: +1 all bids, -1 all asks, 0 balanced", () => {
  assertEquals(orderBookImbalance([[100, 10]], [[101, 0]]), 1);
  assertEquals(orderBookImbalance([[100, 0]], [[101, 10]]), -1);
  assertEquals(orderBookImbalance([[100, 5]], [[101, 5]]), 0);
});

Deno.test("imbalance stability: steady ~1, flickering ~ low", () => {
  assert(imbalanceStability([0.5, 0.5, 0.5, 0.5]) > 0.99);
  assert(imbalanceStability([0.9, -0.9, 0.9, -0.9]) < 0.2);
});

Deno.test("jump rate + isJumpy", () => {
  // 1 of 5 returns >= 1% -> 0.2
  assertAlmostEquals(jumpRate([0.1, 0.2, 1.5, 0.3, 0.1], 1), 0.2, 1e-9);
  assert(!isJumpy(0.2, 0.2));   // not strictly greater
  assert(isJumpy(0.5, 0.2));
});
