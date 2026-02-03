import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createHmac } from "https://deno.land/std@0.177.0/node/crypto.ts";
import { encodeHex } from "https://deno.land/std@0.224.0/encoding/hex.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============ HYPER-AGGRESSIVE CONFIGURATION ============
const HYPER_CONFIG = {
  // Speed & Latency
  cycleInterval: 200,           // 200ms between cycles (5x per second)
  parallelRequests: 10,         // Concurrent API calls
  staleDataMaxAge: 1000,        // 1 second max data age
  
  // Opportunity Detection
  minEdge: 0.15,                // 0.15% minimum edge (ultra-low for volume)
  maxSpread: 0.5,               // Max 0.5% spread
  minVolume: 50000,             // $50k min 24h volume
  
  // Position Sizing
  maxPositions: 15,             // Up to 15 simultaneous positions
  maxExposure: 0.85,            // Use up to 85% of balance
  minTradeSize: 5,              // Gate.io minimum
  maxTradeSize: 0.12,           // 12% per position
  
  // Risk Management
  stopLoss: -0.8,               // -0.8% stop loss (tight)
  takeProfit: 0.5,              // +0.5% take profit (scalping)
  trailingStop: 0.25,           // 0.25% trailing stop after profit
  maxDailyLoss: -5,             // -5% daily circuit breaker
  
  // Strategy Weights (aggressive)
  strategies: {
    microScalp: 0.35,           // Ultra-fast scalping
    momentum: 0.25,             // Trend following
    spread: 0.20,               // Spread capture
    whale: 0.15,                // Whale following
    mean: 0.05,                 // Mean reversion
  },
  
  // Correlation & Sync
  correlationWindow: 20,        // 20 data points for correlation
  syncThreshold: 0.85,          // 85% correlation threshold
  crossPairArbitrage: true,     // Enable cross-pair opportunities
};

// ============ TYPES ============
interface MarketSnapshot {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  spread: number;
  volume24h: number;
  change1m: number;
  change5m: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volatility: number;
  momentum: number;
  timestamp: number;
}

interface Opportunity {
  id: string;
  symbol: string;
  strategy: string;
  action: 'buy' | 'sell';
  edge: number;
  confidence: number;
  urgency: number;
  size: number;
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  reason: string;
  correlatedWith?: string[];
  timestamp: number;
}

interface Position {
  id: string;
  symbol: string;
  strategy: string;
  side: 'long' | 'short';
  entryPrice: number;
  amount: number;
  usdValue: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
  stopLoss: number;
  takeProfit: number;
  trailingStop?: number;
  highestPrice?: number;
  timestamp: number;
}

interface TradeResult {
  success: boolean;
  orderId?: string;
  filledAmount?: number;
  avgPrice?: number;
  error?: string;
  latency: number;
}

// ============ GATE.IO API (OPTIMIZED) ============
async function sha512Hash(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-512', msgBuffer);
  return encodeHex(new Uint8Array(hashBuffer));
}

async function generateSignature(
  method: string, url: string, queryString: string,
  payloadString: string, timestamp: string, secret: string
): Promise<string> {
  const hashedPayload = await sha512Hash(payloadString);
  const signatureString = `${method}\n${url}\n${queryString}\n${hashedPayload}\n${timestamp}`;
  return createHmac('sha512', secret).update(signatureString).digest('hex');
}

async function fastGateRequest(
  method: string, endpoint: string, apiKey: string, apiSecret: string,
  params: Record<string, string> = {}, body?: unknown,
  timeout: number = 3000
): Promise<unknown> {
  const baseUrl = 'https://api.gateio.ws';
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const queryString = new URLSearchParams(params).toString();
  const bodyString = body ? JSON.stringify(body) : '';
  
  const signature = await generateSignature(method, endpoint, queryString, bodyString, timestamp, apiSecret);
  
  const url = `${baseUrl}${endpoint}${queryString ? '?' + queryString : ''}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      method,
      headers: {
        'KEY': apiKey,
        'SIGN': signature,
        'Timestamp': timestamp,
        'Content-Type': 'application/json',
      },
      body: body ? bodyString : undefined,
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    return response.json();
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}

// ============ PARALLEL DATA FETCHING ============
async function getFullMarketState(apiKey: string, apiSecret: string): Promise<{
  balance: number;
  walletBalances: Map<string, number>;
  markets: MarketSnapshot[];
  fetchTime: number;
}> {
  const startTime = Date.now();
  
  const [accounts, tickers, orderbook] = await Promise.all([
    fastGateRequest('GET', '/api/v4/spot/accounts', apiKey, apiSecret) as Promise<Array<{ currency: string; available: string; locked: string }>>,
    fastGateRequest('GET', '/api/v4/spot/tickers', apiKey, apiSecret) as Promise<Array<{
      currency_pair: string;
      last: string;
      highest_bid: string;
      lowest_ask: string;
      quote_volume: string;
      change_percentage: string;
      high_24h: string;
      low_24h: string;
    }>>,
    // Orderbook for top pairs (depth)
    Promise.resolve([]), // Skip for now, add if needed
  ]);
  
  const now = Date.now();
  
  // Process balances
  const walletBalances = new Map<string, number>();
  let usdtBalance = 0;
  
  for (const acc of accounts) {
    const available = parseFloat(acc.available);
    if (available > 0) {
      walletBalances.set(acc.currency, available);
      if (acc.currency === 'USDT') usdtBalance = available;
    }
  }
  
  // Process markets with enhanced metrics
  const markets: MarketSnapshot[] = tickers
    .filter(t => t.currency_pair.endsWith('_USDT'))
    .map(t => {
      const price = parseFloat(t.last);
      const bid = parseFloat(t.highest_bid);
      const ask = parseFloat(t.lowest_ask);
      const high = parseFloat(t.high_24h);
      const low = parseFloat(t.low_24h);
      const volume = parseFloat(t.quote_volume);
      const change24h = parseFloat(t.change_percentage);
      
      const spread = price > 0 ? ((ask - bid) / price) * 100 : 999;
      const volatility = price > 0 ? ((high - low) / price) * 100 : 0;
      const pricePosition = high > low ? (price - low) / (high - low) : 0.5;
      const momentum = pricePosition * 2 - 1; // -1 to 1
      
      return {
        symbol: t.currency_pair,
        price,
        bid,
        ask,
        spread,
        volume24h: volume,
        change1m: 0, // Would need historical data
        change5m: 0,
        change24h,
        high24h: high,
        low24h: low,
        volatility,
        momentum,
        timestamp: now,
      };
    })
    .filter(m => 
      m.price > 0 && 
      m.volume24h >= HYPER_CONFIG.minVolume && 
      m.spread <= HYPER_CONFIG.maxSpread
    )
    .sort((a, b) => b.volume24h - a.volume24h);
  
  return {
    balance: usdtBalance,
    walletBalances,
    markets,
    fetchTime: now - startTime,
  };
}

// ============ OPPORTUNITY DETECTION ============
function detectOpportunities(
  markets: MarketSnapshot[],
  positions: Position[],
  freeBalance: number,
  priceHistory: Map<string, number[]>
): Opportunity[] {
  const opportunities: Opportunity[] = [];
  const now = Date.now();
  
  // Get symbols we already have positions in
  const positionSymbols = new Set(positions.map(p => p.symbol));
  
  for (const market of markets.slice(0, 100)) {
    // Skip if already in position
    if (positionSymbols.has(market.symbol)) continue;
    
    const history = priceHistory.get(market.symbol) || [];
    const recentTrend = history.length >= 5 
      ? (market.price - history[0]) / history[0] * 100 
      : 0;
    
    // ===== STRATEGY 1: MICRO SCALP =====
    // Super tight spreads with quick in/out
    if (market.spread <= 0.15 && market.volume24h > 200000) {
      const edge = market.spread * 0.4; // Capture 40% of spread
      if (edge >= HYPER_CONFIG.minEdge) {
        opportunities.push({
          id: `scalp-${market.symbol}-${now}`,
          symbol: market.symbol,
          strategy: 'microScalp',
          action: 'buy',
          edge,
          confidence: Math.min(95, 70 + market.volume24h / 100000),
          urgency: 95,
          size: freeBalance * HYPER_CONFIG.strategies.microScalp * 0.15,
          entryPrice: market.bid + (market.spread * market.price / 400),
          targetPrice: market.ask - (market.spread * market.price / 400),
          stopLoss: market.bid * 0.997,
          reason: `Scalp: ${market.spread.toFixed(3)}% spread`,
          timestamp: now,
        });
      }
    }
    
    // ===== STRATEGY 2: MOMENTUM BREAKOUT =====
    if (market.change24h >= 3.5 && market.momentum >= 0.85 && recentTrend > 0.5) {
      const edge = Math.min(market.change24h * 0.15, 2);
      opportunities.push({
        id: `momentum-${market.symbol}-${now}`,
        symbol: market.symbol,
        strategy: 'momentum',
        action: 'buy',
        edge,
        confidence: Math.min(90, 60 + market.change24h * 3),
        urgency: 80,
        size: freeBalance * HYPER_CONFIG.strategies.momentum * 0.25,
        entryPrice: market.price,
        targetPrice: market.price * (1 + edge / 100),
        stopLoss: market.price * 0.985,
        reason: `Breakout +${market.change24h.toFixed(1)}% | Momentum ${(market.momentum * 100).toFixed(0)}`,
        timestamp: now,
      });
    }
    
    // ===== STRATEGY 3: SPREAD ARBITRAGE =====
    if (market.spread >= 0.2 && market.spread <= 0.4 && market.volatility <= 4) {
      const edge = market.spread * 0.5;
      if (edge >= 0.1) {
        opportunities.push({
          id: `spread-${market.symbol}-${now}`,
          symbol: market.symbol,
          strategy: 'spread',
          action: 'buy',
          edge,
          confidence: 75,
          urgency: 70,
          size: freeBalance * HYPER_CONFIG.strategies.spread * 0.2,
          entryPrice: market.bid * 1.0005,
          targetPrice: market.ask * 0.9995,
          stopLoss: market.bid * 0.996,
          reason: `Spread capture: ${market.spread.toFixed(2)}%`,
          timestamp: now,
        });
      }
    }
    
    // ===== STRATEGY 4: WHALE FOLLOWING =====
    if (market.volume24h > 1000000 && market.change24h > 4 && market.momentum > 0.8) {
      const edge = 0.8;
      opportunities.push({
        id: `whale-${market.symbol}-${now}`,
        symbol: market.symbol,
        strategy: 'whale',
        action: 'buy',
        edge,
        confidence: Math.min(85, 65 + market.change24h * 2),
        urgency: 85,
        size: freeBalance * HYPER_CONFIG.strategies.whale * 0.3,
        entryPrice: market.price,
        targetPrice: market.price * 1.008,
        stopLoss: market.price * 0.992,
        reason: `Whale activity: $${(market.volume24h/1000000).toFixed(1)}M vol +${market.change24h.toFixed(1)}%`,
        timestamp: now,
      });
    }
    
    // ===== STRATEGY 5: MEAN REVERSION =====
    if (market.change24h <= -5 && market.momentum <= 0.2 && market.volume24h > 300000) {
      const edge = Math.abs(market.change24h) * 0.15;
      opportunities.push({
        id: `mean-${market.symbol}-${now}`,
        symbol: market.symbol,
        strategy: 'mean',
        action: 'buy',
        edge,
        confidence: Math.min(80, 55 + Math.abs(market.change24h) * 3),
        urgency: 60,
        size: freeBalance * HYPER_CONFIG.strategies.mean * 0.3,
        entryPrice: market.price,
        targetPrice: market.price * (1 + edge / 100),
        stopLoss: market.low24h * 0.98,
        reason: `Oversold bounce: ${market.change24h.toFixed(1)}%`,
        timestamp: now,
      });
    }
  }
  
  // Sort by combined score: edge * confidence * urgency
  return opportunities
    .filter(o => o.size >= HYPER_CONFIG.minTradeSize)
    .sort((a, b) => 
      (b.edge * b.confidence * b.urgency / 10000) - 
      (a.edge * a.confidence * a.urgency / 10000)
    )
    .slice(0, 10);
}

// ============ POSITION MANAGEMENT ============
function evaluatePositions(
  positions: Position[],
  markets: MarketSnapshot[]
): { toClose: Position[]; toUpdate: Position[] } {
  const toClose: Position[] = [];
  const toUpdate: Position[] = [];
  const now = Date.now();
  
  for (const pos of positions) {
    const market = markets.find(m => m.symbol === pos.symbol);
    if (!market) {
      // Market not found, force close
      toClose.push({ ...pos, currentPrice: pos.entryPrice, pnl: 0, pnlPercent: 0 });
      continue;
    }
    
    const currentPrice = market.price;
    const pnlPercent = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
    const pnl = pos.usdValue * (pnlPercent / 100);
    const holdTime = (now - pos.timestamp) / 1000;
    
    const updated: Position = {
      ...pos,
      currentPrice,
      pnl,
      pnlPercent,
      highestPrice: Math.max(pos.highestPrice || pos.entryPrice, currentPrice),
    };
    
    // ===== EXIT CONDITIONS =====
    
    // 1. Take Profit Hit
    if (pnlPercent >= HYPER_CONFIG.takeProfit) {
      toClose.push(updated);
      continue;
    }
    
    // 2. Stop Loss Hit
    if (pnlPercent <= HYPER_CONFIG.stopLoss) {
      toClose.push(updated);
      continue;
    }
    
    // 3. Trailing Stop (if in profit)
    if (pnlPercent > HYPER_CONFIG.trailingStop && updated.highestPrice) {
      const trailingStopPrice = updated.highestPrice * (1 - HYPER_CONFIG.trailingStop / 100);
      if (currentPrice <= trailingStopPrice) {
        toClose.push(updated);
        continue;
      }
    }
    
    // 4. Time-based exits (strategy specific)
    const maxHoldTimes: Record<string, number> = {
      microScalp: 30,   // 30 seconds max
      spread: 60,       // 1 minute
      momentum: 180,    // 3 minutes
      whale: 120,       // 2 minutes
      mean: 300,        // 5 minutes
    };
    
    const maxHold = maxHoldTimes[pos.strategy] || 120;
    if (holdTime > maxHold && pnlPercent > 0) {
      toClose.push(updated);
      continue;
    }
    
    // 5. Momentum reversal (close if momentum flips against us)
    if (pos.strategy === 'momentum' && market.momentum < 0.3 && pnlPercent > -0.3) {
      toClose.push(updated);
      continue;
    }
    
    toUpdate.push(updated);
  }
  
  return { toClose, toUpdate };
}

// ============ FAST ORDER EXECUTION ============
async function executeOpportunity(
  opp: Opportunity,
  apiKey: string,
  apiSecret: string
): Promise<TradeResult> {
  const startTime = Date.now();
  
  try {
    // Calculate amount based on entry price
    const amount = (opp.size / opp.entryPrice).toFixed(6);
    
    const result = await fastGateRequest('POST', '/api/v4/spot/orders', apiKey, apiSecret, {}, {
      currency_pair: opp.symbol,
      type: 'market',
      side: opp.action,
      amount,
      time_in_force: 'ioc',
    }, 2000) as { id?: string; amount?: string; avg_deal_price?: string; message?: string };
    
    const latency = Date.now() - startTime;
    
    if (result.id) {
      return {
        success: true,
        orderId: result.id,
        filledAmount: parseFloat(result.amount || '0'),
        avgPrice: parseFloat(result.avg_deal_price || '0'),
        latency,
      };
    }
    
    return { success: false, error: result.message || 'Unknown error', latency };
  } catch (e) {
    return { 
      success: false, 
      error: e instanceof Error ? e.message : 'Unknown error', 
      latency: Date.now() - startTime 
    };
  }
}

async function closePosition(
  pos: Position,
  market: MarketSnapshot,
  apiKey: string,
  apiSecret: string
): Promise<TradeResult> {
  const startTime = Date.now();
  
  try {
    const sellAmount = (pos.amount * 0.998).toFixed(6);
    
    const result = await fastGateRequest('POST', '/api/v4/spot/orders', apiKey, apiSecret, {}, {
      currency_pair: pos.symbol,
      type: 'market',
      side: 'sell',
      amount: sellAmount,
      time_in_force: 'ioc',
    }, 2000) as { id?: string; amount?: string; avg_deal_price?: string; message?: string };
    
    const latency = Date.now() - startTime;
    
    if (result.id) {
      return {
        success: true,
        orderId: result.id,
        filledAmount: parseFloat(result.amount || '0'),
        avgPrice: parseFloat(result.avg_deal_price || '0'),
        latency,
      };
    }
    
    return { success: false, error: result.message || 'Unknown error', latency };
  } catch (e) {
    return { 
      success: false, 
      error: e instanceof Error ? e.message : 'Unknown error', 
      latency: Date.now() - startTime 
    };
  }
}

// ============ MAIN HYPER ENGINE ============
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { durationSeconds = 300, paperMode = false } = await req.json().catch(() => ({}));
    const startTime = Date.now();
    const endTime = startTime + durationSeconds * 1000;
    
    const apiKey = Deno.env.get('GATE_API_KEY');
    const apiSecret = Deno.env.get('GATE_API_SECRET');
    
    if (!apiKey || !apiSecret) {
      throw new Error('Missing Gate.io credentials');
    }
    
    // Initialize Supabase for logging
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`🚀 [HYPER ENGINE] Starting ${durationSeconds}s ${paperMode ? 'PAPER' : 'LIVE'} session`);
    console.log(`⚡ Config: ${HYPER_CONFIG.cycleInterval}ms cycles | ${HYPER_CONFIG.maxPositions} max positions | ${HYPER_CONFIG.minEdge}% min edge`);
    
    // State
    const positions: Position[] = [];
    const priceHistory = new Map<string, number[]>();
    let totalCycles = 0;
    let totalTrades = 0;
    let totalPnL = 0;
    let avgLatency = 0;
    let dailyPnL = 0;
    
    const stats = {
      microScalp: { trades: 0, pnl: 0, wins: 0 },
      momentum: { trades: 0, pnl: 0, wins: 0 },
      spread: { trades: 0, pnl: 0, wins: 0 },
      whale: { trades: 0, pnl: 0, wins: 0 },
      mean: { trades: 0, pnl: 0, wins: 0 },
    };

    // Main trading loop
    while (Date.now() < endTime) {
      const cycleStart = Date.now();
      totalCycles++;
      
      try {
        // ===== FETCH STATE =====
        const state = await getFullMarketState(apiKey, apiSecret);
        avgLatency = (avgLatency * (totalCycles - 1) + state.fetchTime) / totalCycles;
        
        // Update price history
        for (const market of state.markets.slice(0, 50)) {
          const history = priceHistory.get(market.symbol) || [];
          history.push(market.price);
          if (history.length > HYPER_CONFIG.correlationWindow) history.shift();
          priceHistory.set(market.symbol, history);
        }
        
        // Calculate available balance
        const usedBalance = positions.reduce((sum, p) => sum + p.usdValue, 0);
        const maxUsable = state.balance * HYPER_CONFIG.maxExposure;
        const freeBalance = maxUsable - usedBalance;
        
        // ===== CIRCUIT BREAKER CHECK =====
        if (dailyPnL <= HYPER_CONFIG.maxDailyLoss) {
          console.log(`🛑 Circuit breaker: Daily loss ${dailyPnL.toFixed(2)}% exceeds limit`);
          break;
        }
        
        // ===== EXIT POSITIONS =====
        const { toClose, toUpdate } = evaluatePositions(positions, state.markets);
        
        for (const pos of toClose) {
          const market = state.markets.find(m => m.symbol === pos.symbol);
          if (!market) continue;
          
          if (!paperMode) {
            const result = await closePosition(pos, market, apiKey, apiSecret);
            if (!result.success) {
              console.log(`❌ Failed to close ${pos.symbol}: ${result.error}`);
              continue;
            }
          }
          
          const exitReason = pos.pnlPercent >= HYPER_CONFIG.takeProfit ? 'TP' :
                            pos.pnlPercent <= HYPER_CONFIG.stopLoss ? 'SL' : 'Exit';
          
          console.log(`${pos.pnlPercent >= 0 ? '✅' : '❌'} [${exitReason}] ${pos.symbol} | ${pos.strategy} | ${pos.pnlPercent.toFixed(2)}% | $${pos.pnl.toFixed(2)}`);
          
          // Update stats
          const stratStats = stats[pos.strategy as keyof typeof stats];
          if (stratStats) {
            stratStats.trades++;
            stratStats.pnl += pos.pnlPercent;
            if (pos.pnlPercent > 0) stratStats.wins++;
          }
          
          totalTrades++;
          totalPnL += pos.pnlPercent;
          dailyPnL += pos.pnlPercent;
          
              // Log to database
              await supabase.from('trade_history').insert({
                symbol: pos.symbol,
                type: pos.strategy,
                side: 'sell',
                price: pos.currentPrice,
                amount: pos.amount,
                actual_pnl: pos.pnl,
                status: 'executed',
              });
          
          // Remove from positions
          const idx = positions.findIndex(p => p.id === pos.id);
          if (idx > -1) positions.splice(idx, 1);
        }
        
        // Update remaining positions
        for (let i = 0; i < positions.length; i++) {
          const updated = toUpdate.find(p => p.id === positions[i].id);
          if (updated) positions[i] = updated;
        }
        
        // ===== FIND NEW OPPORTUNITIES =====
        if (positions.length < HYPER_CONFIG.maxPositions && freeBalance >= HYPER_CONFIG.minTradeSize) {
          const opportunities = detectOpportunities(
            state.markets,
            positions,
            freeBalance,
            priceHistory
          );
          
          // Execute top opportunities
          for (const opp of opportunities.slice(0, 3)) {
            if (positions.length >= HYPER_CONFIG.maxPositions) break;
            if (opp.size > freeBalance) continue;
            
            let result: TradeResult;
            if (paperMode) {
              result = { success: true, orderId: `paper-${Date.now()}`, filledAmount: opp.size / opp.entryPrice, avgPrice: opp.entryPrice, latency: 0 };
            } else {
              result = await executeOpportunity(opp, apiKey, apiSecret);
            }
            
            if (result.success && result.filledAmount && result.avgPrice) {
              console.log(`🎯 [${opp.strategy}] ${opp.symbol} | Edge: ${opp.edge.toFixed(2)}% | Size: $${opp.size.toFixed(2)} | ${result.latency}ms`);
              
              positions.push({
                id: result.orderId || `pos-${Date.now()}`,
                symbol: opp.symbol,
                strategy: opp.strategy,
                side: 'long',
                entryPrice: result.avgPrice,
                amount: result.filledAmount,
                usdValue: result.filledAmount * result.avgPrice,
                currentPrice: result.avgPrice,
                pnl: 0,
                pnlPercent: 0,
                stopLoss: opp.stopLoss,
                takeProfit: opp.targetPrice,
                timestamp: Date.now(),
              });
              
              // Log to database
              await supabase.from('trade_history').insert({
                symbol: opp.symbol,
                type: opp.strategy,
                side: 'buy',
                price: result.avgPrice,
                amount: result.filledAmount,
                expected_edge: opp.edge,
                status: 'executed',
              });
            }
          }
        }
        
        // ===== LOGGING =====
        if (totalCycles % 50 === 0) {
          console.log(`📊 Cycle ${totalCycles} | Positions: ${positions.length} | Trades: ${totalTrades} | PnL: ${totalPnL.toFixed(2)}% | Latency: ${avgLatency.toFixed(0)}ms`);
        }
        
      } catch (cycleError) {
        console.error(`⚠️ Cycle error:`, cycleError);
      }
      
      // Wait for next cycle
      const cycleTime = Date.now() - cycleStart;
      const waitTime = Math.max(0, HYPER_CONFIG.cycleInterval - cycleTime);
      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    
    // ===== SESSION SUMMARY =====
    const sessionDuration = (Date.now() - startTime) / 1000;
    
    console.log(`\n${'='.repeat(50)}`);
    console.log(`🏁 SESSION COMPLETE`);
    console.log(`Duration: ${sessionDuration.toFixed(0)}s | Cycles: ${totalCycles} | Avg Latency: ${avgLatency.toFixed(0)}ms`);
    console.log(`Total Trades: ${totalTrades} | Total PnL: ${totalPnL.toFixed(2)}%`);
    console.log(`\nStrategy Breakdown:`);
    for (const [strategy, data] of Object.entries(stats)) {
      if (data.trades > 0) {
        const winRate = (data.wins / data.trades * 100).toFixed(0);
        console.log(`  ${strategy}: ${data.trades} trades | ${data.pnl.toFixed(2)}% PnL | ${winRate}% win rate`);
      }
    }
    console.log(`${'='.repeat(50)}\n`);
    
    // Update system state
    await supabase.from('trading_system_state').upsert({
      id: 'hyper-engine',
      total_trades: totalTrades,
      total_pnl: totalPnL,
      total_cycles: totalCycles,
      last_heartbeat: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    
    // Log session
    await supabase.from('system_log').insert({
      component: 'hyper-engine',
      level: 'info',
      message: `Session complete: ${totalTrades} trades, ${totalPnL.toFixed(2)}% PnL`,
      details: { stats, totalCycles, avgLatency, sessionDuration },
    });

    return new Response(JSON.stringify({
      success: true,
      message: 'Hyper Engine session complete',
      sessionDuration,
      totalCycles,
      totalTrades,
      totalPnL,
      stats,
      avgLatency,
      openPositions: positions.length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[HYPER ENGINE ERROR]:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
