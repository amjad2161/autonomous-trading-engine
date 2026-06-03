import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { gateFetch } from "../_shared/gate-client.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseKey);

// ===================== CONFIGURATION =====================
const CONFIG = {
  // Trailing Stop
  TRAILING_ACTIVATION: 0.025,  // Activate at +2.5%
  TRAILING_MIN: 0.015,         // 1.5% trail distance
  TRAILING_MAX: 0.025,         // 2.5% max trail
  
  // Take Profits
  TP1_PERCENT: 0.030,          // TP1 at +3%
  TP1_SIZE: 0.40,              // Take 40%
  TP2_PERCENT: 0.055,          // TP2 at +5.5%
  TP2_SIZE: 0.35,              // Take 35%
  
  // Dynamic adjustments
  VOLATILITY_TRAIL_MULTIPLIER: 1.2,
  MOMENTUM_TP_BOOST: 1.15,
  
  // Timeouts
  STALE_POSITION_MS: 4 * 60 * 60 * 1000, // 4 hours
};

// ===================== GATE.IO API =====================
const gateRequest = (endpoint: string, method: 'GET' | 'POST' | 'DELETE' = 'GET', params: Record<string, string> = {}, body?: Record<string, unknown>): Promise<any> =>
  gateFetch('position-manager', endpoint, method, params, body);

// ===================== LOGGING =====================
async function log(level: string, component: string, message: string, details?: unknown) {
  console.log(`[${component}] ${message}`);
  await supabase.from('system_log').insert({ level, component, message, details });
}

// ===================== POSITION TRACKER =====================
interface TrackedPosition {
  symbol: string;
  currency: string;
  entryPrice: number;
  amount: number;
  originalAmount: number;
  currentStop: number;
  trailingStop: number | null;
  trailingActivated: boolean;
  tp1Hit: boolean;
  tp2Hit: boolean;
  entryTime: number;
  lastUpdated: number;
}

// In-memory position cache (refreshed each run)
let positionCache: Map<string, TrackedPosition> = new Map();

async function loadPositions(): Promise<TrackedPosition[]> {
  const balances = await gateRequest('/spot/accounts');
  const tickers = await gateRequest('/spot/tickers');
  const tickerMap = new Map<string, { last: number; bid: number; high24h: number; low24h: number }>(
    tickers.map((t: any) => [t.currency_pair, { 
      last: parseFloat(t.last), 
      bid: parseFloat(t.highest_bid),
      high24h: parseFloat(t.high_24h),
      low24h: parseFloat(t.low_24h),
    }])
  );

  const positions: TrackedPosition[] = [];

  for (const balance of balances) {
    if (balance.currency === 'USDT' || parseFloat(balance.available) <= 0) continue;

    const pair = `${balance.currency}_USDT`;
    const ticker = tickerMap.get(pair);
    if (!ticker) continue;

    const amount = parseFloat(balance.available);
    const value = amount * ticker.last;
    if (value < 3) continue;

    // Get entry from trade history
    const { data: entryTrade } = await supabase
      .from('trade_history')
      .select('*')
      .eq('symbol', pair.replace('_', '/'))
      .eq('side', 'buy')
      .order('executed_at', { ascending: false })
      .limit(1);

    const entryPrice = entryTrade?.[0]?.price || ticker.last;
    const entryTime = entryTrade?.[0]?.executed_at 
      ? new Date(entryTrade[0].executed_at).getTime() 
      : Date.now();

    // Check cache for existing tracking data
    const cached = positionCache.get(pair);
    
    positions.push({
      symbol: pair,
      currency: balance.currency,
      entryPrice,
      amount,
      originalAmount: cached?.originalAmount || amount,
      currentStop: cached?.currentStop || entryPrice * (1 - 0.015),
      trailingStop: cached?.trailingStop || null,
      trailingActivated: cached?.trailingActivated || false,
      tp1Hit: cached?.tp1Hit || false,
      tp2Hit: cached?.tp2Hit || false,
      entryTime,
      lastUpdated: Date.now(),
    });
  }

  // Update cache
  positionCache = new Map(positions.map(p => [p.symbol, p]));
  
  return positions;
}

// ===================== TRAILING STOP MANAGER =====================
interface StopUpdate {
  symbol: string;
  currency: string;
  oldStop: number;
  newStop: number;
  reason: string;
  pnlPercent: number;
}

function calculateTrailingUpdates(
  positions: TrackedPosition[], 
  tickers: Map<string, { last: number; bid: number; volatility: number }>
): StopUpdate[] {
  const updates: StopUpdate[] = [];

  for (const pos of positions) {
    const ticker = tickers.get(pos.symbol);
    if (!ticker) continue;

    const pnlPercent = (ticker.last - pos.entryPrice) / pos.entryPrice;
    
    // Check if trailing should activate
    if (!pos.trailingActivated && pnlPercent >= CONFIG.TRAILING_ACTIVATION) {
      // Activate trailing - adjust for volatility
      const volAdjust = ticker.volatility > 3 ? CONFIG.VOLATILITY_TRAIL_MULTIPLIER : 1.0;
      const trailDist = CONFIG.TRAILING_MIN * volAdjust;
      const newTrail = ticker.last * (1 - trailDist);
      
      updates.push({
        symbol: pos.symbol,
        currency: pos.currency,
        oldStop: pos.currentStop,
        newStop: newTrail,
        reason: 'TRAILING_ACTIVATED',
        pnlPercent,
      });
      
      pos.trailingActivated = true;
      pos.trailingStop = newTrail;
      pos.currentStop = newTrail;
    }
    // Update existing trailing stop
    else if (pos.trailingActivated && pos.trailingStop) {
      const volAdjust = ticker.volatility > 3 ? CONFIG.VOLATILITY_TRAIL_MULTIPLIER : 1.0;
      const trailDist = Math.min(CONFIG.TRAILING_MIN + (pnlPercent * 0.3), CONFIG.TRAILING_MAX) * volAdjust;
      const newTrail = ticker.last * (1 - trailDist);
      
      // Only update if higher (ratchet up only)
      if (newTrail > pos.trailingStop) {
        updates.push({
          symbol: pos.symbol,
          currency: pos.currency,
          oldStop: pos.trailingStop,
          newStop: newTrail,
          reason: 'TRAILING_RATCHET',
          pnlPercent,
        });
        
        pos.trailingStop = newTrail;
        pos.currentStop = newTrail;
      }
    }
    
    // Update cache
    positionCache.set(pos.symbol, pos);
  }

  return updates;
}

// ===================== DYNAMIC TP MANAGER =====================
interface TPUpdate {
  symbol: string;
  currency: string;
  level: 'TP1' | 'TP2';
  triggerPrice: number;
  currentPrice: number;
  amountToSell: number;
  pnlPercent: number;
}

function calculateTPTriggers(
  positions: TrackedPosition[],
  tickers: Map<string, { last: number; bid: number; momentum: number }>
): TPUpdate[] {
  const triggers: TPUpdate[] = [];

  for (const pos of positions) {
    const ticker = tickers.get(pos.symbol);
    if (!ticker) continue;

    const pnlPercent = (ticker.last - pos.entryPrice) / pos.entryPrice;

    // Dynamic TP1 - boost in strong momentum
    const tp1Target = CONFIG.TP1_PERCENT * (ticker.momentum > 5 ? CONFIG.MOMENTUM_TP_BOOST : 1.0);
    if (!pos.tp1Hit && pnlPercent >= tp1Target) {
      triggers.push({
        symbol: pos.symbol,
        currency: pos.currency,
        level: 'TP1',
        triggerPrice: pos.entryPrice * (1 + tp1Target),
        currentPrice: ticker.last,
        amountToSell: pos.originalAmount * CONFIG.TP1_SIZE,
        pnlPercent,
      });
      pos.tp1Hit = true;
    }

    // Dynamic TP2
    const tp2Target = CONFIG.TP2_PERCENT * (ticker.momentum > 7 ? CONFIG.MOMENTUM_TP_BOOST : 1.0);
    if (pos.tp1Hit && !pos.tp2Hit && pnlPercent >= tp2Target) {
      triggers.push({
        symbol: pos.symbol,
        currency: pos.currency,
        level: 'TP2',
        triggerPrice: pos.entryPrice * (1 + tp2Target),
        currentPrice: ticker.last,
        amountToSell: pos.originalAmount * CONFIG.TP2_SIZE,
        pnlPercent,
      });
      pos.tp2Hit = true;
    }
    
    positionCache.set(pos.symbol, pos);
  }

  return triggers;
}

// ===================== EXECUTE TP ORDERS =====================
async function executeTPOrders(triggers: TPUpdate[]): Promise<{ success: number; failed: number; pnl: number }> {
  let success = 0;
  let failed = 0;
  let totalPnL = 0;

  for (const tp of triggers) {
    try {
      const clientOrderId = `tp_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      
      const order = await gateRequest('/spot/orders', 'POST', {}, {
        currency_pair: tp.symbol,
        side: 'sell',
        amount: tp.amountToSell.toFixed(6),
        price: tp.currentPrice.toFixed(8),
        type: 'limit',
        time_in_force: 'ioc',
        text: clientOrderId,
      });

      if (order.id) {
        success++;
        const pnlUSDT = tp.amountToSell * tp.currentPrice * tp.pnlPercent;
        totalPnL += pnlUSDT;

        await supabase.from('trade_history').insert({
          order_id: order.id,
          symbol: tp.symbol.replace('_', '/'),
          side: 'sell',
          type: tp.level,
          amount: tp.amountToSell,
          price: tp.currentPrice,
          expected_edge: tp.pnlPercent * 100,
          actual_pnl: pnlUSDT,
          status: 'filled',
          executed_at: new Date().toISOString(),
        });

        await log('info', 'POS_MANAGER', `🎯 ${tp.level}: ${tp.currency} @ $${tp.currentPrice.toFixed(4)} | +${(tp.pnlPercent * 100).toFixed(2)}% | $${pnlUSDT.toFixed(2)}`);
      } else {
        failed++;
      }
    } catch (err) {
      failed++;
      await log('error', 'POS_MANAGER', `TP order failed: ${tp.symbol}`, { error: err instanceof Error ? err.message : 'Unknown' });
    }

    await new Promise(r => setTimeout(r, 100));
  }

  return { success, failed, pnl: totalPnL };
}

// ===================== STALE POSITION CHECKER =====================
interface StaleAlert {
  symbol: string;
  currency: string;
  ageHours: number;
  pnlPercent: number;
  recommendation: string;
}

function checkStalePositions(positions: TrackedPosition[], tickers: Map<string, { last: number }>): StaleAlert[] {
  const alerts: StaleAlert[] = [];
  const now = Date.now();

  for (const pos of positions) {
    const ageMs = now - pos.entryTime;
    if (ageMs > CONFIG.STALE_POSITION_MS) {
      const ticker = tickers.get(pos.symbol);
      const pnlPercent = ticker ? (ticker.last - pos.entryPrice) / pos.entryPrice : 0;
      
      let recommendation = 'MONITOR';
      if (pnlPercent < -0.02) recommendation = 'CONSIDER_EXIT';
      else if (pnlPercent > 0.01) recommendation = 'TIGHTEN_STOP';
      else if (pnlPercent < 0 && pnlPercent > -0.01) recommendation = 'HOLD';

      alerts.push({
        symbol: pos.symbol,
        currency: pos.currency,
        ageHours: ageMs / (60 * 60 * 1000),
        pnlPercent,
        recommendation,
      });
    }
  }

  return alerts;
}

// ===================== MAIN MANAGER CYCLE =====================
async function runPositionManagement(): Promise<{
  positions: number;
  stopUpdates: StopUpdate[];
  tpTriggers: TPUpdate[];
  tpResults: { success: number; failed: number; pnl: number };
  staleAlerts: StaleAlert[];
}> {
  // Load current positions
  const positions = await loadPositions();
  
  if (positions.length === 0) {
    return {
      positions: 0,
      stopUpdates: [],
      tpTriggers: [],
      tpResults: { success: 0, failed: 0, pnl: 0 },
      staleAlerts: [],
    };
  }

  // Get fresh ticker data
  const tickers = await gateRequest('/spot/tickers');
  const tickerMap = new Map(
    tickers.map((t: any) => {
      const high = parseFloat(t.high_24h);
      const low = parseFloat(t.low_24h);
      const last = parseFloat(t.last);
      return [t.currency_pair, {
        last,
        bid: parseFloat(t.highest_bid),
        volatility: ((high - low) / last) * 100,
        momentum: parseFloat(t.change_percentage),
      }];
    })
  );

  // 1. Calculate trailing stop updates
  const stopUpdates = calculateTrailingUpdates(positions, tickerMap as any);
  
  for (const update of stopUpdates) {
    await log('info', 'POS_MANAGER', `📊 ${update.reason}: ${update.currency} | Stop: $${update.oldStop.toFixed(4)} → $${update.newStop.toFixed(4)} | P&L: ${(update.pnlPercent * 100).toFixed(2)}%`);
  }

  // 2. Check and execute TP triggers
  const tpTriggers = calculateTPTriggers(positions, tickerMap as any);
  const tpResults = tpTriggers.length > 0 
    ? await executeTPOrders(tpTriggers)
    : { success: 0, failed: 0, pnl: 0 };

  // 3. Check for stale positions
  const staleAlerts = checkStalePositions(positions, tickerMap as any);
  
  for (const alert of staleAlerts) {
    await log('warn', 'POS_MANAGER', `⏰ Stale: ${alert.currency} | ${alert.ageHours.toFixed(1)}h | ${(alert.pnlPercent * 100).toFixed(2)}% | ${alert.recommendation}`);
  }

  // Update system state
  if (tpResults.pnl !== 0) {
    const { data: dbState } = await supabase.from('trading_system_state').select('*').limit(1).single();
    if (dbState) {
      await supabase.from('trading_system_state').update({
        total_pnl: (dbState.total_pnl || 0) + tpResults.pnl,
        last_heartbeat: new Date().toISOString(),
      }).eq('id', dbState.id);
    }
  }

  return {
    positions: positions.length,
    stopUpdates,
    tpTriggers,
    tpResults,
    staleAlerts,
  };
}

// ===================== HTTP HANDLER =====================
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const command = body.command || 'manage';

    await log('info', 'POS_MANAGER', `Command: ${command}`);

    if (command === 'status') {
      const positions = await loadPositions();
      return new Response(JSON.stringify({
        success: true,
        positions: positions.map(p => ({
          ...p,
          pnlPercent: 0, // Will be calculated client-side
        })),
        cached: positionCache.size,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Run management cycle
    const result = await runPositionManagement();

    await log('info', 'POS_MANAGER', `Cycle complete | Pos: ${result.positions} | Stops: ${result.stopUpdates.length} | TPs: ${result.tpTriggers.length} | P&L: $${result.tpResults.pnl.toFixed(2)}`);

    return new Response(JSON.stringify({
      success: true,
      ...result,
      timestamp: Date.now(),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[POS_MANAGER] Error:', error);
    await log('error', 'POS_MANAGER', 'Failed', { error: error instanceof Error ? error.message : 'Unknown' });

    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
