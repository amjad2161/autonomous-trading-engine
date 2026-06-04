// Deno tests for the shared fill-accounting helper. deno test supabase/functions/_shared/
// (also runs under `npm test` via the vitest Deno shim).
//
// These pin the partial-fill exit invariant the engines rely on: book P&L only
// on the fraction actually sold, and keep the residual open instead of orphaning
// it. Each test fixes one edge of splitFill().

import { assert, assertAlmostEquals, assertEquals } from "./_test_assert.ts";
import { splitFill } from "./fill-accounting.ts";

Deno.test("full fill closes the position and books the whole fraction", () => {
  const r = splitFill(10, 10);
  assertEquals(r.fullyClosed, true);
  assertEquals(r.fraction, 1);
  assertEquals(r.soldBase, 10);
  assertEquals(r.residualBase, 0);
});

Deno.test("half fill books half and keeps half open", () => {
  const r = splitFill(10, 5);
  assertEquals(r.fullyClosed, false);
  assertAlmostEquals(r.fraction, 0.5);
  assertEquals(r.soldBase, 5);
  assertAlmostEquals(r.residualBase, 5);
});

Deno.test("missing filled amount falls back to fully sold (no phantom residual)", () => {
  const r = splitFill(10, undefined);
  assertEquals(r.fullyClosed, true);
  assertEquals(r.fraction, 1);
  assertEquals(r.soldBase, 10);
  assertEquals(r.residualBase, 0);
});

Deno.test("zero filled amount also falls back to fully sold", () => {
  const r = splitFill(10, 0);
  assertEquals(r.fullyClosed, true);
  assertEquals(r.soldBase, 10);
});

Deno.test("over-fill is clamped: never sells more than held", () => {
  const r = splitFill(10, 12);
  assertEquals(r.soldBase, 10);
  assertEquals(r.fraction, 1);
  assertEquals(r.fullyClosed, true);
  assertEquals(r.residualBase, 0);
});

Deno.test("near-full fill within the default threshold counts as fully closed", () => {
  const r = splitFill(10, 9.995); // 99.95% — above 0.999
  assertEquals(r.fullyClosed, true);
  assertEquals(r.residualBase, 0);
});

Deno.test("just-below-threshold fill stays partial with a residual", () => {
  const r = splitFill(10, 9.9); // 99% — below 0.999
  assertEquals(r.fullyClosed, false);
  assert(r.residualBase > 0);
  assertAlmostEquals(r.residualBase, 0.1, 1e-6);
});

Deno.test("degenerate/empty position is treated as closed, no division by zero", () => {
  const z = splitFill(0, 5);
  assertEquals(z.fullyClosed, true);
  assertEquals(z.fraction, 1);
  assertEquals(z.residualBase, 0);

  const neg = splitFill(-1, 5);
  assertEquals(neg.fullyClosed, true);
});

Deno.test("non-finite inputs degrade safely", () => {
  assertEquals(splitFill(NaN, 5).fullyClosed, true);
  const r = splitFill(10, NaN);
  assertEquals(r.soldBase, 10); // NaN fill -> fallback to full
  assertEquals(r.fullyClosed, true);
});

Deno.test("custom threshold is honored", () => {
  // With a strict 1.0 threshold, a 99.95% fill is NOT fully closed.
  const r = splitFill(10, 9.995, 1);
  assertEquals(r.fullyClosed, false);
  assert(r.residualBase > 0);
});
