// Deno tests for the order state machine + AI governance.
//   deno test supabase/functions/_shared/

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { applyOrderEvent, isTerminal, nextOrderState, remainingQty, type OrderRecord } from "./order-state.ts";
import { canPromote, passesAcceptance, shouldRollback, type KpiSnapshot } from "./governance.ts";

// ---------- Order state machine ----------

const fresh = (): OrderRecord => ({ id: "o1", state: "NEW", totalQty: 10, filledQty: 0 });

Deno.test("order: NEW --ack--> ACK", () => {
  assertEquals(applyOrderEvent(fresh(), "ack").state, "ACK");
});

Deno.test("order: invalid transition is a safe no-op", () => {
  // can't fill a NEW order before ack in this machine
  const r = applyOrderEvent(fresh(), "fill");
  assertEquals(r.state, "NEW");
  assertEquals(r.filledQty, 0);
  assertEquals(nextOrderState("NEW", "fill"), null);
});

Deno.test("order: partial fills accumulate, full fill completes", () => {
  let r = applyOrderEvent(fresh(), "ack");
  r = applyOrderEvent(r, "partial_fill", 4);
  assertEquals(r.state, "PARTIAL");
  assertEquals(r.filledQty, 4);
  assertEquals(remainingQty(r), 6);
  r = applyOrderEvent(r, "fill");
  assertEquals(r.state, "FILLED");
  assertEquals(r.filledQty, 10);
  assertEquals(remainingQty(r), 0);
});

Deno.test("order: terminal states ignore further events (idempotent)", () => {
  let r = applyOrderEvent(applyOrderEvent(fresh(), "ack"), "fill");
  assert(isTerminal(r.state));
  const after = applyOrderEvent(r, "cancel");
  assertEquals(after.state, "FILLED");
});

Deno.test("order: partial fill never exceeds total qty", () => {
  let r = applyOrderEvent(fresh(), "ack");
  r = applyOrderEvent(r, "partial_fill", 999);
  assertEquals(r.filledQty, 10);
});

// ---------- Governance ----------

const goodKpi: KpiSnapshot = { fillRatePct: 70, avgSlippagePct: 0.1, maxDrawdownPct: 3, profitFactor: 1.4 };
const badKpi: KpiSnapshot = { fillRatePct: 30, avgSlippagePct: 0.9, maxDrawdownPct: 12, profitFactor: 0.8 };

Deno.test("governance: acceptance passes good KPIs, fails bad", () => {
  assert(passesAcceptance(goodKpi).ok);
  assert(!passesAcceptance(badKpi).ok);
});

Deno.test("governance: promotion SHADOW->CANARY only when accepted", () => {
  assertEquals(canPromote("SHADOW", goodKpi).to, "CANARY");
  assertEquals(canPromote("SHADOW", badKpi).to, null);
  assertEquals(canPromote("CANARY", goodKpi).to, "LIVE");
});

Deno.test("governance: rollback on material degradation, not on stability", () => {
  const baseline: KpiSnapshot = { fillRatePct: 70, avgSlippagePct: 0.1, maxDrawdownPct: 3, profitFactor: 1.5 };
  const degraded: KpiSnapshot = { fillRatePct: 70, avgSlippagePct: 0.1, maxDrawdownPct: 3, profitFactor: 1.0 }; // -33%
  assert(shouldRollback(baseline, degraded).rollback);
  assert(!shouldRollback(baseline, baseline).rollback);
});
