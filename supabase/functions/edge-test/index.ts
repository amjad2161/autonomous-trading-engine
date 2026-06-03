import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireAuth, AuthError } from "../_shared/auth.ts";
import { fetchGateCandles, buildUpDownDataset } from "../_shared/dataset.ts";
import { edgeVerdict, logLoss, sharpe } from "../_shared/validation.ts";
import { candlesToReturns } from "../_shared/dataset.ts";

// =============================================================================
// edge-test  —  the honest LIVE gate, on REAL Gate.io data
// =============================================================================
// Pulls real public candlesticks (no API key) and runs the edge detector: does a
// (naive) model beat the market base-rate reference by a meaningful skill margin?
// Usually the answer is "no" — that is the truthful, expected result, and it is
// exactly what should gate any move to TRADING_MODE=LIVE.
//
// Read-only: fetches public market data and scores it. Sends no orders.
// =============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-function-secret",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    requireAuth(req);

    const body = await req.json().catch(() => ({}));
    const pairs: string[] = Array.isArray(body.pairs) && body.pairs.length
      ? body.pairs.slice(0, 10).map((p: unknown) => String(p))
      : ["BTC_USDT", "ETH_USDT"];
    const interval = String(body.interval ?? "1m");
    const limit = Math.min(1000, Math.max(50, Number(body.limit ?? 1000)));
    const minSkill = Number(body.minSkill ?? 0.01);

    const results = [];
    for (const pair of pairs) {
      try {
        const candles = await fetchGateCandles(pair, interval, limit);
        const ds = buildUpDownDataset(candles);
        const verdict = edgeVerdict(ds.momentumPreds, ds.marketPreds, ds.outcomes, minSkill);
        const rets = candlesToReturns(candles);
        results.push({
          pair,
          samples: ds.outcomes.length,
          hasEdge: verdict.hasEdge,
          skill: Number(verdict.skill.toFixed(4)),
          modelBrier: Number(verdict.modelBrier.toFixed(4)),
          marketBrier: Number(verdict.marketBrier.toFixed(4)),
          modelLogLoss: Number(logLoss(ds.momentumPreds, ds.outcomes).toFixed(4)),
          marketLogLoss: Number(logLoss(ds.marketPreds, ds.outcomes).toFixed(4)),
          buyHoldSharpe: Number(sharpe(rets).toFixed(4)),
          note: verdict.reason,
        });
      } catch (e) {
        results.push({ pair, error: e instanceof Error ? e.message : "fetch failed" });
      }
    }

    const anyEdge = results.some((r) => "hasEdge" in r && r.hasEdge);
    return new Response(
      JSON.stringify({
        success: true,
        interval,
        limit,
        minSkill,
        results,
        verdict: anyEdge
          ? "Some pair shows skill on this sample — investigate out-of-sample before trusting it."
          : "No edge over the market on this sample. Do NOT go live on this basis.",
        disclaimer: "A naive model + in-sample data. Positive skill here is necessary, not sufficient. Validate walk-forward, out-of-sample, after costs.",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    if (error instanceof AuthError) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.error("[edge-test] Error:", error);
    return new Response(JSON.stringify({ success: false, error: "edge-test failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
