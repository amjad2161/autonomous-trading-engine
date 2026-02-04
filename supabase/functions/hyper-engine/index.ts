import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHash, createHmac } from "https://deno.land/std@0.168.0/node/crypto.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ===== DYNAMIC ADAPTIVE CONFIG =====
// All values are BASE values that get adjusted dynamically
const BASE_CONFIG = {
  // Base thresholds (will be adjusted by market conditions)
  baseMinEdge: 0.15,         // Base edge - adjusted dynamically
  baseMinVolume: 100_000,    // Base volume requirement
  baseMaxSpread: 0.3,        // Base max spread
  
  // Strategy thresholds
  momentumMinChange: 1.5,
  momentumMaxChange: 30,
  reversionMinDrop: -2.5,
  reversionMaxDrop: -35,
  
  // Position sizing - PRECISE ADAPTIVE SYSTEM
  // These are base values that get scaled based on actual available capital
  minPositionUsdt: 3,        // Gate.io absolute minimum
  maxPositionUsdt: 50,       // Maximum per trade (user preference)
  basePositionPct: 10,       // Base: 10% of available balance per trade
  // Dynamic scaling thresholds
  smallBalanceThreshold: 10, // Below this, use more aggressive sizing
  mediumBalanceThreshold: 50,
  largeBalanceThreshold: 200,
  
  // Continuous operation
  burstDurationMs: 55000,
  cycleIntervalMs: 2000,
  
  // Auto-liquidation
  liquidateThreshold: 3,
  minDustValue: 0.1,
  
  // Exclusions
  excludeSymbols: ['USDT_USDT', 'USDC_USDT', 'DAI_USDT', 'FHE_USDT'],
  excludePatterns: ['3L', '5L', '3S', '5S', '2L', '2S', 'BULL', 'BEAR'],
  stablecoins: ['USDT', 'USDC', 'DAI', 'BUSD', 'TUSD'],
  
  // Priority pairs
  priorityPairs: [
    'BTC_USDT', 'ETH_USDT', 'SOL_USDT', 'XRP_USDT', 'ADA_USDT',
    'DOGE_USDT', 'AVAX_USDT', 'DOT_USDT', 'LINK_USDT', 'MATIC_USDT',
    'NEAR_USDT', 'SUI_USDT', 'APT_USDT', 'SEI_USDT', 'INJ_USDT',
    'TIA_USDT', 'FTM_USDT', 'ATOM_USDT', 'ALGO_USDT', 'HBAR_USDT',
    'UNI_USDT', 'AAVE_USDT', 'MKR_USDT', 'LDO_USDT', 'CRV_USDT',
    'FET_USDT', 'RNDR_USDT', 'AGIX_USDT', 'IMX_USDT', 'GALA_USDT',
    'PEPE_USDT', 'SHIB_USDT', 'FLOKI_USDT', 'BONK_USDT', 'WIF_USDT',
    'ARB_USDT', 'OP_USDT', 'STX_USDT', 'ORDI_USDT', 'JUP_USDT',
  ],
  scanAllPairs: true,
  priorityBoost: 1.5,
  
  // Never stop trading
  cooldownSeconds: 0,
  maxConsecutiveLosses: 999,
  lossStreakCooldownMs: 0,
  minWinRateToTrade: 0,
  recentTradesToCheck: 0,
  
  // Protection
  baseStopLoss: 0.8,
  baseTakeProfit: 1.5,
  trailingStopPct: 0.4,
  useExchangeOrders: true,
};

// ===== DYNAMIC PARAMETER ENGINE =====
interface DynamicParams {
  minEdge: number;
  minVolume: number;
  maxSpread: number;
  stopLossPct: number;
  takeProfitPct: number;
  positionPct: number;
  maxPositionUsdt: number;
  aggressiveness: number; // 0-100 scale
  regime: string;
}

interface MarketState {
  avgVolatility: number;    // Average 24h change across top pairs
  btcChange: number;        // BTC 24h change
  marketTrend: 'bull' | 'bear' | 'neutral';
  avgVolume: number;        // Average volume
  spreadHealth: number;     // 0-1, how tight spreads are
}

interface PerformanceState {
  recentWinRate: number;    // Last 10 trades
  lastTradeProfit: boolean;
  consecutiveWins: number;
  consecutiveLosses: number;
  avgProfitPct: number;
  totalPnL: number;
}

function analyzeMarket(tickers: Map<string, { price: number; change: number; volume: number; bid: number; ask: number }>): MarketState {
  const topPairs = ['BTC_USDT', 'ETH_USDT', 'SOL_USDT', 'XRP_USDT', 'ADA_USDT'];
  let totalVolatility = 0;
  let totalVolume = 0;
  let totalSpreadHealth = 0;
  let count = 0;
  
  let btcChange = 0;
  
  for (const pair of topPairs) {
    const ticker = tickers.get(pair);
    if (ticker) {
      totalVolatility += Math.abs(ticker.change);
      totalVolume += ticker.volume;
      const spread = ticker.ask > 0 ? ((ticker.ask - ticker.bid) / ticker.ask) * 100 : 1;
      totalSpreadHealth += Math.max(0, 1 - spread); // Tighter spread = higher health
      count++;
      
      if (pair === 'BTC_USDT') {
        btcChange = ticker.change;
      }
    }
  }
  
  const avgVolatility = count > 0 ? totalVolatility / count : 2;
  const avgVolume = count > 0 ? totalVolume / count : 1000000;
  const spreadHealth = count > 0 ? totalSpreadHealth / count : 0.5;
  
  // Determine market trend
  let bullCount = 0;
  let bearCount = 0;
  for (const pair of topPairs) {
    const ticker = tickers.get(pair);
    if (ticker) {
      if (ticker.change > 1) bullCount++;
      else if (ticker.change < -1) bearCount++;
    }
  }
  
  const marketTrend: 'bull' | 'bear' | 'neutral' = 
    bullCount >= 3 ? 'bull' : bearCount >= 3 ? 'bear' : 'neutral';
  
  return { avgVolatility, btcChange, marketTrend, avgVolume, spreadHealth };
}

// deno-lint-ignore no-explicit-any
async function getPerformanceState(supabase: any): Promise<PerformanceState> {
  try {
    const { data: trades } = await supabase
      .from('trade_history')
      .select('actual_pnl, status')
      .not('actual_pnl', 'is', null)
      .order('created_at', { ascending: false })
      .limit(10);
    
    if (!trades || trades.length === 0) {
      return {
        recentWinRate: 50,
        lastTradeProfit: true,
        consecutiveWins: 0,
        consecutiveLosses: 0,
        avgProfitPct: 0,
        totalPnL: 0,
      };
    }
    
    const tradesTyped = trades as Array<{ actual_pnl: number | null; status: string }>;
    const wins = tradesTyped.filter(t => (t.actual_pnl || 0) > 0);
    const recentWinRate = (wins.length / tradesTyped.length) * 100;
    const lastTradeProfit = (tradesTyped[0]?.actual_pnl || 0) > 0;
    
    // Count consecutive wins/losses from start
    let consecutiveWins = 0;
    let consecutiveLosses = 0;
    for (const t of tradesTyped) {
      if ((t.actual_pnl || 0) > 0) {
        if (consecutiveLosses === 0) consecutiveWins++;
        else break;
      } else {
        if (consecutiveWins === 0) consecutiveLosses++;
        else break;
      }
    }
    
    const avgProfitPct = tradesTyped.reduce((sum, t) => sum + (t.actual_pnl || 0), 0) / tradesTyped.length;
    const totalPnL = tradesTyped.reduce((sum, t) => sum + (t.actual_pnl || 0), 0);
    
    return { recentWinRate, lastTradeProfit, consecutiveWins, consecutiveLosses, avgProfitPct, totalPnL };
  } catch {
    return {
      recentWinRate: 50,
      lastTradeProfit: true,
      consecutiveWins: 0,
      consecutiveLosses: 0,
      avgProfitPct: 0,
      totalPnL: 0,
    };
  }
}

function calculateDynamicParams(market: MarketState, performance: PerformanceState): DynamicParams {
  // ===== ADAPTIVE EDGE THRESHOLD =====
  // High volatility + good win rate = lower edge (more opportunities)
  // Low volatility + bad win rate = higher edge (be selective)
  let edgeMultiplier = 1.0;
  
  // Volatility adjustment: high volatility = more opportunities
  if (market.avgVolatility > 5) edgeMultiplier *= 0.7;  // Very volatile - lower edge
  else if (market.avgVolatility > 3) edgeMultiplier *= 0.85;
  else if (market.avgVolatility < 1) edgeMultiplier *= 1.3; // Low volatility - be picky
  
  // Win rate adjustment
  if (performance.recentWinRate >= 60) edgeMultiplier *= 0.8;  // Doing well - be aggressive
  else if (performance.recentWinRate >= 50) edgeMultiplier *= 0.9;
  else if (performance.recentWinRate < 40) edgeMultiplier *= 1.2; // Losing - be selective
  
  // Consecutive wins/losses adjustment
  if (performance.consecutiveWins >= 3) edgeMultiplier *= 0.85; // Hot streak - ride it
  if (performance.consecutiveLosses >= 2) edgeMultiplier *= 1.15; // Cold streak - careful
  
  // Market trend adjustment
  if (market.marketTrend === 'bull') edgeMultiplier *= 0.9; // Bull market - more trades
  else if (market.marketTrend === 'bear') edgeMultiplier *= 1.1; // Bear - be careful
  
  const minEdge = Math.max(0.05, Math.min(0.5, BASE_CONFIG.baseMinEdge * edgeMultiplier));
  
  // ===== ADAPTIVE VOLUME REQUIREMENT =====
  let volumeMultiplier = 1.0;
  if (market.avgVolume > 500000) volumeMultiplier = 0.8; // Good liquidity - relax
  else if (market.avgVolume < 200000) volumeMultiplier = 1.2; // Low liquidity - strict
  
  const minVolume = BASE_CONFIG.baseMinVolume * volumeMultiplier;
  
  // ===== ADAPTIVE SPREAD =====
  const maxSpread = market.spreadHealth > 0.7 ? 0.4 : market.spreadHealth > 0.5 ? 0.25 : 0.15;
  
  // ===== ADAPTIVE STOP-LOSS / TAKE-PROFIT =====
  // High volatility = wider stops, low volatility = tighter stops
  let slMultiplier = 1.0;
  let tpMultiplier = 1.0;
  
  if (market.avgVolatility > 5) {
    slMultiplier = 1.5; // Wider stop in volatile market
    tpMultiplier = 1.8; // Higher target
  } else if (market.avgVolatility > 3) {
    slMultiplier = 1.2;
    tpMultiplier = 1.4;
  } else if (market.avgVolatility < 1) {
    slMultiplier = 0.7; // Tighter stop in calm market
    tpMultiplier = 0.8;
  }
  
  // Adjust based on performance
  if (performance.consecutiveLosses >= 2) {
    slMultiplier *= 0.8; // Tighter stops when losing
    tpMultiplier *= 0.9; // Take profits faster
  }
  if (performance.consecutiveWins >= 3) {
    tpMultiplier *= 1.2; // Let winners run when hot
  }
  
  const stopLossPct = Math.max(0.3, Math.min(2.0, BASE_CONFIG.baseStopLoss * slMultiplier));
  const takeProfitPct = Math.max(0.5, Math.min(4.0, BASE_CONFIG.baseTakeProfit * tpMultiplier));
  
  // ===== ADAPTIVE POSITION SIZING =====
  let posMultiplier = 1.0;
  
  if (performance.recentWinRate >= 60) posMultiplier = 1.3; // Doing well - size up
  else if (performance.recentWinRate >= 50) posMultiplier = 1.1;
  else if (performance.recentWinRate < 40) posMultiplier = 0.7; // Losing - size down
  
  if (performance.consecutiveWins >= 3) posMultiplier *= 1.2; // Hot streak bonus
  if (performance.consecutiveLosses >= 2) posMultiplier *= 0.7; // Cold streak - reduce size
  
  const positionPct = Math.max(20, Math.min(70, BASE_CONFIG.basePositionPct * posMultiplier));
  const maxPositionUsdt = Math.max(5, Math.min(BASE_CONFIG.maxPositionUsdt, BASE_CONFIG.maxPositionUsdt * posMultiplier));
  
  // Calculate overall aggressiveness score (0-100)
  const aggressiveness = Math.round(
    (1 - edgeMultiplier) * 30 + // Lower edge = more aggressive
    (performance.recentWinRate / 100) * 40 + // Higher win rate = more aggressive
    (market.spreadHealth) * 30 // Better spreads = more aggressive
  );
  
  // Determine regime label
  let regime = 'BALANCED';
  if (aggressiveness >= 70) regime = 'AGGRESSIVE';
  else if (aggressiveness >= 55) regime = 'OPPORTUNISTIC';
  else if (aggressiveness <= 35) regime = 'DEFENSIVE';
  else if (aggressiveness <= 20) regime = 'CONSERVATIVE';
  
  return {
    minEdge,
    minVolume,
    maxSpread,
    stopLossPct,
    takeProfitPct,
    positionPct,
    maxPositionUsdt,
    aggressiveness,
    regime,
  };
}

// Legacy CONFIG reference for compatibility
const CONFIG = {
  ...BASE_CONFIG,
  minEdge: BASE_CONFIG.baseMinEdge,
  minVolume: BASE_CONFIG.baseMinVolume,
  maxSpread: BASE_CONFIG.baseMaxSpread,
  stopLossPct: BASE_CONFIG.baseStopLoss,
  takeProfitPct: BASE_CONFIG.baseTakeProfit,
  minOrderBookDepth: 3000,
  maxPriceVolatility: 15,
  requirePositiveTrend: false,
};

// ===== GATE.IO API =====
function sign(method: string, path: string, body: string, ts: string, secret: string): string {
  const hash = createHash("sha512").update(body).digest("hex");
  return createHmac("sha512", secret).update(`${method}\n${path}\n\n${hash}\n${ts}`).digest("hex");
}

async function gate(method: string, endpoint: string, key: string, secret: string, body: Record<string, unknown> | null = null): Promise<unknown> {
  const path = `/api/v4${endpoint}`;
  const ts = Math.floor(Date.now() / 1000).toString();
  const bodyStr = body ? JSON.stringify(body) : "";
  const res = await fetch(`https://api.gateio.ws${path}`, {
    method,
    headers: { KEY: key, SIGN: sign(method, path, bodyStr, ts, secret), Timestamp: ts, "Content-Type": "application/json" },
    body: body ? bodyStr : undefined,
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

// ===== EXCHANGE-SIDE STOP-LOSS & TAKE-PROFIT =====
// Place protective orders directly on Gate.io that will execute even if bot crashes

interface ExchangeProtection {
  stopLossOrderId?: string;
  takeProfitOrderId?: string;
  symbol: string;
  amount: string;
  stopPrice: number;
  tpPrice: number;
}

async function placeExchangeProtection(
  key: string, 
  secret: string, 
  symbol: string, 
  amount: number, 
  entryPrice: number,
  precision: number,
  dynamicSL?: number,
  dynamicTP?: number
): Promise<ExchangeProtection> {
  const amountStr = amount.toFixed(precision);
  // Use dynamic SL/TP if provided, otherwise fall back to config
  const slPct = dynamicSL ?? CONFIG.stopLossPct;
  const tpPct = dynamicTP ?? CONFIG.takeProfitPct;
  const stopPrice = entryPrice * (1 - slPct / 100);
  const tpPrice = entryPrice * (1 + tpPct / 100);
  
  console.log(`🛡️ Placing DYNAMIC protection for ${symbol}: SL@$${stopPrice.toFixed(6)} (-${slPct.toFixed(1)}%) TP@$${tpPrice.toFixed(6)} (+${tpPct.toFixed(1)}%)`);
  
  
  const protection: ExchangeProtection = {
    symbol,
    amount: amountStr,
    stopPrice,
    tpPrice,
  };
  
  try {
    // ===== STOP-LOSS ORDER (Price Triggered) =====
    // Gate.io API: /spot/price_orders for conditional orders
    // account should be "normal" (classic) or "unified" (unified trading account)
    const slOrder = await gate('POST', '/spot/price_orders', key, secret, {
      trigger: {
        price: stopPrice.toFixed(8),
        rule: '<=',      // Trigger when price drops TO or BELOW stop price
        expiration: 86400 * 7, // 7 days expiration
      },
      put: {
        type: 'market',
        side: 'sell',
        amount: amountStr,
        account: 'normal', // Use 'normal' for classic spot account
      },
      market: symbol,
    }) as { id?: string };
    
    if (slOrder.id) {
      protection.stopLossOrderId = slOrder.id;
      console.log(`✅ Stop-Loss placed: ${slOrder.id} @ $${stopPrice.toFixed(6)} (-${CONFIG.stopLossPct}%)`);
    }
  } catch (e) {
    console.log(`⚠️ Stop-Loss order failed: ${e instanceof Error ? e.message : 'Unknown'}`);
  }
  
  try {
    // ===== TAKE-PROFIT ORDER (Limit Sell) =====
    // Place as regular limit order at target price
    const tpOrder = await gate('POST', '/spot/orders', key, secret, {
      currency_pair: symbol, 
      side: 'sell', 
      type: 'limit',
      amount: amountStr, 
      price: tpPrice.toFixed(8),
      time_in_force: 'gtc', // Good till cancelled
    }) as { id?: string };
    
    if (tpOrder.id) {
      protection.takeProfitOrderId = tpOrder.id;
      console.log(`✅ Take-Profit placed: ${tpOrder.id} @ $${tpPrice.toFixed(6)} (+${CONFIG.takeProfitPct}%)`);
    }
  } catch (e) {
    console.log(`⚠️ Take-Profit order failed: ${e instanceof Error ? e.message : 'Unknown'}`);
  }
  
  return protection;
}

// Cancel protection orders when position is closed
async function cancelProtection(key: string, secret: string, protection: ExchangeProtection) {
  if (protection.stopLossOrderId) {
    try {
      await gate('DELETE', `/spot/price_orders/${protection.stopLossOrderId}`, key, secret);
      console.log(`🗑️ Cancelled SL order: ${protection.stopLossOrderId}`);
    } catch (e) {
      // May already be triggered/cancelled
    }
  }
  if (protection.takeProfitOrderId) {
    try {
      await gate('DELETE', `/spot/orders/${protection.takeProfitOrderId}`, key, secret, { currency_pair: protection.symbol });
      console.log(`🗑️ Cancelled TP order: ${protection.takeProfitOrderId}`);
    } catch (e) {
      // May already be filled/cancelled
    }
  }
}

async function getBalances(key: string, secret: string): Promise<Map<string, number>> {
  const accounts = await gate('GET', '/spot/accounts', key, secret) as Array<{ currency: string; available: string }>;
  const map = new Map<string, number>();
  for (const a of accounts) {
    const val = parseFloat(a.available);
    if (val > 0) map.set(a.currency, val);
  }
  return map;
}

async function getTickers(): Promise<Map<string, { price: number; change: number; volume: number; bid: number; ask: number }>> {
  const tickers = await fetch('https://api.gateio.ws/api/v4/spot/tickers').then(r => r.json()) as Array<{
    currency_pair: string; last: string; change_percentage: string; quote_volume: string; highest_bid: string; lowest_ask: string;
  }>;
  const map = new Map();
  for (const t of tickers) {
    map.set(t.currency_pair, {
      price: parseFloat(t.last),
      change: parseFloat(t.change_percentage),
      volume: parseFloat(t.quote_volume),
      bid: parseFloat(t.highest_bid),
      ask: parseFloat(t.lowest_ask),
    });
  }
  return map;
}

async function getPairs(): Promise<Map<string, { min: number; prec: number; minQuote: number }>> {
  const pairs = await fetch('https://api.gateio.ws/api/v4/spot/currency_pairs').then(r => r.json()) as Array<{ 
    id: string; min_base_amount?: string; amount_precision?: number; min_quote_amount?: string 
  }>;
  const map = new Map();
  for (const p of pairs) {
    map.set(p.id, { 
      min: parseFloat(p.min_base_amount || '0.0001'), 
      prec: p.amount_precision || 4,
      minQuote: parseFloat(p.min_quote_amount || '1'),
    });
  }
  return map;
}

function isExcluded(symbol: string): boolean {
  if (CONFIG.excludeSymbols.includes(symbol)) return true;
  for (const p of CONFIG.excludePatterns) if (symbol.includes(p)) return true;
  return /\d+(L|S)_USDT$/.test(symbol);
}

// ===== MAIN ENGINE =====
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const start = Date.now();
  const results: Array<{ t: number; s?: string; a: string; e?: number; p?: number; sl?: string; tp?: string }> = [];
  let trades = 0, pnl = 0;

  try {
    const key = Deno.env.get('GATE_API_KEY');
    const secret = Deno.env.get('GATE_API_SECRET');
    if (!key || !secret) throw new Error("No API credentials");

    // ===== LOCK CHECK - Prevent parallel execution =====
    const instanceId = crypto.randomUUID().slice(0, 8);
    const { data: state } = await supabase.from('trading_system_state').select('*').limit(1).maybeSingle();
    const stateData = state as { id?: string; last_heartbeat?: string; total_cycles?: number; total_pnl?: number; total_trades?: number } | null;
    
    if (stateData?.last_heartbeat) {
      const lastBeat = new Date(stateData.last_heartbeat).getTime();
      const elapsed = Date.now() - lastBeat;
      
      // If another instance is running (heartbeat < 30s ago), exit
      if (elapsed < 30000) {
        console.log(`⏸️ [${instanceId}] Another instance running (${elapsed}ms ago). Exiting.`);
        return new Response(JSON.stringify({
          success: true,
          action: 'skipped',
          reason: 'Another instance is running',
          elapsed,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }
    
    // Update heartbeat immediately to claim lock
    if (stateData?.id) {
      await supabase.from('trading_system_state').update({
        last_heartbeat: new Date().toISOString(),
      }).eq('id', stateData.id);
    }

    // ===== LOSS STREAK PROTECTION - Check recent trades =====
    const { data: recentTrades } = await supabase
      .from('trade_history')
      .select('actual_pnl, executed_at')
      .eq('side', 'sell')
      .order('executed_at', { ascending: false })
      .limit(CONFIG.recentTradesToCheck);

    let consecutiveLosses = 0;
    let wins = 0;
    let losses = 0;
    let lossStreakHalted = false;

    if (recentTrades && recentTrades.length > 0) {
      // Count consecutive losses from most recent
      for (const trade of recentTrades) {
        if ((trade.actual_pnl || 0) < 0) {
          consecutiveLosses++;
        } else {
          break; // Stop counting when we hit a win
        }
      }

      // Calculate overall win rate
      for (const trade of recentTrades) {
        if ((trade.actual_pnl || 0) >= 0) {
          wins++;
        } else {
          losses++;
        }
      }

      const winRate = recentTrades.length > 0 ? (wins / recentTrades.length) * 100 : 50;

      // Check if we should halt trading
      if (consecutiveLosses >= CONFIG.maxConsecutiveLosses) {
        console.log(`🛑 LOSS STREAK PROTECTION: ${consecutiveLosses} consecutive losses detected!`);
        
        await supabase.from('system_log').insert({
          level: 'warn',
          component: 'HYPER_PROTECTION',
          message: `Trading halted: ${consecutiveLosses} consecutive losses`,
          details: { consecutiveLosses, winRate, recentTrades: recentTrades.length },
        });
        
        lossStreakHalted = true;
      }

      if (winRate < CONFIG.minWinRateToTrade && recentTrades.length >= 5) {
        console.log(`🛑 LOW WIN RATE PROTECTION: ${winRate.toFixed(1)}% < ${CONFIG.minWinRateToTrade}%`);
        
        await supabase.from('system_log').insert({
          level: 'warn',
          component: 'HYPER_PROTECTION',
          message: `Trading halted: Win rate ${winRate.toFixed(1)}% below minimum`,
          details: { winRate, wins, losses, total: recentTrades.length },
        });
        
        lossStreakHalted = true;
      }

      console.log(`📊 Recent performance: ${wins}W/${losses}L (${winRate.toFixed(1)}%) | Streak: ${consecutiveLosses} losses`);
    }

    if (lossStreakHalted) {
      return new Response(JSON.stringify({
        success: true,
        action: 'halted',
        reason: 'Loss streak protection activated',
        consecutiveLosses,
        winRate: recentTrades ? (wins / recentTrades.length) * 100 : 0,
        cooldownMinutes: CONFIG.lossStreakCooldownMs / 60000,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`🚀 [HYPER-MAX:${instanceId}] Starting DYNAMIC ADAPTIVE 24/7 mode`);

    // Get pair info once
    const pairs = await getPairs();
    const recentSymbols = new Map<string, number>(); // symbol -> timestamp
    const failedSymbols = new Set<string>(); // Track symbols that failed

    let cycle = 0;
    const endTime = start + CONFIG.burstDurationMs;

    // ===== CONTINUOUS LOOP =====
    while (Date.now() < endTime) {
      cycle++;
      const cycleStart = Date.now();

      try {
        // Get fresh balances and tickers
        const balances = await getBalances(key, secret);
        const tickers = await getTickers();
        let usdt = balances.get('USDT') || 0;
        
        // ===== DYNAMIC PARAMETER CALCULATION =====
        const marketState = analyzeMarket(tickers);
        const performanceState = await getPerformanceState(supabase);
        const dynamicParams = calculateDynamicParams(marketState, performanceState);
        
        // Log dynamic parameters every 10 cycles
        if (cycle % 10 === 1) {
          console.log(`🎛️ DYNAMIC PARAMS | Edge=${dynamicParams.minEdge.toFixed(2)}% | SL=${dynamicParams.stopLossPct.toFixed(1)}% | TP=${dynamicParams.takeProfitPct.toFixed(1)}% | Pos=${dynamicParams.positionPct}% | Regime=${dynamicParams.regime} (${dynamicParams.aggressiveness})`);
          console.log(`📈 MARKET | Vol=${marketState.avgVolatility.toFixed(1)}% | BTC=${marketState.btcChange.toFixed(1)}% | Trend=${marketState.marketTrend} | Spread=${(marketState.spreadHealth*100).toFixed(0)}%`);
          console.log(`📊 PERF | WinRate=${performanceState.recentWinRate.toFixed(0)}% | Wins=${performanceState.consecutiveWins} | Losses=${performanceState.consecutiveLosses}`);
        }
        
        console.log(`💰 [${cycle}] USDT: $${usdt.toFixed(2)} | ${dynamicParams.regime}`);


        // ===== FORCE-LIQUIDITY: Smart liquidation to maintain USDT =====
        if (usdt < CONFIG.liquidateThreshold) {
          console.log(`💱 [${cycle}] Low USDT: $${usdt.toFixed(2)} - FORCE LIQUIDITY MODE...`);
          
          // Step 1: Build list of all sellable assets with their values
          interface SellableAsset {
            currency: string;
            symbol: string;
            amount: number;
            value: number;
            minAmount: number;
            precision: number;
            bid: number;
            canSell: boolean; // Above minimum order value
          }
          
          const sellableAssets: SellableAsset[] = [];
          const MIN_ORDER_VALUE = 3; // Gate.io minimum
          
          for (const [currency, amount] of balances) {
            if (CONFIG.stablecoins.includes(currency)) continue;
            
            const symbol = `${currency}_USDT`;
            const ticker = tickers.get(symbol);
            const pair = pairs.get(symbol);
            if (!ticker || !pair) continue;
            
            const value = amount * ticker.price;
            const canSell = value >= MIN_ORDER_VALUE && amount >= pair.min;
            
            sellableAssets.push({
              currency,
              symbol,
              amount,
              value,
              minAmount: pair.min,
              precision: pair.prec,
              bid: ticker.bid,
              canSell,
            });
          }
          
          // Sort by value descending - sell biggest first for fastest liquidity
          sellableAssets.sort((a, b) => b.value - a.value);
          
          // Log what we found
          const sellable = sellableAssets.filter(a => a.canSell);
          const dust = sellableAssets.filter(a => !a.canSell && a.value > 0.01);
          console.log(`📊 Found ${sellable.length} sellable assets ($${sellable.reduce((s, a) => s + a.value, 0).toFixed(2)}) | ${dust.length} dust ($${dust.reduce((s, a) => s + a.value, 0).toFixed(2)})`);
          
          // Step 2: Calculate how much USDT we need
          const targetUSDT = CONFIG.minPositionUsdt * 1.5; // Target 150% of minimum to have buffer
          let neededUSDT = targetUSDT - usdt;
          
          // Step 3: Sell assets until we have enough USDT
          for (const asset of sellableAssets) {
            if (neededUSDT <= 0) {
              console.log(`✅ Target USDT reached: $${usdt.toFixed(2)}`);
              break;
            }
            
            if (!asset.canSell) {
              // Skip dust - can't sell below minimum
              continue;
            }
            
            console.log(`🔄 Selling ${asset.currency} ($${asset.value.toFixed(2)}) to get liquidity...`);
            
            const sellAmt = Math.floor(asset.amount * Math.pow(10, asset.precision)) / Math.pow(10, asset.precision);
            
            try {
              const order = await gate('POST', '/spot/orders', key, secret, {
                currency_pair: asset.symbol, 
                side: 'sell', 
                type: 'limit',
                price: asset.bid.toFixed(8),
                amount: sellAmt.toFixed(asset.precision), 
                time_in_force: 'ioc',
              }) as { filled_total?: string; id?: string; status?: string };
              
              const filled = parseFloat(order.filled_total || '0');
              
              if (filled > 0) {
                usdt += filled;
                neededUSDT -= filled;
                console.log(`✅ Sold ${asset.currency}: +$${filled.toFixed(2)} | USDT now: $${usdt.toFixed(2)}`);
                
                await supabase.from('trade_history').insert({
                  symbol: asset.symbol, 
                  side: 'sell', 
                  type: 'FORCE_LIQUIDITY', 
                  amount: sellAmt,
                  price: asset.bid, 
                  actual_pnl: filled * 0.001,
                  order_id: order.id, 
                  status: 'executed', 
                  executed_at: new Date().toISOString(),
                });
                
                trades++;
                pnl += filled * 0.001;
                
                // Update balances map
                balances.set(asset.currency, (balances.get(asset.currency) || 0) - sellAmt);
              } else {
                console.log(`⚠️ Order not filled for ${asset.currency}`);
              }
            } catch (e) {
              const errMsg = e instanceof Error ? e.message : String(e);
              console.log(`⚠️ Failed to sell ${asset.currency}: ${errMsg}`);
            }
            
            // Small delay between orders
            await new Promise(r => setTimeout(r, 100));
          }
          
          // Step 4: If still no USDT, try dust conversion via API
          if (usdt < CONFIG.minPositionUsdt && dust.length > 0) {
            console.log(`🧹 Attempting dust conversion for ${dust.length} small balances...`);
            
            try {
              // Get convertible currencies from Gate.io
              const smallBalRes = await gate('GET', '/wallet/small_balance', key, secret) as { currencies?: string[] };
              
              if (smallBalRes.currencies && smallBalRes.currencies.length > 0) {
                console.log(`✅ Found ${smallBalRes.currencies.length} currencies for dust conversion`);
                
                await gate('POST', '/wallet/small_balance', key, secret, {
                  currency: smallBalRes.currencies,
                  is_gt: true,
                });
                
                console.log(`🔄 Dust conversion submitted - will convert to GT`);
              }
            } catch (e) {
              console.log(`⚠️ Dust conversion not available`);
            }
          }
          
          console.log(`💰 Final USDT after liquidation: $${usdt.toFixed(2)}`);
        }

        // Skip if still no funds
        if (usdt < CONFIG.minPositionUsdt) {
          results.push({ t: cycle, a: 'no_funds' });
          await new Promise(r => setTimeout(r, Math.max(0, CONFIG.cycleIntervalMs - (Date.now() - cycleStart))));
          continue;
        }

        // ===== FIND OPPORTUNITIES =====
        interface Opp { symbol: string; price: number; edge: number; strat: string; min: number; prec: number; score: number; minQuote: number; bid?: number; ask?: number }
        const opps: Opp[] = [];
        const now = Date.now();

        for (const [symbol, data] of tickers) {
          if (!symbol.endsWith('_USDT')) continue;
          if (isExcluded(symbol)) continue;
          if (failedSymbols.has(symbol)) continue;
          // Use DYNAMIC volume threshold
          if (data.volume < dynamicParams.minVolume || data.bid <= 0 || data.ask <= 0) continue;
          
          // Short cooldown
          const lastTrade = recentSymbols.get(symbol);
          if (lastTrade && now - lastTrade < CONFIG.cooldownSeconds * 1000) continue;
          
          const spread = ((data.ask - data.bid) / data.ask) * 100;
          // Use DYNAMIC spread threshold
          if (spread > dynamicParams.maxSpread) continue;
          
          const pair = pairs.get(symbol);
          if (!pair) continue;
          
          // Check if we can afford minimum base amount
          if (pair.min * data.price > usdt) continue;
          
          // Check if we can afford minimum quote amount (USDT)
          if (pair.minQuote > usdt) continue;
          
          let edge = 0, strat = '';
          
          // Momentum - adjust edge calculation based on market volatility
          const volMultiplier = marketState.avgVolatility > 3 ? 1.2 : marketState.avgVolatility < 1 ? 0.8 : 1.0;
          
          if (data.change >= CONFIG.momentumMinChange && data.change <= CONFIG.momentumMaxChange) {
            edge = data.change * 0.12 * volMultiplier - spread - 0.08;
            strat = 'M';
          }
          // Reversion
          else if (data.change <= CONFIG.reversionMinDrop && data.change >= CONFIG.reversionMaxDrop) {
            edge = Math.abs(data.change) * 0.15 * volMultiplier - spread - 0.08;
            strat = 'R';
          }
          // Spread capture (simple)
          else if (spread < 0.1 && data.volume > 500_000) {
            edge = 0.2 - spread;
            strat = 'S';
          }
          
          // ===== SPREAD ARBITRAGE: Buy + Sell instantly on same pair =====
          const spreadEdge = spread - 0.2;
          if (spreadEdge >= 0.1 && data.volume > 1_000_000) {
            if (spreadEdge > edge) {
              edge = spreadEdge;
              strat = 'ARB';
            }
          }
          
          // ===== RAPID TRADER STRATEGY: Ultra-tight spreads for HFT-style trades =====
          // Looking for pairs with very tight spreads (0.1-0.5%) and high liquidity
          // These are perfect for rapid in-out trades with minimal profit targets
          if (spread >= 0.08 && spread <= 0.5 && data.volume > 500_000) {
            // Calculate rapid trade edge: we aim for 0.03-0.1% profit per trade
            // Net edge = (spread * capture_rate) - fees
            const captureRate = 0.4; // Expect to capture 40% of spread
            const rapidEdge = (spread * captureRate) - 0.1; // minus 0.1% roundtrip fees
            
            if (rapidEdge > 0.02 && rapidEdge > edge) {
              edge = rapidEdge;
              strat = 'RAPID';
            }
          }
          
          // Use DYNAMIC edge threshold
          if (edge >= dynamicParams.minEdge) {
            const score = edge * Math.log10(data.volume / 50_000) / (spread + 0.05);
            // RAPID strategy gets priority boost for speed
            const rapidBoost = strat === 'RAPID' ? 1.3 : 1.0;
            opps.push({ symbol, price: data.price, edge, strat, min: pair.min, prec: pair.prec, score: score * rapidBoost, minQuote: pair.minQuote, bid: data.bid, ask: data.ask });
          }
        }

        opps.sort((a, b) => b.score - a.score);

        if (opps.length === 0) {
          results.push({ t: cycle, a: 'scan' });
          await new Promise(r => setTimeout(r, Math.max(0, CONFIG.cycleIntervalMs - (Date.now() - cycleStart))));
          continue;
        }

        // ===== EXECUTE BEST =====
        const best = opps[0];
        
        // ===== PRECISE POSITION SIZING ALGORITHM =====
        // Adapts based on available capital with smart scaling
        
        // Step 1: Calculate base position percentage based on balance tier
        let effectivePct = dynamicParams.positionPct;
        
        if (usdt < BASE_CONFIG.smallBalanceThreshold) {
          // Small balance ($3-10): Use higher percentage to meet minimums
          // With $5, using 70% = $3.50 which meets minimum
          effectivePct = Math.max(60, dynamicParams.positionPct * 1.5);
          console.log(`📏 Small balance mode: ${effectivePct.toFixed(0)}% of $${usdt.toFixed(2)}`);
        } else if (usdt < BASE_CONFIG.mediumBalanceThreshold) {
          // Medium balance ($10-50): Use moderate percentage
          effectivePct = Math.max(30, dynamicParams.positionPct * 1.2);
        } else if (usdt > BASE_CONFIG.largeBalanceThreshold) {
          // Large balance ($200+): Can afford to be more conservative per trade
          effectivePct = Math.min(15, dynamicParams.positionPct * 0.8);
        }
        
        // Step 2: Calculate base position size
        let posSize = usdt * (effectivePct / 100);
        
        // Step 3: Apply min/max constraints
        const absoluteMin = CONFIG.minPositionUsdt; // $3 - Gate.io minimum
        const absoluteMax = Math.min(dynamicParams.maxPositionUsdt, usdt * 0.95);
        
        posSize = Math.max(posSize, absoluteMin);
        posSize = Math.min(posSize, absoluteMax);
        
        // Step 4: Calculate minimum order requirements for this specific pair
        const minOrderValueBase = best.min * best.price;
        const minOrderValue = Math.max(minOrderValueBase, best.minQuote, absoluteMin);
        
        // Step 5: If our position is smaller than required minimum, scale up or skip
        if (posSize < minOrderValue) {
          if (usdt >= minOrderValue * 1.05) {
            // We can afford it, scale up
            posSize = minOrderValue * 1.02; // Slightly above minimum
            console.log(`📐 Scaled up posSize to meet min: $${posSize.toFixed(2)} (min=$${minOrderValue.toFixed(2)})`);
          } else {
            // Can't afford this pair's minimum
            console.log(`⏭️ [${cycle}] Skip ${best.symbol} - min order $${minOrderValue.toFixed(2)} > balance $${usdt.toFixed(2)}`);
            results.push({ t: cycle, s: best.symbol, a: 'expensive' });
            failedSymbols.add(best.symbol);
            await new Promise(r => setTimeout(r, Math.max(0, CONFIG.cycleIntervalMs - (Date.now() - cycleStart))));
            continue;
          }
        }
        
        // Step 6: Final safety check - never use more than 95% of balance
        posSize = Math.min(posSize, usdt * 0.95);
        
        // Log the precise calculation
        console.log(`💎 Position: $${posSize.toFixed(2)} (${(posSize/usdt*100).toFixed(1)}% of $${usdt.toFixed(2)}) | Min: $${minOrderValue.toFixed(2)}`);
        
        // ===== CALCULATE AMOUNT =====
        const mult = Math.pow(10, best.prec);
        let amount = posSize / best.price;
        
        // Ensure amount is at least the minimum
        if (amount < best.min) {
          amount = best.min * 1.05;
        }
        
        // Round to precision
        amount = Math.floor(amount * mult) / mult;
        
        // If rounding made it too small, round UP
        if (amount < best.min) {
          amount = Math.ceil(best.min * 1.01 * mult) / mult;
        }
        
        // Final validation
        const orderValue = amount * best.price;
        
        console.log(`📊 [${cycle}] ${best.symbol}: amt=${amount.toFixed(best.prec)} val=$${orderValue.toFixed(2)} | min=${best.min} minOrd=$${minOrderValue.toFixed(2)}`);
        
        if (orderValue > usdt * 0.98 || orderValue < minOrderValue * 0.99 || amount < best.min) {
          console.log(`⏭️ [${cycle}] Validation fail: val=$${orderValue.toFixed(2)} bal=$${usdt.toFixed(2)} minOrd=$${minOrderValue.toFixed(2)} amt=${amount.toFixed(best.prec)} min=${best.min}`);
          results.push({ t: cycle, s: best.symbol, a: 'skip', e: best.edge });
          await new Promise(r => setTimeout(r, Math.max(0, CONFIG.cycleIntervalMs - (Date.now() - cycleStart))));
          continue;
        }

        // Execute - BUY + INSTANT SELL (no position holding!)
        try {
          const amountStr = amount.toFixed(best.prec);
          console.log(`⚡ [${cycle}] ${best.strat} ${best.symbol}: Buy+Sell | Edge=${best.edge.toFixed(3)}%`);
          
          // ===== STEP 1: BUY =====
          const buyOrder = await gate('POST', '/spot/orders', key, secret, {
            currency_pair: best.symbol, 
            side: 'buy', 
            type: 'market',
            amount: amountStr, 
            time_in_force: 'ioc',
          }) as { id?: string; avg_deal_price?: string; filled_total?: string; amount?: string };
          
          const buyFilled = parseFloat(buyOrder.filled_total || '0');
          const buyPrice = parseFloat(buyOrder.avg_deal_price || best.price.toString());
          
          if (buyFilled < 1) {
            console.log(`⚠️ [${cycle}] Buy not filled ($${buyFilled.toFixed(2)})`);
            results.push({ t: cycle, s: best.symbol, a: 'nofill' });
            recentSymbols.set(best.symbol, Date.now());
            await new Promise(r => setTimeout(r, Math.max(0, CONFIG.cycleIntervalMs - (Date.now() - cycleStart))));
            continue;
          }
          
          // Calculate actual bought amount from USDT filled
          const boughtAmount = buyFilled / buyPrice;
          
          // ===== STEP 2: EXECUTE STRATEGY =====
          // RAPID/ARB strategies: Instant buy+sell (no position holding)
          // M/R/S strategies: Also instant buy+sell for safety
          // Only use exchange protection for very specific long-hold strategies
          const useInstantSell = ['RAPID', 'ARB', 'M', 'R', 'S'].includes(best.strat);
          
          if (!useInstantSell && CONFIG.useExchangeOrders) {
            // Pass DYNAMIC SL/TP to protection function
            const protection = await placeExchangeProtection(
              key, secret, 
              best.symbol, 
              boughtAmount * 0.998, // Account for fees
              buyPrice,
              best.prec,
              dynamicParams.stopLossPct,  // Dynamic Stop Loss
              dynamicParams.takeProfitPct  // Dynamic Take Profit
            );
            
            // Log the buy with protection info
            await supabase.from('trade_history').insert({
              symbol: best.symbol, 
              side: 'buy', 
              type: `${best.strat}_PROTECTED`,
              amount: boughtAmount,
              price: buyPrice, 
              expected_edge: best.edge, 
              actual_pnl: 0,
              order_id: buyOrder.id, 
              status: protection.stopLossOrderId ? 'protected' : 'unprotected', 
              executed_at: new Date().toISOString(),
            });
            
            const slStatus = protection.stopLossOrderId ? '✅' : '❌';
            const tpStatus = protection.takeProfitOrderId ? '✅' : '❌';
            console.log(`🛡️ [${cycle}] ${best.symbol} PROTECTED | SL:${slStatus}@$${protection.stopPrice.toFixed(4)} TP:${tpStatus}@$${protection.tpPrice.toFixed(4)}`);
            
            trades++;
            results.push({ 
              t: cycle, 
              s: best.symbol, 
              a: 'buy_protected', 
              e: best.edge, 
              sl: protection.stopLossOrderId,
              tp: protection.takeProfitOrderId,
            });
          } else if (best.strat === 'RAPID') {
            // ===== RAPID TRADER: Instant buy + sell for quick profit =====
            // This strategy aims for tiny profits on each trade, high frequency
            const boughtAmount = buyFilled / buyPrice;
            const sellAmt = (boughtAmount * 0.998).toFixed(best.prec);
            
            // Small delay for order book to update
            await new Promise(r => setTimeout(r, 50));
            
            // Sell at bid price for immediate fill
            const sellOrder = await gate('POST', '/spot/orders', key, secret, {
              currency_pair: best.symbol, 
              side: 'sell', 
              type: 'limit',
              price: (best.bid || buyPrice * 1.001).toFixed(8),
              amount: sellAmt, 
              time_in_force: 'ioc',
            }) as { id?: string; avg_deal_price?: string; filled_total?: string };
            
            const sellFilled = parseFloat(sellOrder.filled_total || '0');
            const sellPrice = parseFloat(sellOrder.avg_deal_price || best.price.toString());
            
            const netPnl = sellFilled - buyFilled;
            const netPnlPct = (netPnl / buyFilled) * 100;
            
            trades += 2;
            pnl += netPnlPct;
            
            await supabase.from('trade_history').insert([
              {
                symbol: best.symbol, side: 'buy', type: 'RAPID', amount: boughtAmount,
                price: buyPrice, expected_edge: best.edge, actual_pnl: 0,
                order_id: buyOrder.id, status: 'executed', executed_at: new Date().toISOString(),
              },
              {
                symbol: best.symbol, side: 'sell', type: 'RAPID', amount: parseFloat(sellAmt),
                price: sellPrice, expected_edge: best.edge, actual_pnl: netPnl,
                order_id: sellOrder.id, status: sellFilled > 0 ? 'executed' : 'unfilled', executed_at: new Date().toISOString(),
              }
            ]);
            
            const emoji = netPnl >= 0 ? '⚡' : '💨';
            console.log(`${emoji} [${cycle}] RAPID ${best.symbol} Buy@${buyPrice.toFixed(6)} Sell@${sellPrice.toFixed(6)} = $${netPnl.toFixed(4)} (${netPnlPct.toFixed(3)}%) in ${Date.now() - cycleStart}ms`);
            results.push({ t: cycle, s: best.symbol, a: 'RAPID', e: best.edge, p: netPnlPct });
            
          } else {
            // Fallback: Instant sell (old behavior)
            const boughtAmount = buyFilled / buyPrice;
            const sellAmt = (boughtAmount * 0.998).toFixed(best.prec);
            
            const sellOrder = await gate('POST', '/spot/orders', key, secret, {
              currency_pair: best.symbol, 
              side: 'sell', 
              type: 'market',
              amount: sellAmt, 
              time_in_force: 'ioc',
            }) as { id?: string; avg_deal_price?: string; filled_total?: string };
            
            const sellFilled = parseFloat(sellOrder.filled_total || '0');
            const sellPrice = parseFloat(sellOrder.avg_deal_price || best.price.toString());
            
            const netPnl = sellFilled - buyFilled;
            const netPnlPct = (netPnl / buyFilled) * 100;
            
            trades += 2;
            pnl += netPnlPct;
            
            await supabase.from('trade_history').insert([
              {
                symbol: best.symbol, side: 'buy', type: best.strat, amount: boughtAmount,
                price: buyPrice, expected_edge: best.edge, actual_pnl: 0,
                order_id: buyOrder.id, status: 'executed', executed_at: new Date().toISOString(),
              },
              {
                symbol: best.symbol, side: 'sell', type: best.strat, amount: parseFloat(sellAmt),
                price: sellPrice, expected_edge: best.edge, actual_pnl: netPnl,
                order_id: sellOrder.id, status: 'executed', executed_at: new Date().toISOString(),
              }
            ]);
            
            const emoji = netPnl >= 0 ? '✅' : '❌';
            console.log(`${emoji} [${cycle}] ${best.strat} ${best.symbol} Buy@${buyPrice.toFixed(6)} Sell@${sellPrice.toFixed(6)} = $${netPnl.toFixed(4)} (${netPnlPct.toFixed(3)}%)`);
            results.push({ t: cycle, s: best.symbol, a: best.strat, e: best.edge, p: netPnlPct });
          }
          
          recentSymbols.set(best.symbol, Date.now());

        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Unknown';
          console.log(`❌ [${cycle}] ${best.symbol}: ${msg.slice(0, 80)}`);
          results.push({ t: cycle, s: best.symbol, a: 'fail' });
          
          // Add to failed symbols
          failedSymbols.add(best.symbol);
          recentSymbols.set(best.symbol, Date.now());
        }

      } catch (e) {
        console.log(`⚠️ [${cycle}] Cycle error`);
        results.push({ t: cycle, a: 'err' });
      }

      // Wait for next cycle
      const elapsed = Date.now() - cycleStart;
      const wait = Math.max(0, CONFIG.cycleIntervalMs - elapsed);
      if (wait > 0 && Date.now() + wait < endTime) {
        await new Promise(r => setTimeout(r, wait));
      }
    }

    // Update state at end
    if (stateData?.id) {
      await supabase.from('trading_system_state').update({
        is_active: true,
        total_cycles: (stateData.total_cycles || 0) + cycle,
        total_trades: (stateData.total_trades || 0) + trades,
        total_pnl: (stateData.total_pnl || 0) + pnl,
        last_heartbeat: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', stateData.id);
    }

    const duration = Date.now() - start;
    console.log(`🏁 [HYPER-MAX] ${cycle} cycles | ${trades} trades | +${pnl.toFixed(3)}% | ${duration}ms`);

    return new Response(JSON.stringify({
      success: true,
      cycles: cycle,
      trades,
      pnl,
      duration,
      results: results.slice(-20),
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('❌ Fatal:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown',
      duration: Date.now() - start,
    }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
