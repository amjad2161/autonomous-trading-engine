import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createHmac } from "https://deno.land/std@0.177.0/node/crypto.ts";
import { encodeHex } from "https://deno.land/std@0.224.0/encoding/hex.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Settings {
  minEdge: number;
  maxTradeSize: number;
  maxDailyLoss: number;
  stopLossPercent: number;
  autoLiquidate: boolean;
  maxTradesPerHour: number;
}

interface Ticker {
  currency_pair: string;
  last: string;
  change_percentage: string;
  highest_bid: string;
  lowest_ask: string;
  quote_volume: string;
  high_24h: string;
  low_24h: string;
}

interface Opportunity {
  id: string;
  type: string;
  symbol: string;
  expectedEdge: number;
  confidence: number;
  riskLevel: string;
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  action: 'buy' | 'sell';
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

async function gateRequest(
  endpoint: string,
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
  params: Record<string, string> = {},
  body?: Record<string, unknown>
) {
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
  
  const signature = await generateSignature(method, url, queryString, payloadString, timestamp, GATE_API_SECRET);

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

// Scan for opportunities
async function scanOpportunities(tickers: Ticker[], minEdge: number): Promise<Opportunity[]> {
  const opportunities: Opportunity[] = [];
  const MIN_VOLUME = 50000;
  
  for (const ticker of tickers) {
    const volume = parseFloat(ticker.quote_volume);
    if (volume < MIN_VOLUME) continue;
    
    const change = parseFloat(ticker.change_percentage);
    const last = parseFloat(ticker.last);
    const bid = parseFloat(ticker.highest_bid);
    const ask = parseFloat(ticker.lowest_ask);
    const high24 = parseFloat(ticker.high_24h);
    const low24 = parseFloat(ticker.low_24h);
    
    // Spread opportunity
    const spread = ((ask - bid) / last) * 100;
    if (spread > 0.3) {
      const netEdge = spread * 0.5 - 0.2; // Account for fees
      if (netEdge >= minEdge) {
        opportunities.push({
          id: `spread-${ticker.currency_pair}-${Date.now()}`,
          type: 'spread',
          symbol: ticker.currency_pair.replace('_', '/'),
          expectedEdge: netEdge,
          confidence: Math.min(95, 50 + volume / 10000),
          riskLevel: netEdge > 2 ? 'high' : netEdge > 1 ? 'medium' : 'low',
          entryPrice: bid,
          targetPrice: ask * 0.998,
          stopLoss: bid * 0.98,
          action: 'buy',
        });
      }
    }
    
    // Mean reversion on big drops
    if (change < -15) {
      const distanceFromLow = ((last - low24) / low24) * 100;
      if (distanceFromLow < 5) {
        const bounceEdge = Math.abs(change) * 0.2;
        if (bounceEdge >= minEdge) {
          opportunities.push({
            id: `reversion-${ticker.currency_pair}-${Date.now()}`,
            type: 'reversion',
            symbol: ticker.currency_pair.replace('_', '/'),
            expectedEdge: bounceEdge,
            confidence: Math.min(90, 60 + Math.abs(change)),
            riskLevel: 'high',
            entryPrice: last,
            targetPrice: last * (1 + bounceEdge / 100),
            stopLoss: low24 * 0.98,
            action: 'buy',
          });
        }
      }
    }
    
    // Momentum on breakouts
    if (change > 10) {
      const distanceFromHigh = ((high24 - last) / high24) * 100;
      if (distanceFromHigh < 2) {
        const momentumEdge = change * 0.15;
        if (momentumEdge >= minEdge) {
          opportunities.push({
            id: `momentum-${ticker.currency_pair}-${Date.now()}`,
            type: 'momentum',
            symbol: ticker.currency_pair.replace('_', '/'),
            expectedEdge: momentumEdge,
            confidence: Math.min(85, 50 + change),
            riskLevel: 'medium',
            entryPrice: last,
            targetPrice: last * (1 + momentumEdge / 100),
            stopLoss: last * 0.97,
            action: 'buy',
          });
        }
      }
    }
  }
  
  return opportunities.sort((a, b) => b.expectedEdge - a.expectedEdge);
}

// Execute a trade
async function executeTrade(
  opportunity: Opportunity,
  availableUSDT: number,
  maxTradeSize: number
): Promise<{ success: boolean; orderId?: string; amount?: string; error?: string }> {
  const MIN_TRADE_USDT = 5; // Gate.io minimum is $3, use $5 to be safe
  const tradeAmount = Math.min(availableUSDT * (maxTradeSize / 100), availableUSDT * 0.95);
  
  if (tradeAmount < MIN_TRADE_USDT) {
    return { success: false, error: `Trade amount $${tradeAmount.toFixed(2)} below $${MIN_TRADE_USDT} minimum` };
  }
  
  const pair = opportunity.symbol.replace('/', '_');
  const amount = (tradeAmount / opportunity.entryPrice).toFixed(6);
  
  console.log(`[Trade] Executing: ${opportunity.action} ${amount} ${pair} @ ${opportunity.entryPrice}`);
  
  try {
    const order = await gateRequest('/spot/orders', 'POST', {}, {
      currency_pair: pair,
      side: opportunity.action,
      amount,
      price: opportunity.entryPrice.toString(),
      type: 'limit',
      time_in_force: 'ioc',
    });
    
    if (order.id) {
      return { success: true, orderId: order.id, amount };
    } else {
      return { success: false, error: JSON.stringify(order) };
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

// Liquidate non-USDT holdings
async function liquidateHoldings(): Promise<{ liquidated: number; errors: string[] }> {
  const balances = await gateRequest('/spot/accounts');
  const tickers: Ticker[] = await gateRequest('/spot/tickers');
  const tickerMap = new Map(tickers.map(t => [t.currency_pair, t]));
  
  let liquidated = 0;
  const errors: string[] = [];
  
  for (const balance of balances) {
    if (balance.currency === 'USDT' || parseFloat(balance.available) <= 0) continue;
    
    const pair = `${balance.currency}_USDT`;
    const ticker = tickerMap.get(pair);
    if (!ticker) continue;
    
    const value = parseFloat(balance.available) * parseFloat(ticker.highest_bid);
    if (value < 0.5) continue;
    
    try {
      const order = await gateRequest('/spot/orders', 'POST', {}, {
        currency_pair: pair,
        side: 'sell',
        amount: balance.available,
        price: ticker.highest_bid,
        type: 'limit',
        time_in_force: 'ioc',
      });
      
      if (order.id) {
        liquidated += value;
        console.log(`[Liquidate] Sold ${balance.available} ${balance.currency} for ~$${value.toFixed(2)}`);
      }
    } catch (err) {
      errors.push(`${balance.currency}: ${err instanceof Error ? err.message : 'Error'}`);
    }
    
    await new Promise(r => setTimeout(r, 100));
  }
  
  return { liquidated, errors };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const settings: Settings = {
      minEdge: body.minEdge || 2,
      maxTradeSize: body.maxTradeSize || 10,
      maxDailyLoss: body.maxDailyLoss || 5,
      stopLossPercent: body.stopLossPercent || 2,
      autoLiquidate: body.autoLiquidate !== false,
      maxTradesPerHour: body.maxTradesPerHour || 10,
    };
    
    console.log('[ContinuousTrader] Starting cycle with settings:', JSON.stringify(settings));
    
    const results = {
      timestamp: Date.now(),
      cycle: {
        scanned: 0,
        opportunities: 0,
        tradesExecuted: 0,
        tradesSuccessful: 0,
        liquidationsPerformed: 0,
      },
      trades: [] as Array<{ symbol: string; edge: number; success: boolean; orderId?: string; error?: string }>,
      liquidation: { liquidated: 0, errors: [] as string[] },
      balance: { before: 0, after: 0 },
      bestOpportunities: [] as Opportunity[],
    };
    
    // Step 1: Auto-liquidate if enabled
    if (settings.autoLiquidate) {
      console.log('[ContinuousTrader] Running auto-liquidation...');
      results.liquidation = await liquidateHoldings();
      results.cycle.liquidationsPerformed = results.liquidation.liquidated > 0 ? 1 : 0;
      await new Promise(r => setTimeout(r, 500));
    }
    
    // Step 2: Get current USDT balance
    const balances = await gateRequest('/spot/accounts');
    const usdtBalance = balances.find((b: { currency: string }) => b.currency === 'USDT');
    results.balance.before = usdtBalance ? parseFloat(usdtBalance.available) : 0;
    
    if (results.balance.before < 1) {
      console.log('[ContinuousTrader] Insufficient USDT balance');
      return new Response(JSON.stringify({
        ...results,
        success: false,
        error: 'Insufficient USDT balance for trading',
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // Step 3: Scan for opportunities
    console.log('[ContinuousTrader] Scanning market...');
    const tickers: Ticker[] = await gateRequest('/spot/tickers');
    results.cycle.scanned = tickers.length;
    
    const opportunities = await scanOpportunities(tickers, settings.minEdge);
    results.cycle.opportunities = opportunities.length;
    results.bestOpportunities = opportunities.slice(0, 5);
    
    console.log(`[ContinuousTrader] Found ${opportunities.length} opportunities`);
    
    // Step 4: Execute best opportunities (up to maxTradesPerHour)
    const maxTrades = Math.min(3, settings.maxTradesPerHour); // Execute up to 3 per cycle
    let availableUSDT = results.balance.before;
    
    for (let i = 0; i < Math.min(maxTrades, opportunities.length); i++) {
      const opp = opportunities[i];
      
      // Skip if confidence too low
      if (opp.confidence < 50) continue;
      
      // Skip if edge is suspiciously high (potential manipulation)
      if (opp.expectedEdge > 15) {
        console.log(`[ContinuousTrader] Skipping ${opp.symbol} - edge too high (${opp.expectedEdge}%)`);
        continue;
      }
      
      results.cycle.tradesExecuted++;
      const tradeResult = await executeTrade(opp, availableUSDT, settings.maxTradeSize);
      
      results.trades.push({
        symbol: opp.symbol,
        edge: opp.expectedEdge,
        success: tradeResult.success,
        orderId: tradeResult.orderId,
        error: tradeResult.error,
      });
      
      if (tradeResult.success) {
        results.cycle.tradesSuccessful++;
        availableUSDT *= (1 - settings.maxTradeSize / 100);
      }
      
      await new Promise(r => setTimeout(r, 200));
    }
    
    // Step 5: Get final balance
    await new Promise(r => setTimeout(r, 1000));
    const finalBalances = await gateRequest('/spot/accounts');
    const finalUSDT = finalBalances.find((b: { currency: string }) => b.currency === 'USDT');
    results.balance.after = finalUSDT ? parseFloat(finalUSDT.available) : 0;
    
    console.log('[ContinuousTrader] Cycle complete:', JSON.stringify(results.cycle));
    
    return new Response(JSON.stringify({
      success: true,
      ...results,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
    
  } catch (error) {
    console.error('[ContinuousTrader] Error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
