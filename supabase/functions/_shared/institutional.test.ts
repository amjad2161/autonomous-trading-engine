// Deno tests for the institutional governance cores (Spec v1.1, Layers 2 & 3).
//   deno test supabase/functions/_shared/

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { evaluateInvariants } from "./invariants.ts";
import {
  executionHealth,
  latencyScore,
  postureBlocksEntries,
  riskPosture,
  routeCapital,
  selectPersonality,
  toxicityScore,
} from "./health.ts";

// ---------- Invariants ----------

Deno.test("INV: empty context is OK and blocks nothing", () => {
  const r = evaluateInvariants({});
  assert(r.ok);
  assert(!r.blockEntries);
});

Deno.test("INV-02: daily loss at/under cap blocks new entries", () => {
  const r = evaluateInvariants({ dailyPnlUsdt: -21, dailyLossCapUsdt: 20 });
  assert(r.blockEntries);
  assert(r.violations.some((v) => v.id === "INV-02"));
});

Deno.test("INV-04: open positions at cap blocks new entries", () => {
  const r = evaluateInvariants({ openPositions: 3, maxOpenPositions: 3 });
  assert(r.blockEntries);
  assert(r.violations.some((v) => v.id === "INV-04"));
});

Deno.test("INV-01: stale websocket blocks entries", () => {
  assert(evaluateInvariants({ wsStale: true }).blockEntries);
});

Deno.test("INV: unmonitored metrics never fire", () => {
  // only fillRate-style telemetry absent -> nothing should block
  const r = evaluateInvariants({ openPositions: 1, maxOpenPositions: 3 });
  assert(!r.blockEntries);
});

// ---------- Risk posture ----------

Deno.test("posture: stale data -> FREEZE and blocks entries", () => {
  const { posture } = riskPosture({ dataFreshnessMs: 9999 });
  assertEquals(posture, "FREEZE");
  assert(postureBlocksEntries(posture));
});

Deno.test("posture: drawdown beyond halt -> HALT", () => {
  const { posture } = riskPosture({ dailyDrawdownPct: 9 });
  assertEquals(posture, "HALT");
});

Deno.test("posture: low fill rate -> RAISE_EDGE (does not block)", () => {
  const { posture } = riskPosture({ fillRatePct: 10 });
  assertEquals(posture, "RAISE_EDGE");
  assert(!postureBlocksEntries(posture));
});

Deno.test("posture: takes the most severe trigger", () => {
  const { posture } = riskPosture({ fillRatePct: 10, dataFreshnessMs: 9999 });
  assertEquals(posture, "FREEZE");
});

// ---------- Execution health & toxicity ----------

Deno.test("executionHealth: perfect metrics ~ 1, terrible ~ low", () => {
  const good = executionHealth({ executionLatencyMs: 100, fillRatePct: 99, slippagePct: 0.01, errorRatePerMin: 0 });
  const bad = executionHealth({ executionLatencyMs: 5000, fillRatePct: 5, slippagePct: 2, errorRatePerMin: 100 });
  assert(good > 0.8);
  assert(bad < 0.3);
});

Deno.test("toxicityScore: vanishing walls + no replenish = toxic", () => {
  const toxic = toxicityScore({ wallVanishRate: 0.9, aggressiveImbalance: 0.8, depthReplenishSpeed: 0.1 });
  const benign = toxicityScore({ wallVanishRate: 0.05, aggressiveImbalance: 0.1, depthReplenishSpeed: 0.9 });
  assert(toxic > 0.6);
  assert(benign < 0.3);
});

// ---------- Personality (hysteresis) ----------

Deno.test("personality: steps only ONE level (no flicker)", () => {
  // toxic conditions target MAKER_ONLY, but from AGGRESSIVE we step one level
  const next = selectPersonality({ toxicity: 0.9, executionHealth: 0.8, previous: "AGGRESSIVE" });
  assertEquals(next, "MAKER_HEAVY");
});

Deno.test("personality: collapses to FREEZE on broken execution", () => {
  const next = selectPersonality({ toxicity: 0.1, executionHealth: 0.1, previous: "MAKER_ONLY" });
  assertEquals(next, "FREEZE");
});

// ---------- Capital routing ----------

Deno.test("routeCapital: toxic/drawdown -> DE_RISK to cash", () => {
  const r = routeCapital(0.8, 0.3, 5);
  assertEquals(r.action, "DE_RISK");
  assert(r.cashTargetPct >= 70);
});

Deno.test("routeCapital: calm + healthy -> EXPAND_TRADING", () => {
  const r = routeCapital(0.1, 0.9, 0);
  assertEquals(r.action, "EXPAND_TRADING");
  assert(r.tradingTargetPct >= 35);
});

// ---------- Latency ----------

Deno.test("latencyScore: within budget = 1, far over = 0", () => {
  assertEquals(latencyScore(50, 100), 1);
  assert(latencyScore(250, 100) < 0.1);
});
