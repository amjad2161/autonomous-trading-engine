import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createHmac } from "https://deno.land/std@0.177.0/node/crypto.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GateCredentials {
  apiKey: string;
  apiSecret: string;
}

interface GateRequest {
  endpoint: string;
  method?: 'GET' | 'POST' | 'DELETE';
  params?: Record<string, string>;
  body?: Record<string, unknown>;
  credentials?: GateCredentials;
}

function generateSignature(
  method: string,
  url: string,
  queryString: string,
  payloadString: string,
  timestamp: string,
  secret: string
): string {
  const hashedPayload = createHmac('sha512', '')
    .update(payloadString)
    .digest('hex');
  
  const signatureString = `${method}\n${url}\n${queryString}\n${hashedPayload}\n${timestamp}`;
  
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
    const { endpoint, method = 'GET', params = {}, body, credentials } = await req.json() as GateRequest;
    
    // Get API credentials - prefer from request, fall back to env vars
    const GATE_API_KEY = credentials?.apiKey || Deno.env.get('GATE_API_KEY');
    const GATE_API_SECRET = credentials?.apiSecret || Deno.env.get('GATE_API_SECRET');

    if (!GATE_API_KEY) {
      throw new Error('API Key is required. Please provide your Gate.io API Key.');
    }
    if (!GATE_API_SECRET) {
      throw new Error('API Secret is required. Please provide your Gate.io API Secret.');
    }

    if (!endpoint) {
      throw new Error('Endpoint is required');
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
    const signature = generateSignature(
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
    console.error('[Gate API] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return new Response(JSON.stringify({ 
      success: false, 
      error: errorMessage 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
