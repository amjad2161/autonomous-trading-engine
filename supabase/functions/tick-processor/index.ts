import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { guardSpotOrder } from "../_shared/safety.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac } from "https://deno.land/std@0.177.0/node/crypto.ts";
import { encodeHex } from "https://deno.land/std@0.224.0/encoding/hex.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const GATE_API_KEY = Deno.env.get('GATE_API_KEY')!;
const GATE_API_SECRET = Deno.env.get('GATE_API_SECRET')!;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ===================== ULTRA-SCALPING CONFIGURATION =====================
const SCALP_CONFIG = {
  // Micro-profit targets
  MIN_PROFIT_TARGET: 0.003,    // 0.3% minimum profit
  MAX_PROFIT_TARGET: 0.015,    // 1.5% maximum (take profit fast)
  
  // Ultra-tight stops
  STOP_LOSS: 0.005,            // 0.5% stop loss
  TRAILING_ACTIVATION: 0.003,  // Activate trailing at 0.3%
  TRAILING_DISTANCE: 0.002,    // 0.2% trailing distance
  
  // Entry conditions
  MIN_TICK_VELOCITY: 0.001,    // 0.1% price change per tick to trigger
  MIN_VOLUME_SPIKE: 1.5,       // 50% volume spike
  
  // Position sizing
  MAX_POSITION_SIZE: 10,       // $10 max per scalp
  MIN_POSITION_SIZE: 3,        // $3 minimum
  
  // Trade frequency limits
  MAX_TRADES_PER_MINUTE: 5,
  COOLDOWN_AFTER_LOSS_MS: 5000, // 5 second cooldown after loss
};

// ===================== STATE TRACKING =====================
interface TickData {
  pair: string;
  price: number;
  bid: number;
  ask: number;
  volume: number;
  timestamp: number;
}

interface PriceHistory {
  prices: number[];
  volumes: number[];
  timestamps: number[];
}

interface ActiveScalp {
  pair: string;
  entryPrice: number;
  amount: number;
  stopLoss: number;
  trailingStop?: number;
  trailingActivated: boolean;
  entryTime: number;
  highestPrice: number;
}

// In-memory state (resets on function restart)
const priceHistory: Map<string, PriceHistory> = new Map();
const activeScalps: Map<string, ActiveScalp> = new Map();
let lastTradeTime = 0;
let tradesThisMinute = 0;
let lastLossTime = 0;

// ===================== GATE.IO API =====================
async function sha512Hash(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-512', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function generateSignature(method: string, url: string, queryString: string, payloadString: string, timestamp: string): Promise<string> {
  const hashedPayload = await sha512Hash(payloadString);
  const signatureString = `${method}\n${url}\n${queryString}\n${hashedPayload}\n${timestamp}`;
  return createHmac('sha512', GATE_API_SECRET).update(signatureString).digest('hex');
}

async function executeOrder(pair: string, side: 'buy' | 'sell', amount: number, price: number): Promise<{ success: boolean; orderId?: string; error?: string }> {
  try {
    const endpoint = '/api/v4/spot/orders';
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const clientOrderId = `t-tick_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    
    const body = {
      currency_pair: pair,
      side,
      amount: amount.toFixed(6),
      price: price.toFixed(8),
      type: 'limit',
      time_in_force: 'ioc', // Immediate or cancel
      text: clientOrderId,
    };
    
    // SAFETY GATE: honour DRY_RUN / kill switch / risk caps before any live order.
    const __sim = guardSpotOrder('tick-processor', body as unknown as Record<string, unknown>);
    if (__sim) return { success: true, orderId: __sim.id };

    const bodyStr = JSON.stringify(body);
    const signature = await generateSignature('POST', endpoint, '', bodyStr, timestamp);
    
    const response = await fetch(`https://api.gateio.ws${endpoint}`, {
      method: 'POST',
      headers: {
        'KEY': GATE_API_KEY,
        'SIGN': signature,
        'Timestamp': timestamp,
        'Content-Type': 'application/json',
      },
      body: bodyStr,
    });
    
    const result = await response.json();
    
    if (result.id) {
      return { success: true, orderId: result.id };
    }
    return { success: false, error: JSON.stringify(result) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown' };
  }
}

// ===================== TICK ANALYSIS =====================
function updatePriceHistory(tick: TickData) {
  let history = priceHistory.get(tick.pair);
  if (!history) {
    history = { prices: [], volumes: [], timestamps: [] };
    priceHistory.set(tick.pair, history);
  }
  
  history.prices.push(tick.price);
  history.volumes.push(tick.volume);
  history.timestamps.push(tick.timestamp);
  
  // Keep only last 100 ticks
  if (history.prices.length > 100) {
    history.prices.shift();
    history.volumes.shift();
    history.timestamps.shift();
  }
}

function calculateTickVelocity(history: PriceHistory): number {
  if (history.prices.length < 3) return 0;
  
  const recent = history.prices.slice(-3);
  const priceChange = (recent[2] - recent[0]) / recent[0];
  return priceChange;
}

function detectVolumeSpike(history: PriceHistory): number {
  if (history.volumes.length < 10) return 1;
  
  const recentVol = history.volumes.slice(-3).reduce((a, b) => a + b, 0) / 3;
  const avgVol = history.volumes.slice(-10).reduce((a, b) => a + b, 0) / 10;
  
  return avgVol > 0 ? recentVol / avgVol : 1;
}

function detectMomentum(history: PriceHistory): 'bullish' | 'bearish' | 'neutral' {
  if (history.prices.length < 5) return 'neutral';
  
  const prices = history.prices.slice(-5);
  let upTicks = 0;
  let downTicks = 0;
  
  for (let i = 1; i < prices.length; i++) {
    if (prices[i] > prices[i - 1]) upTicks++;
    else if (prices[i] < prices[i - 1]) downTicks++;
  }
  
  if (upTicks >= 3) return 'bullish';
  if (downTicks >= 3) return 'bearish';
  return 'neutral';
}

function detectMeanReversion(history: PriceHistory): { signal: boolean; direction: 'up' | 'down'; distance: number } {
  if (history.prices.length < 20) return { signal: false, direction: 'up', distance: 0 };
  
  const prices = history.prices.slice(-20);
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  const currentPrice = prices[prices.length - 1];
  const distance = (currentPrice - mean) / mean;
  
  // Signal when price is far from mean
  if (Math.abs(distance) > 0.01) { // 1% deviation
    return {
      signal: true,
      direction: distance < 0 ? 'up' : 'down', // Expect reversion to mean
      distance: Math.abs(distance),
    };
  }
  
  return { signal: false, direction: 'up', distance: 0 };
}

// ===================== SCALPING LOGIC =====================
interface ScalpSignal {
  action: 'buy' | 'sell' | 'hold';
  pair: string;
  price: number;
  reason: string;
  confidence: number;
  size: number;
  stopLoss: number;
  takeProfit: number;
}

function analyzeTickForEntry(tick: TickData, balance: number): ScalpSignal | null {
  const history = priceHistory.get(tick.pair);
  if (!history || history.prices.length < 10) return null;
  
  // Check cooldowns
  const now = Date.now();
  if (now - lastLossTime < SCALP_CONFIG.COOLDOWN_AFTER_LOSS_MS) return null;
  if (tradesThisMinute >= SCALP_CONFIG.MAX_TRADES_PER_MINUTE) return null;
  
  // Skip if already have position in this pair
  if (activeScalps.has(tick.pair)) return null;
  
  const velocity = calculateTickVelocity(history);
  const volumeSpike = detectVolumeSpike(history);
  const momentum = detectMomentum(history);
  const meanReversion = detectMeanReversion(history);
  
  let signal: ScalpSignal | null = null;
  
  // 1. MOMENTUM SCALP: Strong directional move with volume
  if (Math.abs(velocity) >= SCALP_CONFIG.MIN_TICK_VELOCITY && 
      volumeSpike >= SCALP_CONFIG.MIN_VOLUME_SPIKE) {
    if (velocity > 0 && momentum === 'bullish') {
      signal = {
        action: 'buy',
        pair: tick.pair,
        price: tick.ask,
        reason: 'momentum_scalp',
        confidence: 70 + Math.min(volumeSpike * 10, 20),
        size: Math.min(SCALP_CONFIG.MAX_POSITION_SIZE, balance * 0.1),
        stopLoss: tick.ask * (1 - SCALP_CONFIG.STOP_LOSS),
        takeProfit: tick.ask * (1 + SCALP_CONFIG.MIN_PROFIT_TARGET),
      };
    }
  }
  
  // 2. MEAN REVERSION: Price deviated too far from average
  if (!signal && meanReversion.signal) {
    if (meanReversion.direction === 'up' && meanReversion.distance > 0.015) {
      signal = {
        action: 'buy',
        pair: tick.pair,
        price: tick.ask,
        reason: 'mean_reversion',
        confidence: 65 + Math.min(meanReversion.distance * 1000, 20),
        size: Math.min(SCALP_CONFIG.MAX_POSITION_SIZE, balance * 0.08),
        stopLoss: tick.ask * (1 - SCALP_CONFIG.STOP_LOSS * 1.5), // Wider stop for reversion
        takeProfit: tick.ask * (1 + meanReversion.distance * 0.5), // Target: half the deviation
      };
    }
  }
  
  // 3. SPREAD SCALP: Very tight spread with movement
  const spread = (tick.ask - tick.bid) / tick.bid;
  if (!signal && spread < 0.001 && Math.abs(velocity) > 0.0005) {
    signal = {
      action: velocity > 0 ? 'buy' : 'hold',
      pair: tick.pair,
      price: tick.ask,
      reason: 'spread_scalp',
      confidence: 60,
      size: SCALP_CONFIG.MIN_POSITION_SIZE,
      stopLoss: tick.ask * (1 - SCALP_CONFIG.STOP_LOSS * 0.5), // Very tight stop
      takeProfit: tick.ask * (1 + SCALP_CONFIG.MIN_PROFIT_TARGET),
    };
  }
  
  // Validate minimum size
  if (signal && signal.size < SCALP_CONFIG.MIN_POSITION_SIZE) {
    return null;
  }
  
  return signal;
}

function analyzeTickForExit(tick: TickData, scalp: ActiveScalp): { action: 'sell' | 'hold'; reason: string } {
  const currentPrice = tick.bid;
  const pnlPercent = (currentPrice - scalp.entryPrice) / scalp.entryPrice;
  
  // Update highest price for trailing
  if (currentPrice > scalp.highestPrice) {
    scalp.highestPrice = currentPrice;
  }
  
  // 1. STOP LOSS
  if (currentPrice <= scalp.stopLoss) {
    return { action: 'sell', reason: 'stop_loss' };
  }
  
  // 2. TRAILING STOP
  if (scalp.trailingActivated && scalp.trailingStop && currentPrice <= scalp.trailingStop) {
    return { action: 'sell', reason: 'trailing_stop' };
  }
  
  // Activate trailing if profit threshold reached
  if (!scalp.trailingActivated && pnlPercent >= SCALP_CONFIG.TRAILING_ACTIVATION) {
    scalp.trailingActivated = true;
  }
  
  // Update trailing stop
  if (scalp.trailingActivated) {
    const newTrailStop = scalp.highestPrice * (1 - SCALP_CONFIG.TRAILING_DISTANCE);
    if (!scalp.trailingStop || newTrailStop > scalp.trailingStop) {
      scalp.trailingStop = newTrailStop;
    }
  }
  
  // 3. TAKE PROFIT (fast exit at max target)
  if (pnlPercent >= SCALP_CONFIG.MAX_PROFIT_TARGET) {
    return { action: 'sell', reason: 'take_profit' };
  }
  
  // 4. TIME DECAY: Exit after 60 seconds if no significant profit
  const holdTime = Date.now() - scalp.entryTime;
  if (holdTime > 60000 && pnlPercent < SCALP_CONFIG.MIN_PROFIT_TARGET) {
    return { action: 'sell', reason: 'time_decay' };
  }
  
  return { action: 'hold', reason: '' };
}

// ===================== MAIN PROCESSOR =====================
async function processTick(tick: TickData, balance: number): Promise<{
  action: string;
  pair: string;
  reason: string;
  executed: boolean;
  pnl?: number;
}> {
  updatePriceHistory(tick);
  
  // Reset trades counter every minute
  const now = Date.now();
  if (now - lastTradeTime > 60000) {
    tradesThisMinute = 0;
  }
  
  // Check for exits first
  const scalp = activeScalps.get(tick.pair);
  if (scalp) {
    const exitSignal = analyzeTickForExit(tick, scalp);
    if (exitSignal.action === 'sell') {
      const result = await executeOrder(tick.pair, 'sell', scalp.amount, tick.bid);
      
      if (result.success) {
        const pnl = (tick.bid - scalp.entryPrice) * scalp.amount;
        activeScalps.delete(tick.pair);
        
        if (pnl < 0) {
          lastLossTime = now;
        }
        
        // Log to database
        await supabase.from('trade_history').insert({
          order_id: result.orderId,
          symbol: tick.pair.replace('_', '/'),
          side: 'sell',
          type: exitSignal.reason,
          amount: scalp.amount,
          price: tick.bid,
          expected_edge: ((tick.bid - scalp.entryPrice) / scalp.entryPrice) * 100,
          actual_pnl: pnl,
          status: 'filled',
          executed_at: new Date().toISOString(),
        });
        
        await supabase.from('system_log').insert({
          level: pnl > 0 ? 'info' : 'warn',
          component: 'TICK_SCALP',
          message: `${pnl > 0 ? '🟢' : '🔴'} ${exitSignal.reason}: ${tick.pair} | ${((tick.bid - scalp.entryPrice) / scalp.entryPrice * 100).toFixed(2)}% | $${pnl.toFixed(3)}`,
        });
        
        return {
          action: 'sell',
          pair: tick.pair,
          reason: exitSignal.reason,
          executed: true,
          pnl,
        };
      }
    }
    
    return { action: 'hold_position', pair: tick.pair, reason: 'monitoring', executed: false };
  }
  
  // Check for entries
  const entrySignal = analyzeTickForEntry(tick, balance);
  if (entrySignal && entrySignal.action === 'buy') {
    const amount = entrySignal.size / entrySignal.price;
    const result = await executeOrder(tick.pair, 'buy', amount, entrySignal.price);
    
    if (result.success) {
      activeScalps.set(tick.pair, {
        pair: tick.pair,
        entryPrice: entrySignal.price,
        amount,
        stopLoss: entrySignal.stopLoss,
        trailingActivated: false,
        entryTime: now,
        highestPrice: entrySignal.price,
      });
      
      tradesThisMinute++;
      lastTradeTime = now;
      
      // Log to database
      await supabase.from('trade_history').insert({
        order_id: result.orderId,
        symbol: tick.pair.replace('_', '/'),
        side: 'buy',
        type: entrySignal.reason,
        amount,
        price: entrySignal.price,
        expected_edge: SCALP_CONFIG.MIN_PROFIT_TARGET * 100,
        status: 'filled',
        executed_at: new Date().toISOString(),
      });
      
      await supabase.from('system_log').insert({
        level: 'info',
        component: 'TICK_SCALP',
        message: `🎯 ${entrySignal.reason}: ${tick.pair} @ $${entrySignal.price.toFixed(4)} | Conf: ${entrySignal.confidence.toFixed(0)}%`,
      });
      
      return {
        action: 'buy',
        pair: tick.pair,
        reason: entrySignal.reason,
        executed: true,
      };
    }
  }
  
  return { action: 'scan', pair: tick.pair, reason: 'no_signal', executed: false };
}

// ===================== HTTP HANDLER =====================
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { tick, balance = 50 } = body;
    
    if (!tick || !tick.pair || !tick.price) {
      return new Response(JSON.stringify({ error: 'Invalid tick data' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    const result = await processTick({
      pair: tick.pair,
      price: parseFloat(tick.price),
      bid: parseFloat(tick.bid || tick.price),
      ask: parseFloat(tick.ask || tick.price),
      volume: parseFloat(tick.volume || 0),
      timestamp: tick.timestamp || Date.now(),
    }, balance);
    
    return new Response(JSON.stringify({
      success: true,
      ...result,
      activeScalps: Array.from(activeScalps.keys()),
      tradesThisMinute,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
    
  } catch (error) {
    console.error('[TickProcessor] Error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
