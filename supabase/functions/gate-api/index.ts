import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createHmac } from "https://deno.land/std@0.177.0/node/crypto.ts";
import { encodeHex } from "https://deno.land/std@0.224.0/encoding/hex.ts";
import { requireAuth, AuthError } from "../_shared/auth.ts";

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

async function sha512Hash(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-512', msgBuffer);
  return encodeHex(new Uint8Array(hashBuffer));
}

async function generateSignature(
  method: string,
  url: string,
  queryString: string,
  payloadString: string,
  timestamp: string,
  secret: string
): Promise<string> {
  // Gate.io requires SHA-512 hash of the payload (not HMAC)
  const hashedPayload = await sha512Hash(payloadString);
  
  // Build signature string according to Gate.io v4 spec
  const signatureString = `${method}\n${url}\n${queryString}\n${hashedPayload}\n${timestamp}`;
  
  // Sign with HMAC-SHA512 using the secret
  return createHmac('sha512', secret)
    .update(signatureString)
    .digest('hex');
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

    // SECURITY: Only use server-side credentials
    const GATE_API_KEY = Deno.env.get('GATE_API_KEY');
    const GATE_API_SECRET = Deno.env.get('GATE_API_SECRET');

    if (!GATE_API_KEY) {
      throw new Error('Server API Key not configured');
    }
    if (!GATE_API_SECRET) {
      throw new Error('Server API Secret not configured');
    }

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
    const signature = await generateSignature(
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
