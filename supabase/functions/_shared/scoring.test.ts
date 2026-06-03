// Deno tests for net-edge scoring & sizing.  deno test supabase/functions/_shared/

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  cooldownActive,
  estimatedCostsPct,
  netEdgePct,
  opportunityExpired,
  passesNetEdgeGate,
  positionSizeUsdt,
  scoreOpportunity,
} from "./scoring.ts";

const costs = { feeBps: 20, spreadBps: 10, slippagePct: 0.05, latencyPenaltyPct: 0.02 };

Deno.test("costs sum conservatively (fee+spread+slip+latency)", () => {
  // 0.20 + 0.10 + 0.05 + 0.02 = 0.37%
  assertAlmostEquals(estimatedCostsPct(costs), 0.37, 1e-9);
});

Deno.test("net edge = expected move - costs", () => {
  assertAlmostEquals(netEdgePct(1.0, costs), 0.63, 1e-9);
});

Deno.test("net-edge gate rejects when edge < threshold", () => {
  // move 0.4% vs 0.37% costs -> 0.03% net; below a 0.1% min -> reject
  assert(!passesNetEdgeGate(0.4, costs, 0.1));
  // move 1% -> 0.63% net -> passes
  assert(passesNetEdgeGate(1.0, costs, 0.1));
});

Deno.test("position size = MIN of every binding constraint", () => {
  const size = positionSizeUsdt({
    riskUsdt: 10,
    stopDistanceFrac: 0.01,   // byRisk = 10 / 0.01 = 1000
    liquiditySafeUsdt: 200,
    exposureRoomUsdt: 150,    // <- the binding (smallest) constraint
    availableUsdt: 500,
    hardMaxUsdt: 25,          // wait: hard cap is even smaller
  });
  // smallest is hardMaxUsdt = 25
  assertEquals(size, 25);
});

Deno.test("position size binds on liquidity when it is smallest", () => {
  const size = positionSizeUsdt({
    riskUsdt: 10, stopDistanceFrac: 0.01, // 1000
    liquiditySafeUsdt: 8,                 // <- binding
    exposureRoomUsdt: 150, availableUsdt: 500, hardMaxUsdt: 25,
  });
  assertEquals(size, 8);
});

Deno.test("position size is never negative", () => {
  const size = positionSizeUsdt({
    riskUsdt: 10, stopDistanceFrac: 0.01,
    liquiditySafeUsdt: -5, exposureRoomUsdt: 0, availableUsdt: 500, hardMaxUsdt: 25,
  });
  assertEquals(size, 0);
});

Deno.test("opportunity score = net edge minus risk penalty", () => {
  const s = scoreOpportunity({ expectedMovePct: 1.0, costs, riskPenaltyPct: 0.2 });
  assertAlmostEquals(s, 0.43, 1e-9); // 0.63 - 0.20
});

Deno.test("opportunity expires after TTL", () => {
  const t0 = 1_000_000;
  assert(!opportunityExpired(t0, 5000, t0 + 4000));
  assert(opportunityExpired(t0, 5000, t0 + 6000));
});

Deno.test("cooldown active within window, inactive after", () => {
  const t0 = 1_000_000;
  assert(cooldownActive(t0, 60_000, t0 + 30_000));
  assert(!cooldownActive(t0, 60_000, t0 + 90_000));
  assert(!cooldownActive(undefined, 60_000, t0));
});
