// Deno tests for the consolidated entry gate. deno test supabase/functions/_shared/

import { assert, assertEquals } from "./_test_assert.ts";
import { evaluateEntryGate } from "./entry-gate.ts";

const base = { autopilot: true, invariantsBlocked: false, postureBlocks: false, belowFeeBuffer: false };

Deno.test("entry-gate: all clear -> allowed", () => {
  const d = evaluateEntryGate(base);
  assert(d.allowed);
  assertEquals(d.reasons.length, 0);
});

Deno.test("entry-gate: autopilot off blocks with reason", () => {
  const d = evaluateEntryGate({ ...base, autopilot: false });
  assert(!d.allowed);
  assert(d.reasons.includes("autopilot-off"));
});

Deno.test("entry-gate: each system condition blocks", () => {
  assert(!evaluateEntryGate({ ...base, invariantsBlocked: true }).allowed);
  assert(!evaluateEntryGate({ ...base, postureBlocks: true }).allowed);
  assert(!evaluateEntryGate({ ...base, belowFeeBuffer: true }).allowed);
});

Deno.test("entry-gate: per-signal only blocks when explicitly false", () => {
  // undefined per-signal -> not evaluated -> allowed
  assert(evaluateEntryGate(base).allowed);
  assert(!evaluateEntryGate({ ...base, correlationOk: false }).allowed);
  assert(!evaluateEntryGate({ ...base, varOk: false }).allowed);
  assert(!evaluateEntryGate({ ...base, spreadOk: false }).allowed);
  assert(!evaluateEntryGate({ ...base, netEdgeOk: false }).allowed);
  // explicitly true -> fine
  assert(evaluateEntryGate({ ...base, correlationOk: true, varOk: true, spreadOk: true, netEdgeOk: true }).allowed);
});

Deno.test("entry-gate: collects multiple reasons", () => {
  const d = evaluateEntryGate({ autopilot: false, invariantsBlocked: true, postureBlocks: false, belowFeeBuffer: true });
  assertEquals(d.reasons.sort(), ["autopilot-off", "fee-buffer", "invariant"]);
});
