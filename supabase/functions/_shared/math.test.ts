// Deno tests for shared indicator math. deno test supabase/functions/_shared/

import { assert, assertEquals } from "./_test_assert.ts";
import { sma, stdDev } from "./math.ts";

Deno.test("sma: warm-up is NaN, then trailing mean", () => {
  const r = sma([2, 4, 6, 8], 2);
  assert(Number.isNaN(r[0]));
  assertEquals(r.slice(1), [3, 5, 7]);
});

Deno.test("sma period 3", () => {
  const r = sma([1, 2, 3, 4, 5], 3);
  assert(Number.isNaN(r[0]) && Number.isNaN(r[1]));
  assertEquals(r.slice(2), [2, 3, 4]);
});

Deno.test("stdDev: warm-up NaN, then rolling population stddev", () => {
  // [2,4]: mean 3, var ((1)+(1))/2 = 1, std 1
  const r = stdDev([2, 4, 6, 8], 2);
  assert(Number.isNaN(r[0]));
  assertEquals(r.slice(1), [1, 1, 1]);
});

Deno.test("stdDev: zero variance on a flat series", () => {
  const r = stdDev([5, 5, 5, 5], 2);
  assertEquals(r.slice(1), [0, 0, 0]);
});
