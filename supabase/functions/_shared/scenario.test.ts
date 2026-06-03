// Deno tests for the scenario micro-sim. deno test supabase/functions/_shared/

import { assert, assertEquals } from "./_test_assert.ts";
import { scenarioAcceptable, simulateTradeOutcome } from "./scenario.ts";

Deno.test("scenario: probabilities sum to 1 and are deterministic by seed", () => {
  const params = { entryPrice: 100, tpPrice: 101, slPrice: 99, volStepPct: 0.2, maxSteps: 50, paths: 1000, seed: 42 };
  const a = simulateTradeOutcome(params);
  const b = simulateTradeOutcome(params);
  assertEquals(a, b); // deterministic
  assert(Math.abs(a.pTP + a.pSL + a.pTimeout - 1) < 1e-9);
});

Deno.test("scenario: a far TP and near SL -> SL more likely", () => {
  const r = simulateTradeOutcome({ entryPrice: 100, tpPrice: 110, slPrice: 99.5, volStepPct: 0.3, paths: 1500, seed: 7 });
  assert(r.pSL > r.pTP);
});

Deno.test("scenario: positive drift improves TP odds vs negative drift", () => {
  const base = { entryPrice: 100, tpPrice: 101, slPrice: 99, volStepPct: 0.2, paths: 1500, seed: 7 };
  const up = simulateTradeOutcome({ ...base, driftStepPct: 0.05 });
  const down = simulateTradeOutcome({ ...base, driftStepPct: -0.05 });
  assert(up.pTP > down.pTP);
});

Deno.test("scenarioAcceptable: rejects high tail risk / negative EV", () => {
  assert(!scenarioAcceptable({ pTP: 0.2, pSL: 0.8, pTimeout: 0, expectedReturnPct: -0.3 }));
  assert(scenarioAcceptable({ pTP: 0.7, pSL: 0.2, pTimeout: 0.1, expectedReturnPct: 0.4 }));
});
