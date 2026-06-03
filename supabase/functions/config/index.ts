import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuth, AuthError } from "../_shared/auth.ts";
import { resolveConfig, type ProfileName } from "../_shared/profiles.ts";

// =============================================================================
// config  —  read/write the active trading MODE + control flags (command & control)
// =============================================================================
// Stores the user's selection in trading_system_state.settings so it can be
// changed at RUNTIME from the dashboard without redeploying. The orchestrator
// reads it each cycle. NOTE: this controls AGGRESSION, never SAFETY — the hard
// floor (caps, kill switch, DRY_RUN, validation) stays in server env only.
// =============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-function-secret",
};

const VALID_PROFILES: ProfileName[] = ["CONSERVATIVE", "BALANCED", "AGGRESSIVE", "CUSTOM", "AUTO"];

// Only these custom keys are accepted from the client (everything else ignored).
const CUSTOM_KEYS = [
  "riskPerTradePct",
  "maxTradeUsdt",
  "maxOpenPositions",
  "maxTradesPerHour",
  "minEdgePct",
  "takeProfitPct",
  "stopLossPct",
  "slippageTolerancePct",
  "cooldownSec",
];

function sanitizeCustom(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (raw && typeof raw === "object") {
    for (const k of CUSTOM_KEYS) {
      const v = (raw as Record<string, unknown>)[k];
      const n = Number(v);
      if (Number.isFinite(n)) out[k] = n;
    }
  }
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    requireAuth(req);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const command = String(body.command ?? "get");

    const { data: row } = await supabase
      .from("trading_system_state")
      .select("*")
      .limit(1)
      .single();

    const currentSettings: Record<string, unknown> = (row?.settings as Record<string, unknown>) ?? {};

    if (command === "ws_heartbeat") {
      // Liveness ping from the local WS telemetry service -> feeds INV-01 (wsStale).
      const next = { ...currentSettings, lastWsTickMs: Date.now() };
      if (row?.id) {
        await supabase
          .from("trading_system_state")
          .update({ settings: next })
          .eq("id", row.id);
      }
      return new Response(JSON.stringify({ success: true, lastWsTickMs: next.lastWsTickMs }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (command === "set") {
      const next: Record<string, unknown> = { ...currentSettings };

      if (body.profile !== undefined) {
        const p = String(body.profile).toUpperCase() as ProfileName;
        if (!VALID_PROFILES.includes(p)) throw new Error("Invalid profile");
        next.profile = p;
      }
      if (body.autopilot !== undefined) next.autopilot = Boolean(body.autopilot);
      if (body.adaptive !== undefined) next.adaptive = Boolean(body.adaptive);
      if (body.custom !== undefined) next.custom = sanitizeCustom(body.custom);

      if (row?.id) {
        await supabase
          .from("trading_system_state")
          .update({ settings: next, updated_at: new Date().toISOString() })
          .eq("id", row.id);
      }

      return new Response(
        JSON.stringify({ success: true, settings: next, resolved: resolveConfig(next) }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // command === 'get'
    return new Response(
      JSON.stringify({
        success: true,
        settings: {
          profile: currentSettings.profile ?? "BALANCED",
          autopilot: currentSettings.autopilot ?? false,
          adaptive: currentSettings.adaptive ?? false,
          custom: currentSettings.custom ?? {},
        },
        resolved: resolveConfig(currentSettings),
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
    console.error("[config] Error:", error);
    return new Response(JSON.stringify({ success: false, error: "Config request failed" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
