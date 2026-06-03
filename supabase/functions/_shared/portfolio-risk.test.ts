// Deno tests for portfolio VaR. deno test supabase/functions/_shared/

import { assert, assertAlmostEquals, assertEquals } from "./_test_assert.ts";
import { parametricVaRUsdt, varGate, zScore } from "./portfolio-risk.ts";

Deno.test("zScore: standard confidence levels", () => {
  assertEquals(zScore(0.95), 1.645);
  assertEquals(zScore(0.99), 2.326);
  assert(zScore(0.90) < zScore(0.99));
});

Deno.test("VaR: single position 100 @ 5% vol, 95% ~ 8.225", () => {
  assertAlmostEquals(parametricVaRUsdt([{ notionalUsdt: 100, volatilityPct: 5 }], 0.95), 8.225, 1e-3);
  assertEquals(parametricVaRUsdt([], 0.95), 0);
});

Deno.test("VaR is conservative: adds across positions (worst-case)", () => {
  const v = parametricVaRUsdt([
    { notionalUsdt: 100, volatilityPct: 5 },
    { notionalUsdt: 50, volatilityPct: 4 },
  ], 0.95);
  // 1.645 * (100*0.05 + 50*0.04) = 1.645 * 7 = 11.515
  assertAlmostEquals(v, 11.515, 1e-3);
});

Deno.test("varGate: blocks an add that breaches the cap", () => {
  const positions = [{ notionalUsdt: 100, volatilityPct: 5 }]; // VaR ~8.225
  assert(varGate(positions, { notionalUsdt: 10, volatilityPct: 5 }, 20).ok);     // ~9.05 <= 20
  assert(!varGate(positions, { notionalUsdt: 300, volatilityPct: 5 }, 20).ok);   // way over
});
