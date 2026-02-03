import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createHmac } from "https://deno.land/std@0.177.0/node/crypto.ts";
import { encodeHex } from "https://deno.land/std@0.224.0/encoding/hex.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GateCredentials {
  apiKey: string;
  apiSecret: string;
}

interface ExecuteRequest {
  credentials: GateCredentials;
  opportunityType: 'spread' | 'arbitrage';
  symbol: string;
  side: 'buy' | 'sell';
  amount: string;
  price?: string;
  route?: string[]; // For arbitrage: ['USDT', 'BTC', 'ETH', 'USDT']
  
  // Risk parameters
  maxTradeSize: number; // Max USDT per trade
  minEdge: number; // Minimum edge percentage
  expectedEdge: number;
}

interface TradeResult {
  success: boolean;
  orderId?: string;
  executedAmount?: string;
  executedPrice?: string;
  error?: string;
  timestamp: number;
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
  const hashedPayload = await sha512Hash(payloadString);
  const signatureString = `${method}\n${url}\n${queryString}\n${hashedPayload}\n${timestamp}`;
  return createHmac('sha512', secret).update(signatureString).digest('hex');
}

async function placeOrder(
  credentials: GateCredentials,
  pair: string,
  side: 'buy' | 'sell',
  amount: string,
  price: string
): Promise<TradeResult> {
  const baseUrl = 'https://api.gateio.ws';
  const endpoint = '/api/v4/spot/orders';
  
  const body = {
    currency_pair: pair,
    side,
    amount,
    price,
    type: 'limit',
    time_in_force: 'ioc', // Immediate-or-Cancel for quick execution
  };
  
  const payloadString = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = await generateSignature('POST', endpoint, '', payloadString, timestamp, credentials.apiSecret);

  const headers = {
    'KEY': credentials.apiKey,
    'SIGN': signature,
    'Timestamp': timestamp,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  console.log(`[Trade Executor] Placing ${side} order: ${amount} ${pair} @ ${price}`);

  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers,
    body: payloadString,
  });

  const data = await response.json();

  if (!response.ok) {
    console.error(`[Trade Executor] Order failed:`, data);
    return {
      success: false,
      error: data.message || 'Order placement failed',
      timestamp: Date.now(),
    };
  }

  console.log(`[Trade Executor] Order placed:`, data);
  
  return {
    success: true,
    orderId: data.id,
    executedAmount: data.amount,
    executedPrice: data.price,
    timestamp: Date.now(),
  };
}

async function getTicker(pair: string): Promise<{ bid: number; ask: number; last: number } | null> {
  const response = await fetch(`https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${pair}`);
  const data = await response.json();
  
  if (!data || data.length === 0) return null;
  
  return {
    bid: parseFloat(data[0].highest_bid),
    ask: parseFloat(data[0].lowest_ask),
    last: parseFloat(data[0].last),
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const request: ExecuteRequest = await req.json();
    const { 
      credentials, 
      opportunityType, 
      symbol, 
      side, 
      amount,
      maxTradeSize,
      minEdge,
      expectedEdge,
      route,
    } = request;

    // ============ HARD GUARDRAILS ============
    
    // 1. Validate credentials
    if (!credentials?.apiKey || !credentials?.apiSecret) {
      throw new Error('Missing API credentials');
    }

    // 2. Check minimum edge threshold
    if (expectedEdge < minEdge) {
      throw new Error(`Edge ${expectedEdge}% below minimum threshold ${minEdge}%`);
    }

    // 3. Validate trade size
    const tradeAmount = parseFloat(amount);
    if (tradeAmount > maxTradeSize) {
      throw new Error(`Trade size $${tradeAmount} exceeds max allowed $${maxTradeSize}`);
    }

    // 4. Sanity check on edge (prevent executing obviously wrong opportunities)
    if (expectedEdge > 5) {
      throw new Error(`Edge ${expectedEdge}% suspiciously high - possible stale data`);
    }

    console.log(`[Trade Executor] Executing ${opportunityType} opportunity: ${symbol}`);

    // ============ EXECUTE BASED ON TYPE ============

    if (opportunityType === 'spread') {
      // Spread/Market Making execution
      const pair = symbol.replace('/', '_');
      const ticker = await getTicker(pair);
      
      if (!ticker) {
        throw new Error(`Could not fetch ticker for ${pair}`);
      }

      // Verify spread still exists
      const currentSpread = ((ticker.ask - ticker.bid) / ticker.last) * 100;
      if (currentSpread < minEdge + 0.2) { // 0.2% buffer for fees
        throw new Error(`Spread collapsed: ${currentSpread.toFixed(3)}% < required ${(minEdge + 0.2).toFixed(3)}%`);
      }

      // Execute: Place limit order at mid-price
      const midPrice = ((ticker.bid + ticker.ask) / 2).toFixed(8);
      const result = await placeOrder(credentials, pair, side, amount, midPrice);

      return new Response(JSON.stringify({
        type: 'spread',
        success: result.success,
        orderId: result.orderId,
        executedAmount: result.executedAmount,
        executedPrice: result.executedPrice,
        error: result.error,
        timestamp: result.timestamp,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } else if (opportunityType === 'arbitrage' && route && route.length >= 4) {
      // Triangular arbitrage execution
      // This is more complex - execute all legs quickly
      
      const results: TradeResult[] = [];
      let currentAmount = tradeAmount;

      // Verify arbitrage still profitable before execution
      // (In production, you'd re-verify prices for all legs)
      
      // For safety in demo, we just log and don't actually execute arbitrage
      // Real implementation would need atomic execution or careful leg management
      console.log(`[Trade Executor] Arbitrage route: ${route.join(' → ')}`);
      console.log(`[Trade Executor] WARNING: Arbitrage execution requires careful implementation`);
      
      return new Response(JSON.stringify({
        success: false,
        type: 'arbitrage',
        error: 'Arbitrage auto-execution disabled for safety - use manual execution',
        route,
        timestamp: Date.now(),
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } else {
      throw new Error(`Unknown opportunity type: ${opportunityType}`);
    }

  } catch (error) {
    console.error('[Trade Executor] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return new Response(JSON.stringify({ 
      success: false, 
      error: errorMessage,
      timestamp: Date.now(),
    }), {
      status: 200, // Return 200 so client can handle gracefully
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
