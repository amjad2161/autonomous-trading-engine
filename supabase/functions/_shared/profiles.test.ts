// Deno tests for the trading-profiles engine — run with:
//   deno test supabase/functions/_shared/
//
// Executable proof that the mode selector behaves — and, crucially, that even
// the AGGRESSIVE / CUSTOM / AUTO modes stay inside the hard bounds.

import { assert, assertEquals } from "./_test_assert.ts";
import {
  adaptiveParams,
  clampParams,
  PROFILES,
  resolveConfig,
} from "./profiles.ts";

Deno.test("default settings resolve to BALANCED with autopilot OFF", () => {
  const c = resolveConfig(null);
  assertEquals(c.profile, "BALANCED");
  assertEquals(c.autopilot, false);
  assertEquals(c.maxTradeUsdt, PROFILES.BALANCED.maxTradeUsdt);
});

Deno.test("AGGRESSIVE preset is selected and is bigger than CONSERVATIVE", () => {
  const agg = resolveConfig({ profile: "AGGRESSIVE", autopilot: true });
  assertEquals(agg.profile, "AGGRESSIVE");
  assertEquals(agg.autopilot, true);
  assert(agg.maxTradeUsdt > PROFILES.CONSERVATIVE.maxTradeUsdt);
  assert(agg.maxTradesPerHour > PROFILES.CONSERVATIVE.maxTradesPerHour);
  assert(agg.minEdgePct < PROFILES.CONSERVATIVE.minEdgePct);
});

Deno.test("invalid profile name falls back to BALANCED", () => {
  const c = resolveConfig({ profile: "YOLO_MAX" });
  assertEquals(c.profile, "BALANCED");
});

Deno.test("CUSTOM merges overrides on BALANCED and CLAMPS extremes", () => {
  const c = resolveConfig({ profile: "CUSTOM", custom: { maxTradeUsdt: 999999, maxOpenPositions: 50 } });
  assertEquals(c.profile, "CUSTOM");
  assert(c.maxTradeUsdt <= 100, "maxTradeUsdt must be clamped to the hard bound");
  assert(c.maxOpenPositions <= 8, "maxOpenPositions must be clamped");
});

Deno.test("clampParams pulls every knob into bounds", () => {
  const p = clampParams({
    riskPerTradePct: 99,
    maxTradeUsdt: 1e9,
    maxOpenPositions: 999,
    maxTradesPerHour: 999,
    minEdgePct: -5,
    takeProfitPct: 0,
    stopLossPct: 99,
    slippageTolerancePct: 9,
    cooldownSec: 0,
  });
  assert(p.riskPerTradePct <= 3 && p.riskPerTradePct >= 0.1);
  assert(p.maxTradeUsdt <= 100);
  assert(p.maxOpenPositions <= 8);
  assert(p.slippageTolerancePct <= 1);
  assert(p.cooldownSec >= 3);
});

Deno.test("AUTO de-risks in high volatility vs calm", () => {
  const calm = adaptiveParams({ volatilityPct: 0.5, trendStrength: 0.6, balanceUsdt: 1000, drawdownPct: 0 });
  const wild = adaptiveParams({ volatilityPct: 8, trendStrength: 0.6, balanceUsdt: 1000, drawdownPct: 0 });
  assert(wild.params.maxTradeUsdt < calm.params.maxTradeUsdt, "high vol should size smaller");
  assert(wild.params.minEdgePct >= calm.params.minEdgePct, "high vol should demand more edge");
});

Deno.test("AUTO forces conservative sizing on a thin balance", () => {
  const thin = adaptiveParams({ volatilityPct: 2, trendStrength: 0.7, balanceUsdt: 150, drawdownPct: 0 });
  assert(thin.params.maxTradeUsdt <= PROFILES.CONSERVATIVE.maxTradeUsdt);
  assert(thin.params.maxOpenPositions <= 2);
});

Deno.test("AUTO de-risks in a drawdown", () => {
  const flat = adaptiveParams({ volatilityPct: 2, trendStrength: 0.3, balanceUsdt: 1000, drawdownPct: 0 });
  const dd = adaptiveParams({ volatilityPct: 2, trendStrength: 0.3, balanceUsdt: 1000, drawdownPct: 15 });
  assert(dd.params.maxTradeUsdt < flat.params.maxTradeUsdt, "drawdown should shrink size");
});

Deno.test("resolveConfig AUTO with a market snapshot is adaptive", () => {
  const c = resolveConfig(
    { profile: "AUTO", autopilot: true },
    { volatilityPct: 3, trendStrength: 0.2, balanceUsdt: 800, drawdownPct: 2 },
  );
  assertEquals(c.profile, "AUTO");
  assert(c.adaptive);
  assert(c.rationale.startsWith("AUTO"));
});

Deno.test("resolveConfig AUTO without a market snapshot falls back to BALANCED params", () => {
  const c = resolveConfig({ profile: "AUTO", autopilot: true });
  assertEquals(c.profile, "AUTO");
  assertEquals(c.maxTradeUsdt, PROFILES.BALANCED.maxTradeUsdt);
});
