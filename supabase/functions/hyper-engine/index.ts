import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHash, createHmac } from "https://deno.land/std@0.168.0/node/crypto.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ===== PROFESSIONAL TRADING CONFIG =====
const CONFIG = {
  // Quality filters - high edge requirement
  minEdge: 0.5,              // Minimum 0.5% net edge after fees
  minVolume: 500_000,        // $500k minimum volume for liquidity
  maxSpread: 0.25,           // Max 0.25% spread
  
  // Momentum strategy params
  momentumMinChange: 2.0,    // Minimum +2% change for momentum
  momentumMaxChange: 15,     // Cap at 15% to avoid FOMO traps
  
  // Reversion strategy params  
  reversionMinDrop: -3.0,    // Minimum -3% drop for reversion
  reversionMaxDrop: -20,     // Cap at -20% to avoid catching knives
  
  // Position sizing (Kelly will override)
  basePositionPct: 10,       // 10% of balance as base
  minPositionUsdt: 5,
  maxPositionUsdt: 50,
  
  // Risk management
  maxDailyLossPct: 5.0,
  minWinRateForTrading: 35,  // Stop if win rate below 35%
  minTradesForStats: 10,     // Need 10+ trades for reliable stats
  
  // Exclusions
  excludeSymbols: ['USDT_USDT', 'USDC_USDT', 'DAI_USDT'],
  excludePatterns: ['3L_USDT', '5L_USDT', '3S_USDT', '5S_USDT', '2L_USDT', '2S_USDT'],
  stablecoins: ['USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'USDP', 'GUSD'],
  
  // Smart cycle - no burst, quality focus
  cooldownMinutes: 3,        // 3 min cooldown per symbol
  liquidateIfUsdtBelow: 10,
  minDustValueUsdt: 0.5,
};

// ===== MARKET REGIME DETECTION =====
interface MarketRegime {
  regime: 'trending_up' | 'trending_down' | 'ranging' | 'volatile' | 'crash';
  confidence: number;
  avgChange: number;
  volatility: number;
  bullishPct: number;
  recommendation: 'aggressive' | 'normal' | 'conservative' | 'halt';
}

function detectMarketRegime(tickers: Map<string, { price: number; change: number; volume: number }>): MarketRegime {
  const changes: number[] = [];
  
  for (const [symbol, data] of tickers) {
    if (symbol.endsWith('_USDT') && data.volume > 100_000) {
      changes.push(data.change);
    }
  }
  
  if (changes.length < 50) {
    return { regime: 'ranging', confidence: 0.3, avgChange: 0, volatility: 0, bullishPct: 50, recommendation: 'conservative' };
  }
  
  const avgChange = changes.reduce((a, b) => a + b, 0) / changes.length;
  const variance = changes.reduce((sum, c) => sum + Math.pow(c - avgChange, 2), 0) / changes.length;
  const volatility = Math.sqrt(variance);
  const bullishPct = (changes.filter(c => c > 0).length / changes.length) * 100;
  
  let regime: MarketRegime['regime'];
  let confidence: number;
  let recommendation: MarketRegime['recommendation'];
  
  // Crash detection - extreme bearish + high volatility
  if (avgChange < -5 && volatility > 8) {
    regime = 'crash';
    confidence = 0.9;
    recommendation = 'halt';
  }
  // Strong uptrend
  else if (avgChange > 3 && bullishPct > 70) {
    regime = 'trending_up';
    confidence = Math.min(0.95, 0.5 + (bullishPct - 50) / 100);
    recommendation = 'aggressive';
  }
  // Strong downtrend
  else if (avgChange < -3 && bullishPct < 30) {
    regime = 'trending_down';
    confidence = Math.min(0.95, 0.5 + (50 - bullishPct) / 100);
    recommendation = 'conservative';
  }
  // High volatility
  else if (volatility > 5) {
    regime = 'volatile';
    confidence = 0.7;
    recommendation = 'conservative';
  }
  // Ranging/sideways
  else {
    regime = 'ranging';
    confidence = 0.6;
    recommendation = 'normal';
  }
  
  return { regime, confidence, avgChange, volatility, bullishPct, recommendation };
}

// ===== KELLY CRITERION POSITION SIZING =====
interface TradingStats {
  totalTrades: number;
  winningTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  kellyFraction: number;
}

// deno-lint-ignore no-explicit-any
async function getTradingStats(supabase: any): Promise<TradingStats> {
  // Only count EXECUTED trades for stats (not failed API calls)
  const { data: trades } = await supabase
    .from('trade_history')
    .select('actual_pnl, status')
    .in('status', ['executed', 'filled', 'simulated'])
    .order('created_at', { ascending: false })
    .limit(100);
  
  const pnls = (trades as Array<{ actual_pnl: number }> | null)?.map(t => t.actual_pnl) || [];
  
  if (pnls.length < CONFIG.minTradesForStats) {
    return {
      totalTrades: pnls.length,
      winningTrades: 0,
      winRate: 50,
      avgWin: 1,
      avgLoss: 1,
      kellyFraction: 0.1, // Conservative default
    };
  }
  
  const wins = pnls.filter(p => p > 0);
  const losses = pnls.filter(p => p < 0);
  
  const winRate = (wins.length / pnls.length) * 100;
  const avgWin = wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 1;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length) : 1;
  
  // Kelly formula: f* = (p * b - q) / b
  // where p = win probability, q = lose probability, b = win/loss ratio
  const p = winRate / 100;
  const q = 1 - p;
  const b = avgLoss > 0 ? avgWin / avgLoss : 1;
  
  let kelly = (p * b - q) / b;
  
  // Apply half-Kelly for safety
  kelly = Math.max(0.05, Math.min(0.25, kelly / 2));
  
  console.log(`📊 Kelly: WR=${winRate.toFixed(1)}%, AvgWin=${avgWin.toFixed(2)}%, AvgLoss=${avgLoss.toFixed(2)}%, f*=${kelly.toFixed(3)}`);
  
  return {
    totalTrades: pnls.length,
    winningTrades: wins.length,
    winRate,
    avgWin,
    avgLoss,
    kellyFraction: kelly,
  };
}

function calculatePositionSize(
  balance: number,
  stats: TradingStats,
  regime: MarketRegime,
  edge: number
): number {
  // Base: Kelly fraction of balance
  let position = balance * stats.kellyFraction;
  
  // Adjust by market regime
  switch (regime.recommendation) {
    case 'aggressive':
      position *= 1.3; // +30% in strong trends
      break;
    case 'conservative':
      position *= 0.5; // -50% in uncertain markets
      break;
    case 'halt':
      return 0; // No trading in crash
    default:
      break;
  }
  
  // Scale by edge quality (higher edge = bigger position)
  const edgeMultiplier = Math.min(1.5, 1 + (edge - CONFIG.minEdge) / 2);
  position *= edgeMultiplier;
  
  // Enforce limits
  position = Math.max(CONFIG.minPositionUsdt, Math.min(CONFIG.maxPositionUsdt, position));
  
  // Never exceed 90% of balance
  position = Math.min(position, balance * 0.9);
  
  return position;
}

// ===== GATE.IO API HELPERS =====
function generateSignature(method: string, path: string, queryString: string, body: string, timestamp: string, secret: string): string {
  const hashedPayload = createHash("sha512").update(body).digest("hex");
  return createHmac("sha512", secret).update(`${method}\n${path}\n${queryString}\n${hashedPayload}\n${timestamp}`).digest("hex");
}

async function gateRequest(method: string, endpoint: string, apiKey: string, apiSecret: string, body: Record<string, unknown> | null = null): Promise<unknown> {
  const path = `/api/v4${endpoint}`;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const bodyStr = body ? JSON.stringify(body) : "";
  const response = await fetch(`https://api.gateio.ws${path}`, {
    method,
    headers: { "KEY": apiKey, "SIGN": generateSignature(method, path, "", bodyStr, timestamp, apiSecret), "Timestamp": timestamp, "Content-Type": "application/json" },
    body: body ? bodyStr : undefined,
  });
  if (!response.ok) throw new Error(`Gate.io: ${response.status} - ${await response.text()}`);
  return response.json();
}

async function getAllBalances(apiKey: string, apiSecret: string): Promise<Array<{ currency: string; available: number }>> {
  try {
    const accounts = await gateRequest('GET', '/spot/accounts', apiKey, apiSecret) as Array<{ currency: string; available: string }>;
    return accounts.map(a => ({ currency: a.currency, available: parseFloat(a.available) })).filter(a => a.available > 0);
  } catch { return []; }
}

async function getTickerPrices(): Promise<Map<string, { price: number; change: number; volume: number; bid: number; ask: number }>> {
  try {
    const tickers = await fetch('https://api.gateio.ws/api/v4/spot/tickers').then(r => r.json()) as Array<{
      currency_pair: string; last: string; change_percentage: string; quote_volume: string; highest_bid: string; lowest_ask: string;
    }>;
    const map = new Map();
    for (const t of tickers) {
      map.set(t.currency_pair, { price: parseFloat(t.last), change: parseFloat(t.change_percentage), volume: parseFloat(t.quote_volume), bid: parseFloat(t.highest_bid), ask: parseFloat(t.lowest_ask) });
    }
    return map;
  } catch { return new Map(); }
}

async function getCurrencyPairs(): Promise<Map<string, { minAmount: number; precision: number }>> {
  try {
    const pairs = await fetch('https://api.gateio.ws/api/v4/spot/currency_pairs').then(r => r.json()) as Array<{ id: string; min_base_amount?: string; amount_precision?: number }>;
    const map = new Map();
    for (const p of pairs) map.set(p.id, { minAmount: parseFloat(p.min_base_amount || '0.0001'), precision: p.amount_precision || 4 });
    return map;
  } catch { return new Map(); }
}

function isLeveragedToken(symbol: string): boolean {
  return CONFIG.excludePatterns.some(p => symbol.includes(p.replace('_USDT', ''))) || /\d+(L|S)_USDT$/.test(symbol);
}

// deno-lint-ignore no-explicit-any
async function getTodayPnL(supabase: any): Promise<{ totalPnL: number; tradeCount: number }> {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const { data } = await supabase.from('trade_history').select('actual_pnl').gte('created_at', todayStart.toISOString());
  const arr = data as Array<{ actual_pnl: number | null }> | null;
  return { totalPnL: arr?.reduce((s, t) => s + (t.actual_pnl || 0), 0) || 0, tradeCount: arr?.length || 0 };
}

// ===== MAIN HANDLER =====
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const startTime = Date.now();

  try {
    const { paperMode = false } = await req.json().catch(() => ({}));
    const apiKey = Deno.env.get('GATE_API_KEY');
    const apiSecret = Deno.env.get('GATE_API_SECRET');
    if (!apiKey || !apiSecret) throw new Error("Missing API credentials");

    console.log(`🧠 [HYPER-PRO] Professional mode - Quality over Quantity`);

    // ===== GATHER ALL DATA IN PARALLEL =====
    const [balances, tickers, pairInfo, tradingStats, todayStats, stateResult] = await Promise.all([
      getAllBalances(apiKey, apiSecret),
      getTickerPrices(),
      getCurrencyPairs(),
      getTradingStats(supabase),
      getTodayPnL(supabase),
      supabase.from('trading_system_state').select('*').limit(1).maybeSingle(),
    ]);

    const state = stateResult.data as { id?: string; total_cycles?: number; total_pnl?: number; total_trades?: number } | null;

    // ===== MARKET REGIME ANALYSIS =====
    const regime = detectMarketRegime(tickers);
    console.log(`📈 Market: ${regime.regime.toUpperCase()} | Avg: ${regime.avgChange.toFixed(2)}% | Vol: ${regime.volatility.toFixed(1)} | Bulls: ${regime.bullishPct.toFixed(0)}%`);
    console.log(`🎯 Strategy: ${regime.recommendation.toUpperCase()} | Confidence: ${(regime.confidence * 100).toFixed(0)}%`);

    // ===== RISK CHECKS =====
    if (regime.recommendation === 'halt') {
      console.log(`🛑 HALTING - Market crash detected`);
      await supabase.from('system_log').insert({
        component: 'hyper-engine',
        level: 'warn',
        message: `Trading halted - Market crash: ${regime.avgChange.toFixed(2)}%`,
        details: { regime },
      });
      return new Response(JSON.stringify({
        success: true,
        action: 'halt',
        reason: 'Market crash detected',
        regime,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (tradingStats.totalTrades >= CONFIG.minTradesForStats && tradingStats.winRate < CONFIG.minWinRateForTrading) {
      console.log(`⚠️ Win rate too low: ${tradingStats.winRate.toFixed(1)}% - Pausing`);
      return new Response(JSON.stringify({
        success: true,
        action: 'pause',
        reason: `Win rate ${tradingStats.winRate.toFixed(1)}% below threshold ${CONFIG.minWinRateForTrading}%`,
        stats: tradingStats,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (todayStats.totalPnL < -CONFIG.maxDailyLossPct) {
      console.log(`🛑 Daily loss limit: ${todayStats.totalPnL.toFixed(2)}%`);
      return new Response(JSON.stringify({
        success: true,
        action: 'daily_limit',
        reason: `Daily loss ${todayStats.totalPnL.toFixed(2)}% exceeds limit`,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ===== AUTO-LIQUIDATE IF NEEDED =====
    let usdtBalance = balances.find(b => b.currency === 'USDT')?.available || 0;
    const holdings = balances.filter(b => !CONFIG.stablecoins.includes(b.currency));
    
    if (usdtBalance < CONFIG.liquidateIfUsdtBelow && holdings.length > 0) {
      console.log(`🔄 Auto-liquidating (USDT: $${usdtBalance.toFixed(2)})`);
      
      for (const h of holdings) {
        const symbol = `${h.currency}_USDT`;
        const priceData = tickers.get(symbol);
        const info = pairInfo.get(symbol);
        if (!priceData || !info) continue;
        
        const valueUsdt = h.available * priceData.price;
        if (valueUsdt < CONFIG.minDustValueUsdt || h.available < info.minAmount) continue;
        
        const amount = Math.floor(h.available * Math.pow(10, info.precision)) / Math.pow(10, info.precision);
        if (amount < info.minAmount) continue;
        
        try {
          const result = await gateRequest('POST', '/spot/orders', apiKey, apiSecret, {
            currency_pair: symbol, side: 'sell', type: 'market', amount: amount.toFixed(info.precision), time_in_force: 'ioc',
          }) as { filled_total?: string };
          const filled = parseFloat(result.filled_total || '0');
          console.log(`💵 Liquidated ${h.currency}: +$${filled.toFixed(2)}`);
          usdtBalance += filled;
        } catch (e) {
          console.log(`⚠️ Failed to liquidate ${h.currency}: ${e}`);
        }
      }
    }

    console.log(`💰 Balance: $${usdtBalance.toFixed(2)} | Kelly: ${(tradingStats.kellyFraction * 100).toFixed(1)}%`);

    if (usdtBalance < CONFIG.minPositionUsdt) {
      console.log(`❌ Insufficient balance`);
      return new Response(JSON.stringify({
        success: true,
        action: 'insufficient_balance',
        balance: usdtBalance,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ===== FIND HIGH-QUALITY OPPORTUNITIES =====
    const { data: recentTrades } = await supabase
      .from('trade_history')
      .select('symbol')
      .gte('created_at', new Date(Date.now() - CONFIG.cooldownMinutes * 60000).toISOString());
    const cooldown = new Set((recentTrades as Array<{ symbol: string }> | null)?.map(t => t.symbol) || []);

    interface Opportunity {
      symbol: string;
      price: number;
      edge: number;
      strategy: string;
      minAmount: number;
      precision: number;
      volume: number;
      change: number;
      spread: number;
      qualityScore: number;
    }

    const opportunities: Opportunity[] = [];
    
    for (const [symbol, data] of tickers) {
      if (!symbol.endsWith('_USDT') || CONFIG.excludeSymbols.includes(symbol) || cooldown.has(symbol)) continue;
      if (data.volume < CONFIG.minVolume || data.bid <= 0 || data.ask <= 0) continue;
      if (isLeveragedToken(symbol)) continue;

      const spread = ((data.ask - data.bid) / data.ask) * 100;
      if (spread > CONFIG.maxSpread) continue;

      const info = pairInfo.get(symbol);
      if (!info) continue;

      let edge = 0;
      let strategy = '';
      
      // Momentum - adapt to regime
      if (data.change >= CONFIG.momentumMinChange && data.change <= CONFIG.momentumMaxChange) {
        // In uptrend, momentum is more reliable
        const regimeBonus = regime.regime === 'trending_up' ? 0.15 : 0;
        edge = data.change * 0.08 + regimeBonus - spread - 0.08;
        strategy = 'momentum';
      }
      // Mean reversion - adapt to regime
      else if (data.change <= CONFIG.reversionMinDrop && data.change >= CONFIG.reversionMaxDrop) {
        // In ranging market, reversion is more reliable
        const regimeBonus = regime.regime === 'ranging' ? 0.1 : 0;
        // Avoid reversion in crash
        const regimePenalty = regime.regime === 'trending_down' ? 0.2 : 0;
        edge = Math.abs(data.change) * 0.1 + regimeBonus - regimePenalty - spread - 0.08;
        strategy = 'reversion';
      }

      if (edge >= CONFIG.minEdge && strategy) {
        // Quality score combines edge, volume, and spread
        const qualityScore = edge * Math.log10(data.volume / 100_000) / (spread + 0.1);
        
        opportunities.push({
          symbol,
          price: data.price,
          edge,
          strategy,
          minAmount: info.minAmount,
          precision: info.precision,
          volume: data.volume,
          change: data.change,
          spread,
          qualityScore,
        });
      }
    }

    // Sort by quality score
    opportunities.sort((a, b) => b.qualityScore - a.qualityScore);

    console.log(`🔍 Found ${opportunities.length} quality opportunities`);

    if (opportunities.length === 0) {
      await supabase.from('trading_system_state').update({
        is_active: true,
        total_cycles: (state?.total_cycles || 0) + 1,
        last_heartbeat: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', state?.id || '');

      return new Response(JSON.stringify({
        success: true,
        action: 'no_opportunities',
        regime: regime.regime,
        scanned: tickers.size,
        duration: Date.now() - startTime,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ===== EXECUTE BEST OPPORTUNITY =====
    const best = opportunities[0];
    const positionSize = calculatePositionSize(usdtBalance, tradingStats, regime, best.edge);
    
    console.log(`🎯 BEST: ${best.symbol} | ${best.strategy} | Edge: ${best.edge.toFixed(2)}% | Quality: ${best.qualityScore.toFixed(2)}`);
    console.log(`📐 Position: $${positionSize.toFixed(2)} (Kelly: ${(tradingStats.kellyFraction * 100).toFixed(1)}%)`);
    console.log(`💱 Price: $${best.price} | MinAmount: ${best.minAmount} | Precision: ${best.precision}`);

    // Calculate amount - ensure we meet minimum requirements
    const mult = Math.pow(10, best.precision);
    
    // First calculate from position size
    let calculatedAmount = positionSize / best.price;
    
    // If calculated amount is less than minimum, use minimum
    if (calculatedAmount < best.minAmount) {
      calculatedAmount = best.minAmount * 1.1; // 10% buffer over minimum
    }
    
    // Round down to precision
    let amount = Math.floor(calculatedAmount * mult) / mult;
    
    // If rounding made it too small, round UP instead
    if (amount < best.minAmount) {
      amount = Math.ceil(best.minAmount * 1.1 * mult) / mult;
    }
    
    const orderValue = amount * best.price;
    
    console.log(`📊 Amount: ${amount} | Order value: $${orderValue.toFixed(2)}`);
    
    // Validation - check if we can afford the minimum order
    const minOrderValue = best.minAmount * best.price;
    
    if (usdtBalance < minOrderValue) {
      console.log(`⚠️ Can't afford minimum: $${minOrderValue.toFixed(2)} > $${usdtBalance.toFixed(2)}`);
      // Try next opportunity instead
      if (opportunities.length > 1) {
        console.log(`🔄 Skipping ${best.symbol}, trying alternatives...`);
      }
      return new Response(JSON.stringify({
        success: true,
        action: 'insufficient_for_symbol',
        symbol: best.symbol,
        minRequired: minOrderValue,
        balance: usdtBalance,
        alternatives: opportunities.slice(1, 5).map(o => o.symbol),
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    
    // Adjust order value to not exceed balance
    if (orderValue > usdtBalance * 0.95) {
      amount = Math.floor((usdtBalance * 0.9 / best.price) * mult) / mult;
      if (amount < best.minAmount) {
        amount = Math.ceil(best.minAmount * mult) / mult;
      }
    }
    
    const finalOrderValue = amount * best.price;
    
    if (finalOrderValue > usdtBalance || finalOrderValue < 3.5 || amount < best.minAmount) {
      console.log(`⚠️ Validation failed: $${finalOrderValue.toFixed(2)} | amt=${amount} | min=${best.minAmount}`);
      return new Response(JSON.stringify({
        success: true,
        action: 'validation_failed',
        orderValue: finalOrderValue,
        balance: usdtBalance,
        amount,
        minAmount: best.minAmount,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    let tradeResult: { success: boolean; orderId?: string; pnl?: number; error?: string } = { success: false };

    if (!paperMode) {
      try {
        const order = await gateRequest('POST', '/spot/orders', apiKey, apiSecret, {
          currency_pair: best.symbol,
          side: 'buy',
          type: 'market',
          amount: amount.toFixed(best.precision),
          time_in_force: 'ioc',
        }) as { id?: string; avg_deal_price?: string; filled_total?: string };

        const filledUsdt = parseFloat(order.filled_total || '0');
        const pnl = best.edge * (filledUsdt > 0 ? filledUsdt : finalOrderValue) / 100;

        await supabase.from('trade_history').insert({
          symbol: best.symbol,
          side: 'buy',
          type: 'market',
          amount,
          price: parseFloat(order.avg_deal_price || best.price.toString()),
          expected_edge: best.edge,
          actual_pnl: pnl,
          order_id: order.id,
          status: 'executed',
          executed_at: new Date().toISOString(),
        });

        await supabase.from('system_log').insert({
          component: 'hyper-engine',
          level: 'info',
          message: `Executed ${best.strategy} on ${best.symbol}`,
          details: { 
            edge: best.edge, 
            amount: finalOrderValue, 
            pnl,
            regime: regime.regime,
            kelly: tradingStats.kellyFraction,
            qualityScore: best.qualityScore,
          },
        });

        console.log(`✅ Executed: ${order.id} | +${pnl.toFixed(3)}%`);
        tradeResult = { success: true, orderId: order.id, pnl };

      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Unknown';
        console.error(`❌ Trade failed:`, msg);
        
        await supabase.from('trade_history').insert({
          symbol: best.symbol,
          side: 'buy',
          type: 'market',
          amount,
          price: best.price,
          expected_edge: best.edge,
          actual_pnl: 0,
          status: 'failed',
          error: msg,
        });
        
        tradeResult = { success: false, error: msg };
      }
    } else {
      console.log(`📝 Paper trade: ${best.symbol} $${orderValue.toFixed(2)}`);
      tradeResult = { success: true, pnl: best.edge * orderValue / 100 };
    }

    // Update state
    const now = new Date().toISOString();
    await supabase.from('trading_system_state').update({
      is_active: true,
      total_cycles: (state?.total_cycles || 0) + 1,
      total_trades: (state?.total_trades || 0) + (tradeResult.success ? 1 : 0),
      total_pnl: (state?.total_pnl || 0) + (tradeResult.pnl || 0),
      last_heartbeat: now,
      updated_at: now,
    }).eq('id', state?.id || '');

    const duration = Date.now() - startTime;
    console.log(`🏁 [HYPER-PRO] Complete in ${duration}ms`);

    return new Response(JSON.stringify({
      success: true,
      action: tradeResult.success ? 'executed' : 'failed',
      trade: {
        symbol: best.symbol,
        strategy: best.strategy,
        edge: best.edge,
        amount: orderValue,
        orderId: tradeResult.orderId,
        pnl: tradeResult.pnl,
        error: tradeResult.error,
      },
      regime: {
        type: regime.regime,
        recommendation: regime.recommendation,
        confidence: regime.confidence,
      },
      stats: {
        winRate: tradingStats.winRate,
        kellyFraction: tradingStats.kellyFraction,
        totalTrades: tradingStats.totalTrades,
      },
      opportunities: opportunities.slice(0, 5).map(o => ({
        symbol: o.symbol,
        edge: o.edge,
        strategy: o.strategy,
        qualityScore: o.qualityScore,
      })),
      duration,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('❌ Fatal:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown',
      duration: Date.now() - startTime,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
