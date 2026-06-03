// Deno tests for the shared safety layer — run with:  deno test supabase/functions/_shared/
//
// These are executable PROOFS of the safety invariants the whole system relies
// on. A claim like "DRY_RUN is the default" or "the kill switch blocks orders"
// is only trustworthy if it is verifiable. Each test pins one invariant.

import { assert, assertEquals, assertThrows } from "./_test_assert.ts";
import {
  assertOrderAllowed,
  effectiveModeWithValidation,
  getRiskCaps,
  getTradingMode,
  guardSpotOrder,
  isDryRun,
  isKillSwitchOn,
  OrderBlockedError,
} from "./safety.ts";

const SAFETY_ENV = [
  "TRADING_MODE",
  "KILL_SWITCH",
  "REQUIRE_VALIDATION",
  "VALIDATION_PASSED",
  "MAX_TRADE_USDT",
  "MAX_DAILY_LOSS_USDT",
  "MAX_OPEN_POSITIONS",
  "MAX_TRADES_PER_HOUR",
  "MIN_EQUITY_USDT",
];

function resetEnv() {
  for (const k of SAFETY_ENV) Deno.env.delete(k);
}

const order = (over: Record<string, unknown> = {}) => ({
  currency_pair: "BTC_USDT",
  side: "buy",
  amount: "0.0001",
  price: "50000",
  ...over,
});

Deno.test("INVARIANT: default mode is DRY_RUN (fail safe)", () => {
  resetEnv();
  assertEquals(getTradingMode(), "DRY_RUN");
  assert(isDryRun());
});

Deno.test("INVARIANT: garbage TRADING_MODE is treated as DRY_RUN", () => {
  resetEnv();
  Deno.env.set("TRADING_MODE", "live-ish-typo");
  assertEquals(getTradingMode(), "DRY_RUN");
});

Deno.test("INVARIANT: only the exact value LIVE enables live mode", () => {
  resetEnv();
  Deno.env.set("TRADING_MODE", "LIVE");
  assertEquals(getTradingMode(), "LIVE");
  assert(!isDryRun());
});

Deno.test("INVARIANT: kill switch is recognised from several truthy spellings", () => {
  resetEnv();
  for (const v of ["1", "true", "YES", "on"]) {
    Deno.env.set("KILL_SWITCH", v);
    assert(isKillSwitchOn(), `KILL_SWITCH=${v} should be on`);
  }
  Deno.env.set("KILL_SWITCH", "0");
  assert(!isKillSwitchOn());
});

Deno.test("INVARIANT: kill switch blocks an order even in LIVE", () => {
  resetEnv();
  Deno.env.set("TRADING_MODE", "LIVE");
  Deno.env.set("KILL_SWITCH", "1");
  assertThrows(
    () => assertOrderAllowed({ function: "t", symbol: "BTC_USDT", side: "buy", notionalUsdt: 5 }),
    OrderBlockedError,
    "Kill switch",
  );
});

Deno.test("INVARIANT: orders above MAX_TRADE_USDT are blocked", () => {
  resetEnv();
  Deno.env.set("TRADING_MODE", "LIVE");
  Deno.env.set("MAX_TRADE_USDT", "25");
  assertThrows(
    () => assertOrderAllowed({ function: "t", symbol: "BTC_USDT", side: "buy", notionalUsdt: 26 }),
    OrderBlockedError,
    "MAX_TRADE_USDT",
  );
  // within cap is allowed
  assertEquals(
    assertOrderAllowed({ function: "t", symbol: "BTC_USDT", side: "buy", notionalUsdt: 24 }),
    "LIVE",
  );
});

Deno.test("INVARIANT: non-positive notional is refused", () => {
  resetEnv();
  Deno.env.set("TRADING_MODE", "LIVE");
  assertThrows(
    () => assertOrderAllowed({ function: "t", symbol: "BTC_USDT", side: "buy", notionalUsdt: 0 }),
    OrderBlockedError,
    "BAD_NOTIONAL",
  );
});

Deno.test("INVARIANT: risk caps come from env with safe defaults", () => {
  resetEnv();
  let caps = getRiskCaps();
  assertEquals(caps.maxTradeUsdt, 25);
  assertEquals(caps.maxOpenPositions, 3);
  Deno.env.set("MAX_TRADE_USDT", "100");
  caps = getRiskCaps();
  assertEquals(caps.maxTradeUsdt, 100);
});

Deno.test("INVARIANT: REQUIRE_VALIDATION downgrades LIVE to DRY_RUN until passed", () => {
  resetEnv();
  Deno.env.set("TRADING_MODE", "LIVE");
  Deno.env.set("REQUIRE_VALIDATION", "1");
  assertEquals(effectiveModeWithValidation(), "DRY_RUN");
  Deno.env.set("VALIDATION_PASSED", "1");
  assertEquals(effectiveModeWithValidation(), "LIVE");
});

Deno.test("INVARIANT: guardSpotOrder simulates in DRY_RUN and never sends live", () => {
  resetEnv(); // default DRY_RUN
  const sim = guardSpotOrder("t", order());
  assert(sim !== null);
  assertEquals(sim?.dryRun, true);
  assertEquals(sim?.status, "closed");
  assertEquals(sim?.currency_pair, "BTC_USDT");
});

Deno.test("INVARIANT: guardSpotOrder returns null in LIVE so the caller proceeds", () => {
  resetEnv();
  Deno.env.set("TRADING_MODE", "LIVE");
  Deno.env.set("MAX_TRADE_USDT", "1000"); // 0.0001*50000 = 5 USDT, within cap
  const res = guardSpotOrder("t", order());
  assertEquals(res, null);
});

Deno.test("INVARIANT: guardSpotOrder enforces caps using price*amount notional", () => {
  resetEnv();
  Deno.env.set("TRADING_MODE", "LIVE");
  Deno.env.set("MAX_TRADE_USDT", "10"); // 0.001*50000 = 50 USDT > 10 -> blocked
  assertThrows(
    () => guardSpotOrder("t", order({ amount: "0.001" })),
    OrderBlockedError,
    "MAX_TRADE_USDT",
  );
});
