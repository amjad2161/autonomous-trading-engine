// Deno tests for market-data, treasury and execution cores.
//   deno test supabase/functions/_shared/

import { assert, assertAlmostEquals, assertEquals } from "./_test_assert.ts";
import {
  dataQualityScore, depthWithinPct, estimateSlippagePct, isCrossed,
  isLeveragedToken, normalizeAmount, normalizePrice, spreadBps,
} from "./market-data.ts";
import {
  dynamicUsdtTargetPct, exposureRoomUsdt, feeBufferOk, liquidityShockSize,
  profitLockAmount, rebalancePlan, type Holding,
} from "./treasury.ts";
import {
  adaptiveTimeoutMs, prioritize, prioritizeBy, repriceDecision, shouldMarketFallback, stagedExitPlan,
} from "./execution.ts";

// ---------- market-data ----------

Deno.test("md: spread bps + crossed detection", () => {
  assertAlmostEquals(spreadBps(100, 101), 99.5, 0.2);
  assertEquals(spreadBps(101, 100), Infinity);
  assert(isCrossed(101, 100));
  assert(!isCrossed(100, 101));
});

Deno.test("md: depth within X% of ref (buy side)", () => {
  const asks: [number, number][] = [[100, 1], [100.4, 2], [101, 5]];
  // within 0.5% of 100 -> include 100 and 100.4, exclude 101
  assertAlmostEquals(depthWithinPct(asks, 100, 0.5, "buy"), 100 + 100.4 * 2, 1e-6);
});

Deno.test("md: slippage estimate walks the book", () => {
  const asks: [number, number][] = [[100, 1], [101, 1]];
  // buy 150 USDT -> ~0.33% slippage
  assertAlmostEquals(estimateSlippagePct(asks, "buy", 150), 0.33, 0.02);
  // can't fill 1e9 -> Infinity
  assertEquals(estimateSlippagePct(asks, "buy", 1e9), Infinity);
});

Deno.test("md: quality score + normalization + leveraged filter", () => {
  assertEquals(dataQualityScore({ ageMs: 0, staleMs: 3000, spreadBps: 0, maxSpreadBps: 50, crossed: true }), 0);
  assert(dataQualityScore({ ageMs: 100, staleMs: 3000, spreadBps: 5, maxSpreadBps: 50, crossed: false }) > 0.8);
  assertEquals(normalizeAmount(1.23987, 3), 1.239);
  assertEquals(normalizePrice(100.12345, 2), 100.12);
  assert(isLeveragedToken("BTC3L_USDT"));
  assert(isLeveragedToken("BTCUP_USDT"));
  assert(!isLeveragedToken("BTC_USDT"));
});

// ---------- treasury ----------

Deno.test("treasury: dynamic USDT target rises with toxicity", () => {
  assertEquals(dynamicUsdtTargetPct(0), 45);
  assertEquals(dynamicUsdtTargetPct(1), 80);
});

Deno.test("treasury: rebalance sells idle assets largest-first, skips mission", () => {
  const holdings: Holding[] = [
    { asset: "BTC", amountUsdt: 100, inMission: true },
    { asset: "ETH", amountUsdt: 80 },
    { asset: "SOL", amountUsdt: 50 },
  ];
  // equity 300, target 60% = 180, current USDT 100 -> need 80
  const plan = rebalancePlan(holdings, 300, 60, 100);
  assertEquals(plan[0].asset, "ETH"); // largest idle first
  assertEquals(plan.reduce((s, p) => s + p.amountUsdt, 0), 80);
  assert(!plan.some((p) => p.asset === "BTC")); // mission untouched
});

Deno.test("treasury: fee buffer, profit lock, exposure room, liquidity shock", () => {
  assert(feeBufferOk(20, 10));
  assert(!feeBufferOk(5, 10));
  assert(profitLockAmount(1200, 1000, 5) > 0); // gain 200 > 5% step (50)
  assertEquals(profitLockAmount(1010, 1000, 5), 0); // gain 10 < step 50
  assertEquals(exposureRoomUsdt(30, 50), 20);
  assertEquals(liquidityShockSize(100, 50, 100), 50);
});

// ---------- execution ----------

Deno.test("exec: exits/protection always before entries", () => {
  const sorted = prioritize([
    { kind: "ENTRY", symbol: "A" },
    { kind: "STOP_LOSS", symbol: "B" },
    { kind: "PANIC", symbol: "C" },
    { kind: "TAKE_PROFIT", symbol: "D" },
  ]);
  assertEquals(sorted.map((a) => a.kind), ["PANIC", "STOP_LOSS", "TAKE_PROFIT", "ENTRY"]);
});

Deno.test("exec: prioritizeBy orders arbitrary objects worst-first", () => {
  const exits = [
    { sym: "A", reason: "TP1" },
    { sym: "B", reason: "STOP_LOSS" },
    { sym: "C", reason: "PANIC" },
  ];
  const kind = (e: { reason: string }) =>
    e.reason.includes("PANIC") ? "PANIC" as const : e.reason.includes("STOP") ? "STOP_LOSS" as const : "TAKE_PROFIT" as const;
  const ordered = prioritizeBy(exits, kind).map((e) => e.sym);
  assertEquals(ordered, ["C", "B", "A"]);
});

Deno.test("exec: staged exit prefers IOC, market last (panic=market now)", () => {
  assertEquals(stagedExitPlan("panic"), [{ type: "MARKET" }]);
  const normal = stagedExitPlan("normal");
  assertEquals(normal[normal.length - 1].type, "MARKET");
  assert(normal.length >= 2);
});

Deno.test("exec: reprice caps + cancel on drift; market fallback triggers", () => {
  assertEquals(repriceDecision(0, 3, 5, 50), "REPRICE");
  assertEquals(repriceDecision(3, 3, 5, 50), "CANCEL");
  assertEquals(repriceDecision(0, 3, 80, 50), "CANCEL"); // drift too big
  assert(shouldMarketFallback({ slippageRising: true, depthVanishing: true, secondsStuck: 1, maxSecondsStuck: 30 }));
  assert(shouldMarketFallback({ slippageRising: false, depthVanishing: false, secondsStuck: 40, maxSecondsStuck: 30 }));
  assertEquals(adaptiveTimeoutMs(1000, 3), 3000);
});
