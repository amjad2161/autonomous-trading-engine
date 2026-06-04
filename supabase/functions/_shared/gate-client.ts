// =============================================================================
// GATE.IO SIGNED FETCH — one canonical request helper.
// =============================================================================
// The standard `gateRequest(endpoint, method, params, body)` wrapper was
// byte-identical across several edge functions (only the safety-gate function
// name differed). This is that body, parameterized by `fnName`. It runs the
// DRY_RUN/kill/caps safety gate for order POSTs, signs via the canonical signer,
// and returns the parsed JSON. Functions adopt it with a one-line wrapper.
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { gateSign } from "./gate-sign.ts";
import { guardSpotOrder } from "./safety.ts";
import { getGateCredentials } from "./credentials.ts";

function dbClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const srk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return url && srk ? createClient(url, srk) : undefined;
}

// deno-lint-ignore no-explicit-any
export async function gateFetch(
  fnName: string,
  endpoint: string,
  method: "GET" | "POST" | "DELETE" = "GET",
  params: Record<string, string> = {},
  body?: Record<string, unknown>,
): Promise<any> {
  // SAFETY GATE: honour DRY_RUN / kill switch / risk caps for live order POSTs.
  if (method === "POST" && endpoint.includes("/spot/orders") && body) {
    const sim = guardSpotOrder(fnName, body);
    if (sim) return sim;
  }

  // Credentials: env vars first, else the encrypted DB row saved from the UI.
  const { apiKey: GATE_API_KEY, apiSecret: GATE_API_SECRET } = await getGateCredentials(dbClient());

  const baseUrl = "https://api.gateio.ws";
  const url = `/api/v4${endpoint}`;
  const queryString = new URLSearchParams(params).toString();
  const fullUrl = queryString ? `${baseUrl}${url}?${queryString}` : `${baseUrl}${url}`;
  const payloadString = body ? JSON.stringify(body) : "";
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const signature = await gateSign(method, url, queryString, payloadString, timestamp, GATE_API_SECRET);

  const response = await fetch(fullUrl, {
    method,
    headers: {
      "KEY": GATE_API_KEY,
      "SIGN": signature,
      "Timestamp": timestamp,
      "Content-Type": "application/json",
    },
    body: payloadString || undefined,
  });

  // Surface HTTP errors as exceptions (callers wrap in try/catch) instead of
  // returning Gate.io's error body as if it were a successful result — otherwise
  // a credential/API failure looks like data and can be acted on.
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Gate.io ${response.status}: ${text.slice(0, 200)}`);
  }
  return response.json();
}
