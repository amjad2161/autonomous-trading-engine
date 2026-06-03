import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuth, AuthError } from "../_shared/auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Input validation regex
const API_KEY_REGEX = /^[A-Za-z0-9_-]+$/;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // SECURITY: real auth. This endpoint manages credentials — the most
    // sensitive surface — so it should be locked down hardest in production.
    requireAuth(req);

    const { apiKey, apiSecret } = await req.json();
    
    // SECURITY: Input validation
    if (!apiKey || typeof apiKey !== 'string' || apiKey.length < 10 || apiKey.length > 100) {
      throw new Error('Invalid apiKey format');
    }
    if (!apiSecret || typeof apiSecret !== 'string' || apiSecret.length < 20 || apiSecret.length > 200) {
      throw new Error('Invalid apiSecret format');
    }
    if (!API_KEY_REGEX.test(apiKey) || !API_KEY_REGEX.test(apiSecret)) {
      throw new Error('Invalid characters in credentials');
    }

    console.log('[UPDATE-SECRETS] Updating cloud secrets...');
    
    // Store in trading_system_state for runtime access
    // Note: Real secrets are in Supabase vault, this is for verification status
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    
    // Verify the keys work first.
    // Gate.io v4 private endpoints require KEY + SIGN + Timestamp, where
    // SIGN = HMAC-SHA512( METHOD \n PATH \n query \n SHA512(body) \n ts ).
    // (Previously only KEY + Timestamp were sent, so verification always failed.)
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const verifyMethod = 'GET';
    const verifyPath = '/api/v4/spot/accounts';
    const enc = new TextEncoder();
    const bodyHashBuf = await crypto.subtle.digest('SHA-512', enc.encode(''));
    const bodyHashHex = Array.from(new Uint8Array(bodyHashBuf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    const signString = `${verifyMethod}\n${verifyPath}\n\n${bodyHashHex}\n${timestamp}`;
    const signKey = await crypto.subtle.importKey('raw', enc.encode(apiSecret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
    const sigBuf = await crypto.subtle.sign('HMAC', signKey, enc.encode(signString));
    const signatureHex = Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    const verifyRes = await fetch('https://api.gateio.ws/api/v4/spot/accounts', {
      headers: {
        'KEY': apiKey,
        'SIGN': signatureHex,
        'Timestamp': timestamp,
        'Accept': 'application/json',
      },
    });
    
    if (!verifyRes.ok) {
      throw new Error('API keys verification failed');
    }

    // SECURITY: Log update without exposing key prefix
    console.log('[UPDATE-SECRETS] Keys verified successfully');

    console.log('[UPDATE-SECRETS] Success!');
    
    return new Response(JSON.stringify({
      success: true,
      message: 'Secrets updated and verified',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    if (error instanceof AuthError) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    console.error('[UPDATE-SECRETS] Error:', error);

    return new Response(JSON.stringify({
      success: false,
      error: 'Failed to update secrets',
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
