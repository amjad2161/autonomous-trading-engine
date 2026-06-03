// Deno tests for the quant sizing primitives. deno test supabase/functions/_shared/

import { assert, assertAlmostEquals, assertEquals } from "./_test_assert.ts";
import { expectancy, fractionalKelly, kellyFraction, kellyRiskUsdt, riskOfRuin, sortino } from "./kelly.ts";

Deno.test("expectancy: positive edge, and <=0 for no edge", () => {
  assertAlmostEquals(expectancy(0.5, 2, 1), 0.5, 1e-9);  // 0.5*2 - 0.5*1
  assert(expectancy(0.4, 1, 1) < 0);                      // negative EV
});

Deno.test("kellyFraction: classic values; negative edge -> 0", () => {
  assertAlmostEquals(kellyFraction(0.6, 1), 0.2, 1e-9);   // (p-q)/1
  assertAlmostEquals(kellyFraction(0.6, 2), 0.4, 1e-9);   // (2*.6-.4)/2
  assertEquals(kellyFraction(0.4, 1), 0);                 // negative edge -> no bet
  assertEquals(kellyFraction(0.9, 0), 0);                 // invalid ratio -> 0
});

Deno.test("fractionalKelly: scales by fraction and respects the cap", () => {
  assertAlmostEquals(fractionalKelly(0.6, 1, 0.5, 0.2), 0.1, 1e-9); // 0.5 * 0.2
  assertEquals(fractionalKelly(0.95, 1, 1.0, 0.2), 0.2);           // capped
  assertEquals(fractionalKelly(0.3, 1), 0);                        // no edge -> 0
});

Deno.test("kellyRiskUsdt: zero edge -> zero risk", () => {
  assertAlmostEquals(kellyRiskUsdt(1000, 0.6, 1, 0.5, 0.2), 100, 1e-9); // 1000 * 0.1
  assertEquals(kellyRiskUsdt(1000, 0.45, 1), 0);
});

Deno.test("riskOfRuin: certain at <=50%, low for a real edge, monotonic", () => {
  assertEquals(riskOfRuin(0.5, 0.1), 1);
  assertEquals(riskOfRuin(0.45, 0.1), 1);
  const ror = riskOfRuin(0.6, 0.1);
  assert(ror > 0 && ror < 0.05);                 // ~0.017
  assert(riskOfRuin(0.6, 0.2) > riskOfRuin(0.6, 0.1)); // bigger bets -> more ruin
});

Deno.test("sortino: only downside is penalized", () => {
  assertEquals(sortino([0.01]), 0);                 // <2 points
  assertEquals(sortino([0.01, 0.02, 0.03]), Infinity); // no downside, positive mean
  assert(sortino([0.02, -0.01, 0.03, -0.02]) > 0);
});
