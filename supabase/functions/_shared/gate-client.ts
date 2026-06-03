// =============================================================================
// GATE.IO SIGNED FETCH — one canonical request helper.
// =============================================================================
// The standard `gateRequest(endpoint, method, params, body)` wrapper was
// byte-identical across several edge functions (only the safety-gate function
// name differed). This is that body, parameterized by `fnName`. It runs the
// DRY_RUN/kill/caps safety gate for order POSTs, signs via the canonical signer,
// and returns the parsed JSON. Functions adopt it with a one-line wrapper.
// =============================================================================

import { gateSign } from "./gate-sign.ts";
import { guardSpotOrder } from "./safety.ts";

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

  const GATE_API_KEY = Deno.env.get("GATE_API_KEY");
  const GATE_API_SECRET = Deno.env.get("GATE_API_SECRET");
  if (!GATE_API_KEY || !GATE_API_SECRET) {
    throw new Error("Gate.io API credentials not configured");
  }

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

  return response.json();
}
