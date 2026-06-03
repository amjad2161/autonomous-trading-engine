import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { gateSign } from "../_shared/gate-sign.ts";
import { guardSpotOrder } from "../_shared/safety.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Balance {
  currency: string;
  available: string;
  locked: string;
}

interface Ticker {
  currency_pair: string;
  last: string;
  highest_bid: string;
  lowest_ask: string;
}

async function gateRequest(
  endpoint: string,
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
  params: Record<string, string> = {},
  body?: Record<string, unknown>
) {
  // SAFETY GATE: honour DRY_RUN / kill switch / risk caps for live order POSTs.
  if (method === 'POST' && endpoint.includes('/spot/orders') && body) {
    const __sim = guardSpotOrder('auto-liquidate', body as Record<string, unknown>);
    if (__sim) return __sim;
  }
  const GATE_API_KEY = Deno.env.get('GATE_API_KEY');
  const GATE_API_SECRET = Deno.env.get('GATE_API_SECRET');
  
  if (!GATE_API_KEY || !GATE_API_SECRET) {
    throw new Error('Gate.io API credentials not configured');
  }

  const baseUrl = 'https://api.gateio.ws';
  const apiPrefix = '/api/v4';
  const url = `${apiPrefix}${endpoint}`;
  const queryString = new URLSearchParams(params).toString();
  const fullUrl = queryString ? `${baseUrl}${url}?${queryString}` : `${baseUrl}${url}`;
  const payloadString = body ? JSON.stringify(body) : '';
  const timestamp = Math.floor(Date.now() / 1000).toString();
  
  const signature = await gateSign(method, url, queryString, payloadString, timestamp, GATE_API_SECRET);

  const response = await fetch(fullUrl, {
    method,
    headers: {
      'KEY': GATE_API_KEY,
      'SIGN': signature,
      'Timestamp': timestamp,
      'Content-Type': 'application/json',
    },
    body: payloadString || undefined,
  });

  return response.json();
}

// Currencies to keep (not liquidate)
const KEEP_CURRENCIES = ['USDT', 'USD'];
const MIN_VALUE_TO_LIQUIDATE = 0.5; // Minimum $0.50 to be worth liquidating

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('[Auto-Liquidate] Starting liquidation scan...');
    
    // Get all balances
    const balances: Balance[] = await gateRequest('/spot/accounts');
    
    // Get all tickers for price lookup
    const tickers: Ticker[] = await gateRequest('/spot/tickers');
    const tickerMap = new Map(tickers.map(t => [t.currency_pair, t]));
    
    const liquidations: Array<{
      currency: string;
      amount: string;
      pair: string;
      estimatedUSDT: number;
      status: 'success' | 'failed' | 'skipped';
      orderId?: string;
      error?: string;
    }> = [];
    
    let totalLiquidatedUSDT = 0;
    
    for (const balance of balances) {
      const available = parseFloat(balance.available);
      if (available <= 0 || KEEP_CURRENCIES.includes(balance.currency)) {
        continue;
      }
      
      // Try to find a trading pair for this currency
      const usdtPair = `${balance.currency}_USDT`;
      const ticker = tickerMap.get(usdtPair);
      
      if (!ticker) {
        console.log(`[Auto-Liquidate] No USDT pair found for ${balance.currency}`);
        liquidations.push({
          currency: balance.currency,
          amount: balance.available,
          pair: usdtPair,
          estimatedUSDT: 0,
          status: 'skipped',
          error: 'No trading pair available',
        });
        continue;
      }
      
      const price = parseFloat(ticker.highest_bid);
      const estimatedValue = available * price;
      
      if (estimatedValue < MIN_VALUE_TO_LIQUIDATE) {
        console.log(`[Auto-Liquidate] ${balance.currency} value ($${estimatedValue.toFixed(2)}) below minimum`);
        liquidations.push({
          currency: balance.currency,
          amount: balance.available,
          pair: usdtPair,
          estimatedUSDT: estimatedValue,
          status: 'skipped',
          error: `Value $${estimatedValue.toFixed(2)} below $${MIN_VALUE_TO_LIQUIDATE} minimum`,
        });
        continue;
      }
      
      console.log(`[Auto-Liquidate] Selling ${available} ${balance.currency} @ ${price} = ~$${estimatedValue.toFixed(2)}`);
      
      try {
        // Place market sell order using IOC (Immediate or Cancel)
        const order = await gateRequest('/spot/orders', 'POST', {}, {
          currency_pair: usdtPair,
          side: 'sell',
          amount: balance.available,
          price: ticker.highest_bid, // Use bid price for immediate fill
          type: 'limit',
          time_in_force: 'ioc', // Immediate or Cancel - fills what it can
        });
        
        if (order.id) {
          console.log(`[Auto-Liquidate] Order placed: ${order.id}`);
          totalLiquidatedUSDT += estimatedValue;
          liquidations.push({
            currency: balance.currency,
            amount: balance.available,
            pair: usdtPair,
            estimatedUSDT: estimatedValue,
            status: 'success',
            orderId: order.id,
          });
        } else {
          throw new Error(JSON.stringify(order));
        }
      } catch (err) {
        console.error(`[Auto-Liquidate] Failed to sell ${balance.currency}:`, err);
        liquidations.push({
          currency: balance.currency,
          amount: balance.available,
          pair: usdtPair,
          estimatedUSDT: estimatedValue,
          status: 'failed',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
      
      // Rate limiting
      await new Promise(r => setTimeout(r, 200));
    }
    
    // Get final USDT balance
    const finalBalances: Balance[] = await gateRequest('/spot/accounts');
    const usdtBalance = finalBalances.find(b => b.currency === 'USDT');
    
    const result = {
      success: true,
      timestamp: Date.now(),
      liquidations,
      totalLiquidatedUSDT,
      finalUSDTBalance: usdtBalance ? parseFloat(usdtBalance.available) : 0,
      summary: {
        processed: liquidations.length,
        successful: liquidations.filter(l => l.status === 'success').length,
        failed: liquidations.filter(l => l.status === 'failed').length,
        skipped: liquidations.filter(l => l.status === 'skipped').length,
      },
    };
    
    console.log('[Auto-Liquidate] Complete:', JSON.stringify(result.summary));
    
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
    
  } catch (error) {
    console.error('[Auto-Liquidate] Error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
