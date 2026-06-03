// Deno tests for the Gate.io mechanics model. deno test supabase/functions/_shared/

import { assert, assertAlmostEquals, assertEquals } from "./_test_assert.ts";
import {
  effectiveFeeBps, meetsMinimums, parseSpotPairRules, recommendedTif, roundTripFeeBps,
  SPOT_TAKER_BPS_BY_VIP, type SymbolRules,
} from "./gate-rules.ts";
import { netEdgePct } from "./scoring.ts";

Deno.test("fees: standard taker = 20bps, GT discount applies", () => {
  assertEquals(effectiveFeeBps({ isMaker: false }), 20);
  assertAlmostEquals(effectiveFeeBps({ isMaker: false, payWithGt: true }), 15, 1e-9); // 20 * 0.75
});

Deno.test("fees: VIP tier lowers fees; beyond ladder clamps to last", () => {
  assert(effectiveFeeBps({ isMaker: false, vipLevel: 5 }) < effectiveFeeBps({ isMaker: false, vipLevel: 0 }));
  assertEquals(effectiveFeeBps({ isMaker: false, vipLevel: 999 }), SPOT_TAKER_BPS_BY_VIP[SPOT_TAKER_BPS_BY_VIP.length - 1]);
});

Deno.test("fees: round-trip maker+maker standard = 40bps", () => {
  assertEquals(roundTripFeeBps({ isMaker: true }, { isMaker: true }), 40);
});

Deno.test("TIF: maker harvest -> poc (post-only), taker scalp -> ioc", () => {
  assertEquals(recommendedTif("maker_harvest"), "poc");
  assertEquals(recommendedTif("scalp_taker"), "ioc");
  assertEquals(recommendedTif("exit_urgent"), "ioc");
});

Deno.test("minimums: enforces min notional + base amount", () => {
  const rules: SymbolRules = { pricePrecision: 2, amountPrecision: 6, minBaseAmount: 0.0001, minQuoteAmount: 3 };
  assert(meetsMinimums(5, 0.001, rules));
  assert(!meetsMinimums(2, 0.001, rules));   // below min notional
  assert(!meetsMinimums(5, 0.00001, rules)); // below min base amount
});

Deno.test("symbol rules: parses /spot/currency_pairs into per-symbol precision/min", () => {
  const rules = parseSpotPairRules([
    { id: "BTC_USDT", base: "BTC", quote: "USDT", precision: 2, amount_precision: 6, min_base_amount: "0.0001", min_quote_amount: "3", trade_status: "tradable" },
    { id: "FOO_USDT", base: "FOO", quote: "USDT", precision: 4, amount_precision: 2, min_base_amount: "1", min_quote_amount: "5", trade_status: "untradable" },
  ]);
  assertEquals(rules["BTC_USDT"].pricePrecision, 2);
  assertEquals(rules["BTC_USDT"].amountPrecision, 6);
  assertEquals(rules["BTC_USDT"].minQuoteAmount, 3);
  assert(rules["BTC_USDT"].tradable);
  assert(!rules["FOO_USDT"].tradable);
});

Deno.test("integration: Gate.io fees feed the net-edge cost model", () => {
  // round-trip taker fees (40bps = 0.40%) consume a 0.5% expected move -> 0.10% net
  const fees = roundTripFeeBps({ isMaker: false }, { isMaker: false }); // 40
  const net = netEdgePct(0.5, { feeBps: fees, spreadBps: 0 });
  assertAlmostEquals(net, 0.1, 1e-9);
});
