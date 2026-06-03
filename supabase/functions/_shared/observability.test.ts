// Deno tests for replay (event sourcing) + observability metrics.
//   deno test supabase/functions/_shared/

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { replay, type ReplayEvent } from "./replay.ts";
import { alertDecisions, computeKpis, maxDrawdown, type TradeRow } from "./metrics.ts";

// ---------- replay ----------

Deno.test("replay: buy then sell realizes pnl deterministically", () => {
  const events: ReplayEvent[] = [
    { ts: 2, type: "fill", symbol: "BTC", side: "sell", qty: 1, price: 110, feeUsdt: 0.11 },
    { ts: 1, type: "fill", symbol: "BTC", side: "buy", qty: 1, price: 100, feeUsdt: 0.1 },
  ];
  const s = replay(events, 1000); // events get sorted by ts -> buy first
  assertAlmostEquals(s.realizedPnlUsdt, 9.89, 1e-6); // (110-100)*1 - 0.11
  assertAlmostEquals(s.cashUsdt, 1009.79, 1e-6);     // 1000 - 100.1 + 110 - 0.11
  assertEquals(s.fills, 2);
  assertEquals(s.positions["BTC"].qty, 0);
});

Deno.test("replay: deposits add cash, notes are inert", () => {
  const s = replay([
    { ts: 1, type: "deposit", usdt: 500 },
    { ts: 2, type: "note", tag: "hello" },
  ], 0);
  assertEquals(s.cashUsdt, 500);
  assertEquals(s.fills, 0);
});

// ---------- metrics ----------

Deno.test("metrics: maxDrawdown of a cumulative curve", () => {
  assertEquals(maxDrawdown([10, 5, 25, 23]), 5);
  assertEquals(maxDrawdown([1, 2, 3]), 0);
});

Deno.test("metrics: KPIs aggregate correctly", () => {
  const trades: TradeRow[] = [
    { pnlUsdt: 10 }, { pnlUsdt: -5 }, { pnlUsdt: 20 }, { pnlUsdt: -2 },
  ];
  const k = computeKpis(trades);
  assertEquals(k.count, 4);
  assertEquals(k.wins, 2);
  assertEquals(k.winRatePct, 50);
  assertEquals(k.totalPnlUsdt, 23);
  assertAlmostEquals(k.profitFactor, 4.29, 0.01); // 30 / 7
});

Deno.test("metrics: alerts fire on bad drawdown", () => {
  const trades: TradeRow[] = [{ pnlUsdt: 10 }, { pnlUsdt: -5 }, { pnlUsdt: 20 }, { pnlUsdt: -2 }];
  const k = computeKpis(trades); // drawdown 5 / 25 = 20%
  const alerts = alertDecisions(k);
  assert(alerts.some((a) => a.level === "critical" && a.message.includes("drawdown")));
});
