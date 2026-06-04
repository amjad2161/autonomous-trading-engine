import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { guardSpotOrder } from "../_shared/safety.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GATE_API_KEY = Deno.env.get('GATE_API_KEY')!;
const GATE_API_SECRET = Deno.env.get('GATE_API_SECRET')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

// MICRO-SCALPING CONFIGURATION
const CONFIG = {
  // Profit targets - VERY SMALL but FAST
  takeProfitPercent: 0.15,      // 0.15% profit target ($0.07 on $50 trade)
  stopLossPercent: 0.25,        // 0.25% stop loss
  trailingActivation: 0.10,     // Activate trailing at 0.1%
  trailingDistance: 0.05,       // 0.05% trailing distance
  
  // Position sizing - dynamic based on balance
  minTradeSize: 5,              // Minimum $5
  maxTradePercent: 15,          // Use up to 15% of balance per trade
  maxConcurrentTrades: 8,       // Allow more concurrent positions
  
  // Speed settings
  minHoldTimeMs: 3000,          // Minimum 3 seconds hold
  maxHoldTimeMs: 120000,        // Maximum 2 minutes hold (force exit)
  scanIntervalMs: 500,          // Scan every 500ms
  
  // Entry thresholds - VERY SENSITIVE
  minSpreadPercent: 0.08,       // Enter on 0.08% spread opportunity
  momentumThreshold: 0.05,      // 0.05% momentum is enough
  volumeMultiplier: 1.2,        // 20% above average volume
  
  // Quick flip detection
  priceVelocityThreshold: 0.02, // 0.02% per second = good momentum
  bidAskImbalance: 1.1,         // 10% imbalance triggers entry
};

interface Position {
  symbol: string;
  entryPrice: number;
  amount: number;
  entryTime: number;
  highestPrice: number;
  trailingActive: boolean;
  side: 'long' | 'short';
}

// In-memory position tracking for speed
const activePositions: Map<string, Position> = new Map();
const recentPrices: Map<string, number[]> = new Map();
const lastTrades: Map<string, number> = new Map();

async function gateRequest(method: string, endpoint: string, body?: unknown) {
  // SAFETY GATE: honour DRY_RUN / kill switch / risk caps for live order POSTs.
  if (method === 'POST' && endpoint.includes('/spot/orders') && body) {
    const __sim = guardSpotOrder('micro-scalper', body as Record<string, unknown>);
    if (__sim) return __sim;
  }
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const bodyStr = body ? JSON.stringify(body) : '';
  const queryString = '';
  
  const encoder = new TextEncoder();
  const bodyHash = await crypto.subtle.digest('SHA-512', encoder.encode(bodyStr));
  const bodyHashHex = Array.from(new Uint8Array(bodyHash)).map(b => b.toString(16).padStart(2, '0')).join('');
  
  const signString = `${method}\n/api/v4${endpoint}\n${queryString}\n${bodyHashHex}\n${timestamp}`;
  const key = await crypto.subtle.importKey('raw', encoder.encode(GATE_API_SECRET), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(signString));
  const signatureHex = Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');

  const response = await fetch(`https://api.gateio.ws/api/v4${endpoint}`, {
    method,
    headers: {
      'KEY': GATE_API_KEY,
      'SIGN': signatureHex,
      'Timestamp': timestamp,
      'Content-Type': 'application/json',
    },
    body: body ? bodyStr : undefined,
  });

  return response.json();
}

async function getTopVolatilePairs(): Promise<string[]> {
  try {
    const tickers = await gateRequest('GET', '/spot/tickers');
    if (!Array.isArray(tickers)) return ['BTC_USDT', 'ETH_USDT'];
    
    // Filter USDT pairs with good volume and volatility
    const validPairs = tickers
      .filter((t: any) => 
        t.currency_pair?.endsWith('_USDT') &&
        parseFloat(t.quote_volume || '0') > 50000 && // Min $50k daily volume
        parseFloat(t.high_24h || '0') > 0 &&
        parseFloat(t.low_24h || '0') > 0
      )
      .map((t: any) => {
        const high = parseFloat(t.high_24h);
        const low = parseFloat(t.low_24h);
        const volatility = ((high - low) / low) * 100;
        const spread = Math.abs(parseFloat(t.highest_bid || '0') - parseFloat(t.lowest_ask || '0')) / parseFloat(t.last || '1') * 100;
        return {
          pair: t.currency_pair,
          volatility,
          spread,
          volume: parseFloat(t.quote_volume),
          price: parseFloat(t.last),
          bid: parseFloat(t.highest_bid || '0'),
          ask: parseFloat(t.lowest_ask || '0'),
        };
      })
      .filter((p: any) => p.volatility > 2 && p.spread < 0.5) // Good volatility, reasonable spread
      .sort((a: any, b: any) => b.volatility - a.volatility)
      .slice(0, 20);
    
    return validPairs.map((p: any) => p.pair);
  } catch (e) {
    console.error('Error getting pairs:', e);
    return ['BTC_USDT', 'ETH_USDT', 'SOL_USDT', 'DOGE_USDT'];
  }
}

async function getBalance(): Promise<number> {
  try {
    const accounts = await gateRequest('GET', '/spot/accounts');
    if (!Array.isArray(accounts)) return 0;
    const usdt = accounts.find((a: any) => a.currency === 'USDT');
    return parseFloat(usdt?.available || '0');
  } catch (e) {
    return 0;
  }
}

function calculatePriceVelocity(symbol: string, currentPrice: number): number {
  const prices = recentPrices.get(symbol) || [];
  prices.push(currentPrice);
  
  // Keep last 10 prices
  if (prices.length > 10) prices.shift();
  recentPrices.set(symbol, prices);
  
  if (prices.length < 3) return 0;
  
  // Calculate velocity (price change per interval)
  const oldPrice = prices[0];
  const velocity = ((currentPrice - oldPrice) / oldPrice) * 100;
  return velocity;
}

function shouldEnterTrade(
  symbol: string,
  bid: number,
  ask: number,
  velocity: number,
  volume24h: number
): { enter: boolean; side: 'long' | 'short'; reason: string } {
  // Check cooldown
  const lastTrade = lastTrades.get(symbol) || 0;
  if (Date.now() - lastTrade < 5000) {
    return { enter: false, side: 'long', reason: 'cooldown' };
  }
  
  // Already have position
  if (activePositions.has(symbol)) {
    return { enter: false, side: 'long', reason: 'already_in' };
  }
  
  const spread = ((ask - bid) / bid) * 100;
  const midPrice = (bid + ask) / 2;
  
  // MICRO-SCALP ENTRY CONDITIONS
  
  // 1. Momentum Scalp - Strong velocity with tight spread
  if (velocity > CONFIG.momentumThreshold && spread < 0.15) {
    return { enter: true, side: 'long', reason: 'momentum_up' };
  }
  
  // 2. Negative momentum = short opportunity (if supported)
  if (velocity < -CONFIG.momentumThreshold && spread < 0.15) {
    return { enter: true, side: 'long', reason: 'momentum_reversal' }; // Buy the dip
  }
  
  // 3. Spread capture - Very tight spread, easy flip
  if (spread < CONFIG.minSpreadPercent && Math.abs(velocity) > 0.01) {
    return { enter: true, side: 'long', reason: 'spread_capture' };
  }
  
  // 4. Bid pressure - More buyers
  const imbalance = bid / ask;
  if (imbalance > CONFIG.bidAskImbalance && velocity >= 0) {
    return { enter: true, side: 'long', reason: 'bid_pressure' };
  }
  
  return { enter: false, side: 'long', reason: 'no_signal' };
}

function shouldExitTrade(position: Position, currentPrice: number): { exit: boolean; reason: string } {
  const pnlPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
  const holdTime = Date.now() - position.entryTime;
  
  // Update highest price
  if (currentPrice > position.highestPrice) {
    position.highestPrice = currentPrice;
  }
  
  // 1. STOP LOSS - Immediate exit
  if (pnlPercent <= -CONFIG.stopLossPercent) {
    return { exit: true, reason: 'stop_loss' };
  }
  
  // 2. MAX HOLD TIME - Force exit
  if (holdTime >= CONFIG.maxHoldTimeMs) {
    return { exit: true, reason: 'max_hold_time' };
  }
  
  // 3. TAKE PROFIT - Target reached
  if (pnlPercent >= CONFIG.takeProfitPercent) {
    return { exit: true, reason: 'take_profit' };
  }
  
  // 4. TRAILING STOP
  if (pnlPercent >= CONFIG.trailingActivation) {
    position.trailingActive = true;
  }
  
  if (position.trailingActive) {
    const dropFromHigh = ((position.highestPrice - currentPrice) / position.highestPrice) * 100;
    if (dropFromHigh >= CONFIG.trailingDistance && pnlPercent > 0) {
      return { exit: true, reason: 'trailing_stop' };
    }
  }
  
  // 5. Quick profit - If we're up even 0.1% after 10 seconds, take it
  if (holdTime > 10000 && pnlPercent > 0.08) {
    return { exit: true, reason: 'quick_profit' };
  }
  
  return { exit: false, reason: 'hold' };
}

async function executeTrade(
  supabase: any,
  symbol: string,
  side: 'buy' | 'sell',
  amount: number,
  price: number,
  reason: string
): Promise<{ success: boolean; orderId?: string; filledAmount?: number; avgPrice?: number; pnl?: number }> {
  try {
    // Place IOC order for speed
    const order = await gateRequest('POST', '/spot/orders', {
      currency_pair: symbol,
      type: 'limit',
      side,
      amount: amount.toString(),
      price: price.toString(),
      time_in_force: 'ioc',
    });

    if (order.id) {
      // An IOC limit that doesn't cross still returns an id with filled_amount 0.
      // Counting that as a success created phantom positions (entry) and naked
      // sells (exit). Require positive fill evidence and report the REAL filled
      // base size so the position tracks what we actually hold.
      let filled = parseFloat(order.filled_amount || '0');
      const avg = parseFloat(order.avg_deal_price || '0') || price;
      if (filled <= 0) {
        const ft = parseFloat(order.filled_total || '0');
        if (ft > 0 && avg > 0) filled = ft / avg;
      }
      if (filled <= 0) {
        console.log(`[MicroScalper] ${side.toUpperCase()} ${symbol}: IOC not filled — no position change`);
        return { success: false, orderId: order.id };
      }

      // Log to database (actual filled size)
      await supabase.from('trade_history').insert({
        symbol,
        side,
        type: 'micro_scalp',
        price: avg,
        amount: filled,
        order_id: order.id,
        status: order.status,
        expected_edge: reason,
      });

      console.log(`[MicroScalper] ${side.toUpperCase()} ${symbol}: $${(filled * avg).toFixed(2)} @ ${avg} (${reason})`);

      return { success: true, orderId: order.id, filledAmount: filled, avgPrice: avg };
    }

    return { success: false };
  } catch (e) {
    console.error(`[MicroScalper] Trade error:`, e);
    return { success: false };
  }
}

async function runMicroScalpingCycle(supabase: any): Promise<{
  entries: number;
  exits: number;
  pnl: number;
  scanned: number;
}> {
  const results = { entries: 0, exits: 0, pnl: 0, scanned: 0 };
  
  try {
    const balance = await getBalance();
    const pairs = await getTopVolatilePairs();
    const tickers = await gateRequest('GET', '/spot/tickers');
    
    if (!Array.isArray(tickers)) return results;
    
    const tickerMap = new Map(tickers.map((t: any) => [t.currency_pair, t]));
    
    // Calculate dynamic trade size based on balance
    const tradeSize = Math.min(
      Math.max(balance * (CONFIG.maxTradePercent / 100), CONFIG.minTradeSize),
      balance * 0.2 // Never more than 20% in one trade
    );
    
    // PHASE 1: Check exits on existing positions
    for (const [symbol, position] of activePositions) {
      const ticker = tickerMap.get(symbol);
      if (!ticker) continue;
      
      const currentPrice = parseFloat(ticker.last);
      const exitCheck = shouldExitTrade(position, currentPrice);
      
      if (exitCheck.exit) {
        const result = await executeTrade(supabase, symbol, 'sell', position.amount, currentPrice, exitCheck.reason);

        if (result.success) {
          // Book P&L on the size ACTUALLY sold, at the actual fill price, not the
          // full requested size. On a partial fill keep the residual position open
          // instead of dropping it (which would orphan base and overstate P&L).
          const soldBase = result.filledAmount && result.filledAmount > 0 ? result.filledAmount : position.amount;
          const exitPrice = result.avgPrice || currentPrice;
          const pnl = (exitPrice - position.entryPrice) * soldBase;
          results.pnl += pnl;
          lastTrades.set(symbol, Date.now());

          if (soldBase >= position.amount * 0.999) {
            results.exits++;
            activePositions.delete(symbol);
            console.log(`[MicroScalper] EXIT ${symbol}: P&L $${pnl.toFixed(4)} (${exitCheck.reason})`);
          } else {
            position.amount -= soldBase;
            console.log(`[MicroScalper] PARTIAL EXIT ${symbol}: sold ${soldBase}, P&L $${pnl.toFixed(4)}, ${position.amount} left`);
          }
        }
      }
    }
    
    // PHASE 2: Look for new entries
    if (activePositions.size < CONFIG.maxConcurrentTrades && balance >= CONFIG.minTradeSize) {
      for (const pair of pairs) {
        results.scanned++;
        
        if (activePositions.size >= CONFIG.maxConcurrentTrades) break;
        
        const ticker = tickerMap.get(pair);
        if (!ticker) continue;
        
        const bid = parseFloat(ticker.highest_bid || '0');
        const ask = parseFloat(ticker.lowest_ask || '0');
        const last = parseFloat(ticker.last || '0');
        const volume = parseFloat(ticker.quote_volume || '0');
        
        if (!bid || !ask || !last) continue;
        
        const velocity = calculatePriceVelocity(pair, last);
        const entryCheck = shouldEnterTrade(pair, bid, ask, velocity, volume);
        
        if (entryCheck.enter) {
          const amount = tradeSize / ask;
          const result = await executeTrade(supabase, pair, 'buy', amount, ask, entryCheck.reason);

          // Open the position only on a real fill, sized to what actually filled.
          if (result.success && result.filledAmount && result.filledAmount > 0) {
            activePositions.set(pair, {
              symbol: pair,
              entryPrice: result.avgPrice || ask,
              amount: result.filledAmount,
              entryTime: Date.now(),
              highestPrice: ask,
              trailingActive: false,
              side: entryCheck.side,
            });
            
            results.entries++;
            lastTrades.set(pair, Date.now());
          }
        }
      }
    }
    
  } catch (e) {
    console.error('[MicroScalper] Cycle error:', e);
  }
  
  return results;
}

async function runContinuousScalping(durationMs: number) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const startTime = Date.now();
  const endTime = startTime + durationMs;
  
  let totalEntries = 0;
  let totalExits = 0;
  let totalPnl = 0;
  let cycles = 0;
  
  console.log(`[MicroScalper] Starting ${durationMs / 1000}s session`);
  
  while (Date.now() < endTime) {
    cycles++;
    const result = await runMicroScalpingCycle(supabase);
    
    totalEntries += result.entries;
    totalExits += result.exits;
    totalPnl += result.pnl;
    
    if (result.entries > 0 || result.exits > 0) {
      console.log(`[MicroScalper] Cycle ${cycles}: +${result.entries} entries, ${result.exits} exits, P&L: $${result.pnl.toFixed(4)}`);
    }
    
    // Update state
    if (cycles % 10 === 0) {
      await supabase.from('trading_system_state')
        .update({
          last_heartbeat: new Date().toISOString(),
          total_pnl: totalPnl,
        })
        .eq('is_active', true);
    }
    
    // Wait for next scan
    await new Promise(r => setTimeout(r, CONFIG.scanIntervalMs));
  }
  
  console.log(`[MicroScalper] Session complete: ${cycles} cycles, ${totalEntries} entries, ${totalExits} exits, P&L: $${totalPnl.toFixed(4)}`);
  
  return {
    cycles,
    entries: totalEntries,
    exits: totalExits,
    pnl: totalPnl,
    activePositions: activePositions.size,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const durationSeconds = body.durationSeconds || 120; // Default 2 minutes
    
    console.log(`[MicroScalper] Starting for ${durationSeconds} seconds`);
    
    // Run in background
    const resultPromise = runContinuousScalping(durationSeconds * 1000);
    
    // Return immediately
    return new Response(JSON.stringify({
      success: true,
      message: `Micro-scalper started for ${durationSeconds} seconds`,
      config: {
        takeProfitPercent: CONFIG.takeProfitPercent,
        stopLossPercent: CONFIG.stopLossPercent,
        scanIntervalMs: CONFIG.scanIntervalMs,
        maxConcurrentTrades: CONFIG.maxConcurrentTrades,
      },
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
    
  } catch (error) {
    console.error('[MicroScalper] Error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
