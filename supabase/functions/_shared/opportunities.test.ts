// Deno tests for opportunity normalization/dedup/rank. deno test supabase/functions/_shared/

import { assert, assertEquals } from "./_test_assert.ts";
import {
  clockDriftMs, clockDriftOk, dedupeOpportunities, filterExpired,
  normalizeOpportunity, planFromScanners, rankOpportunities,
} from "./opportunities.ts";

Deno.test("normalize: coerces varied scanner output to the standard shape", () => {
  const o = normalizeOpportunity({ currency_pair: "BTC_USDT", edge: 0.3, sizeUsdt: 20, ttlMs: 5000 }, "scalper");
  assertEquals(o.symbol, "BTC_USDT");
  assertEquals(o.expectedNetEdgePct, 0.3);
  assertEquals(o.requiredSizeUsdt, 20);
  assert(o.expiryMs > Date.now());
});

Deno.test("filterExpired: drops stale opportunities", () => {
  const now = 1_000_000;
  const list = [
    normalizeOpportunity({ symbol: "A", expiryMs: now - 1 }),
    normalizeOpportunity({ symbol: "B", expiryMs: now + 10_000 }),
  ];
  const live = filterExpired(list, now);
  assertEquals(live.map((o) => o.symbol), ["B"]);
});

Deno.test("dedupe: keeps the highest net edge per symbol", () => {
  const list = [
    normalizeOpportunity({ symbol: "BTC_USDT", edge: 0.2 }),
    normalizeOpportunity({ symbol: "BTC_USDT", edge: 0.5 }),
    normalizeOpportunity({ symbol: "ETH_USDT", edge: 0.1 }),
  ];
  const d = dedupeOpportunities(list);
  assertEquals(d.length, 2);
  assertEquals(d.find((o) => o.symbol === "BTC_USDT")!.expectedNetEdgePct, 0.5);
});

Deno.test("rank: best net edge first", () => {
  const ranked = rankOpportunities([
    normalizeOpportunity({ symbol: "A", edge: 0.1 }),
    normalizeOpportunity({ symbol: "B", edge: 0.9 }),
  ]);
  assertEquals(ranked[0].symbol, "B");
});

Deno.test("planFromScanners: normalize -> drop expired -> dedupe -> rank -> topN", () => {
  const now = 2_000_000;
  const plan = planFromScanners([
    { symbol: "A", edge: 0.2, expiryMs: now + 5000 },
    { symbol: "A", edge: 0.6, expiryMs: now + 5000 },
    { symbol: "B", edge: 0.4, expiryMs: now - 1 },   // expired
    { symbol: "C", edge: 0.5, expiryMs: now + 5000 },
  ], 5, now);
  assertEquals(plan.map((o) => o.symbol), ["A", "C"]); // B dropped, A deduped to 0.6, ranked
  assertEquals(plan[0].expectedNetEdgePct, 0.6);
});

Deno.test("clock drift guard", () => {
  assertEquals(clockDriftMs(1000, 1500), 500);
  assert(clockDriftOk(500, 2000));
  assert(!clockDriftOk(5000, 2000));
});
