import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { gateSign } from "../_shared/gate-sign.ts";
import { requireAuth, AuthError } from "../_shared/auth.ts";
import { guardSpotOrder } from "../_shared/safety.ts";
import { getGateCredentials } from "../_shared/credentials.ts";

function dbClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const srk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return url && srk ? createClient(url, srk) : undefined;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GateRequest {
  endpoint: string;
  method?: 'GET' | 'POST' | 'DELETE';
  params?: Record<string, string>;
  body?: Record<string, unknown>;
}

// SECURITY: Whitelist of allowed endpoints
const ALLOWED_ENDPOINTS = [
  '/spot/accounts',
  '/spot/tickers',
  '/spot/orders',
  '/spot/order_book',
  '/spot/currency_pairs',
  '/wallet/total_balance',
];

function isAllowedEndpoint(endpoint: string): boolean {
  return ALLOWED_ENDPOINTS.some(allowed => endpoint.startsWith(allowed));
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // SECURITY: real auth (shared secret when configured) instead of presence-only
    requireAuth(req);

    const { endpoint, method = 'GET', params = {}, body } = await req.json() as GateRequest;

    // SECURITY: Validate endpoint
    if (!endpoint || typeof endpoint !== 'string') {
      throw new Error('Invalid endpoint');
    }

    // SECURITY: Check against whitelist
    if (!isAllowedEndpoint(endpoint)) {
      throw new Error('Endpoint not allowed');
    }

    // SAFETY GATE: honour DRY_RUN / kill switch / risk caps for live order POSTs
    // routed through the proxy (e.g. from the dashboard).
    if (method === 'POST' && endpoint.includes('/spot/orders') && body) {
      const sim = guardSpotOrder('gate-api', body as Record<string, unknown>);
      if (sim) {
        return new Response(JSON.stringify(sim), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // SECURITY: Only use server-side credentials
    // Resolve credentials: env vars first, else the encrypted DB row saved from
    // the dashboard Settings form.
    const { apiKey: GATE_API_KEY, apiSecret: GATE_API_SECRET } = await getGateCredentials(dbClient());

    const baseUrl = 'https://api.gateio.ws';
    const apiPrefix = '/api/v4';
    const url = `${apiPrefix}${endpoint}`;
    
    // Build query string
    const queryString = new URLSearchParams(params).toString();
    const fullUrl = queryString ? `${baseUrl}${url}?${queryString}` : `${baseUrl}${url}`;
    
    // Prepare payload
    const payloadString = body ? JSON.stringify(body) : '';
    
    // Generate timestamp and signature
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = await gateSign(
      method,
      url,
      queryString,
      payloadString,
      timestamp,
      GATE_API_SECRET
    );

    // Build headers
    const headers: Record<string, string> = {
      'KEY': GATE_API_KEY,
      'SIGN': signature,
      'Timestamp': timestamp,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    console.log(`[Gate API] ${method} ${endpoint}`);

    // Make request to Gate.io
    const response = await fetch(fullUrl, {
      method,
      headers,
      body: payloadString || undefined,
    });

    const data = await response.json();

    if (!response.ok) {
      console.error(`[Gate API] Error: ${response.status}`, data);
      throw new Error(`Gate.io API error [${response.status}]: ${JSON.stringify(data)}`);
    }

    console.log(`[Gate API] Success: ${endpoint}`);

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    if (error instanceof AuthError) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    console.error('[Gate API] Error:', error);
    // SECURITY: Return fully generic error message - log details server-side only
    return new Response(JSON.stringify({
      success: false,
      error: 'API request failed'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
