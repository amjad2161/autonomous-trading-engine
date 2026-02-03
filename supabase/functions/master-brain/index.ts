import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createHmac } from "https://deno.land/std@0.177.0/node/crypto.ts";
import { encodeHex } from "https://deno.land/std@0.224.0/encoding/hex.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============ MASTER CONFIGURATION ============
const MASTER_CONFIG = {
  // Capital allocation per market regime
  regimes: {
    trending: { momentum: 0.4, whale: 0.3, grid: 0.1, dca: 0.2 },
    ranging: { momentum: 0.1, whale: 0.2, grid: 0.5, dca: 0.2 },
    volatile: { momentum: 0.2, whale: 0.4, grid: 0.1, dca: 0.3 },
    crash: { momentum: 0.0, whale: 0.1, grid: 0.2, dca: 0.7 },
    pump: { momentum: 0.5, whale: 0.3, grid: 0.1, dca: 0.1 },
  },
  // Risk limits
  maxTotalExposure: 0.7,      // 70% max in positions
  maxSinglePosition: 0.15,    // 15% max per position
  maxDailyLoss: -0.05,        // -5% daily loss limit
  maxOpenPositions: 12,
  minTradeSize: 5,
  // Timing
  decisionInterval: 500,      // ms between decisions
  staleDataThreshold: 5000,   // 5s = stale data
};

// ============ TYPES ============
type MarketRegime = 'trending' | 'ranging' | 'volatile' | 'crash' | 'pump';
type Strategy = 'momentum' | 'whale' | 'grid' | 'dca';
type Signal = {
  strategy: Strategy;
  symbol: string;
  action: 'buy' | 'sell' | 'hold';
  strength: number;      // 0-100
  reason: string;
  suggestedSize: number; // in USDT
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  timeframe: number;     // expected hold time in seconds
};

interface Position {
  id: string;
  symbol: string;
  strategy: Strategy;
  side: 'long';
  entryPrice: number;
  amount: number;
  usdValue: number;
  stopLoss: number;
  takeProfit: number;
  timestamp: number;
  trailingStop?: number;
}

interface MarketData {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  spread: number;
  volume24h: number;
  change1h: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volatility: number;
  momentum: number;
  lastUpdate: number;
}

interface BrainState {
  regime: MarketRegime;
  regimeConfidence: number;
  totalBalance: number;
  freeBalance: number;
  exposurePercent: number;
  positions: Position[];
  dailyPnL: number;
  dailyTrades: number;
  lastSignals: Signal[];
  isHalted: boolean;
  haltReason?: string;
}

// ============ GATE.IO API ============
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

async function gateRequest(
  method: string, endpoint: string, apiKey: string, apiSecret: string,
  params: Record<string, string> = {}, body?: unknown
): Promise<unknown> {
  const baseUrl = 'https://api.gateio.ws';
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const queryString = new URLSearchParams(params).toString();
  const bodyString = body ? JSON.stringify(body) : '';
  
  const signature = await generateSignature(method, endpoint, queryString, bodyString, timestamp, apiSecret);
  
  const url = `${baseUrl}${endpoint}${queryString ? '?' + queryString : ''}`;
  const response = await fetch(url, {
    method,
    headers: {
      'KEY': apiKey,
      'SIGN': signature,
      'Timestamp': timestamp,
      'Content-Type': 'application/json',
    },
    body: body ? bodyString : undefined,
  });
  
  return response.json();
}

async function getFullState(apiKey: string, apiSecret: string): Promise<{
  balance: number;
  positions: { currency: string; available: string; locked: string }[];
  markets: MarketData[];
}> {
  const [accounts, tickers] = await Promise.all([
    gateRequest('GET', '/api/v4/spot/accounts', apiKey, apiSecret) as Promise<Array<{ currency: string; available: string; locked: string }>>,
    gateRequest('GET', '/api/v4/spot/tickers', apiKey, apiSecret) as Promise<Array<{
      currency_pair: string;
      last: string;
      highest_bid: string;
      lowest_ask: string;
      quote_volume: string;
      change_percentage: string;
      high_24h: string;
      low_24h: string;
    }>>,
  ]);
  
  const usdt = accounts.find(a => a.currency === 'USDT');
  const balance = usdt ? parseFloat(usdt.available) + parseFloat(usdt.locked || '0') : 0;
  
  const now = Date.now();
  const markets: MarketData[] = tickers
    .filter(t => t.currency_pair.endsWith('_USDT'))
    .map(t => {
      const price = parseFloat(t.last);
      const high = parseFloat(t.high_24h);
      const low = parseFloat(t.low_24h);
      const bid = parseFloat(t.highest_bid);
      const ask = parseFloat(t.lowest_ask);
      const change = parseFloat(t.change_percentage);
      const volatility = price > 0 ? ((high - low) / price) * 100 : 0;
      
      return {
        symbol: t.currency_pair,
        price,
        bid,
        ask,
        spread: price > 0 ? ((ask - bid) / price) * 100 : 0,
        volume24h: parseFloat(t.quote_volume),
        change1h: change / 24, // Approximation
        change24h: change,
        high24h: high,
        low24h: low,
        volatility,
        momentum: change > 0 ? Math.min(change / 10, 1) : Math.max(change / 10, -1),
        lastUpdate: now,
      };
    })
    .filter(m => m.price > 0 && m.volume24h > 50000);
  
  return { balance, positions: accounts, markets };
}

async function executeOrder(
  apiKey: string, apiSecret: string,
  symbol: string, side: 'buy' | 'sell', amountUsdt: number, price: number
): Promise<{ success: boolean; orderId?: string; filledAmount?: number; avgPrice?: number; error?: string }> {
  try {
    const amount = (amountUsdt / price).toFixed(6);
    
    const result = await gateRequest('POST', '/api/v4/spot/orders', apiKey, apiSecret, {}, {
      currency_pair: symbol,
      type: 'market',
      side,
      amount,
      time_in_force: 'ioc',
    }) as { id?: string; amount?: string; avg_deal_price?: string; message?: string };
    
    if (result.id) {
      return {
        success: true,
        orderId: result.id,
        filledAmount: parseFloat(result.amount || '0'),
        avgPrice: parseFloat(result.avg_deal_price || String(price)),
      };
    }
    return { success: false, error: result.message || 'Unknown error' };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

// ============ MARKET REGIME DETECTION ============
function detectMarketRegime(markets: MarketData[]): { regime: MarketRegime; confidence: number } {
  // Analyze top 20 markets by volume
  const topMarkets = markets
    .sort((a, b) => b.volume24h - a.volume24h)
    .slice(0, 20);
  
  const avgChange = topMarkets.reduce((s, m) => s + m.change24h, 0) / topMarkets.length;
  const avgVolatility = topMarkets.reduce((s, m) => s + m.volatility, 0) / topMarkets.length;
  const bullishCount = topMarkets.filter(m => m.change24h > 2).length;
  const bearishCount = topMarkets.filter(m => m.change24h < -2).length;
  
  // Crash: Most assets down significantly
  if (avgChange < -5 || bearishCount >= 15) {
    return { regime: 'crash', confidence: Math.min(Math.abs(avgChange) * 5, 95) };
  }
  
  // Pump: Most assets up significantly
  if (avgChange > 5 || bullishCount >= 15) {
    return { regime: 'pump', confidence: Math.min(avgChange * 5, 95) };
  }
  
  // Volatile: High volatility but mixed direction
  if (avgVolatility > 8) {
    return { regime: 'volatile', confidence: Math.min(avgVolatility * 5, 85) };
  }
  
  // Trending: Clear direction with moderate volatility
  if (Math.abs(avgChange) > 2 && avgVolatility > 3) {
    return { regime: 'trending', confidence: Math.min(Math.abs(avgChange) * 10, 80) };
  }
  
  // Ranging: Low volatility, mixed direction
  return { regime: 'ranging', confidence: Math.max(60 - avgVolatility * 5, 40) };
}

// ============ UNIFIED SIGNAL GENERATION ============
function generateSignals(
  markets: MarketData[],
  regime: MarketRegime,
  state: BrainState,
  allocation: Record<Strategy, number>
): Signal[] {
  const signals: Signal[] = [];
  const now = Date.now();
  
  for (const market of markets.slice(0, 50)) {
    // Skip if already have position
    if (state.positions.some(p => p.symbol === market.symbol)) continue;
    
    // Skip stale data
    if (now - market.lastUpdate > MASTER_CONFIG.staleDataThreshold) continue;
    
    const positionInRange = market.price > 0 ? 
      (market.price - market.low24h) / (market.high24h - market.low24h) : 0.5;
    
    // ========== MOMENTUM SIGNALS ==========
    if (allocation.momentum > 0.05) {
      // Breakout: Near high with strong momentum
      if (market.change24h >= 4 && positionInRange >= 0.9 && market.volatility >= 3) {
        signals.push({
          strategy: 'momentum',
          symbol: market.symbol,
          action: 'buy',
          strength: Math.min(market.change24h * 8 + market.volatility * 5, 95),
          reason: `Breakout: +${market.change24h.toFixed(1)}% at 24h high`,
          suggestedSize: state.freeBalance * allocation.momentum * 0.3,
          entryPrice: market.price,
          targetPrice: market.price * 1.02,
          stopLoss: market.price * 0.985,
          timeframe: 180,
        });
      }
      
      // Oversold bounce
      if (market.change24h <= -6 && positionInRange <= 0.15) {
        signals.push({
          strategy: 'momentum',
          symbol: market.symbol,
          action: 'buy',
          strength: Math.min(Math.abs(market.change24h) * 6, 90),
          reason: `Oversold bounce: ${market.change24h.toFixed(1)}% near low`,
          suggestedSize: state.freeBalance * allocation.momentum * 0.25,
          entryPrice: market.price,
          targetPrice: market.price * 1.025,
          stopLoss: market.low24h * 0.98,
          timeframe: 300,
        });
      }
    }
    
    // ========== WHALE SIGNALS ==========
    if (allocation.whale > 0.05) {
      // Volume spike + momentum = whale activity
      const avgVolume = market.volume24h / 24; // Hourly average
      const isHighVolume = market.volume24h > avgVolume * 3;
      
      if (isHighVolume && market.change24h > 3 && positionInRange > 0.7) {
        signals.push({
          strategy: 'whale',
          symbol: market.symbol,
          action: 'buy',
          strength: Math.min(market.change24h * 10 + 20, 90),
          reason: `Whale detected: High volume + ${market.change24h.toFixed(1)}% up`,
          suggestedSize: state.freeBalance * allocation.whale * 0.4,
          entryPrice: market.price,
          targetPrice: market.price * 1.015,
          stopLoss: market.price * 0.992,
          timeframe: 120,
        });
      }
    }
    
    // ========== GRID SIGNALS ==========
    if (allocation.grid > 0.05 && regime === 'ranging') {
      // Good spread + ranging market = grid opportunity
      if (market.spread >= 0.15 && market.volatility >= 2 && market.volatility <= 6) {
        signals.push({
          strategy: 'grid',
          symbol: market.symbol,
          action: 'buy',
          strength: Math.min(market.spread * 100 + market.volatility * 10, 85),
          reason: `Grid opportunity: ${market.spread.toFixed(2)}% spread, ${market.volatility.toFixed(1)}% vol`,
          suggestedSize: state.freeBalance * allocation.grid * 0.2,
          entryPrice: market.bid + (market.spread * market.price / 400),
          targetPrice: market.ask - (market.spread * market.price / 400),
          stopLoss: market.bid * 0.995,
          timeframe: 60,
        });
      }
    }
    
    // ========== DCA SIGNALS ==========
    if (allocation.dca > 0.05) {
      // Significant dip in quality asset
      if (market.change24h <= -4 && market.volume24h > 500000) {
        const dcaLevel = state.positions.filter(p => p.symbol === market.symbol && p.strategy === 'dca').length;
        
        if (dcaLevel < 5) {
          const sizeMultiplier = Math.pow(1.5, dcaLevel);
          signals.push({
            strategy: 'dca',
            symbol: market.symbol,
            action: 'buy',
            strength: Math.min(Math.abs(market.change24h) * 10 + dcaLevel * 5, 85),
            reason: `DCA Level ${dcaLevel + 1}: ${market.change24h.toFixed(1)}% dip`,
            suggestedSize: state.freeBalance * allocation.dca * 0.2 * sizeMultiplier,
            entryPrice: market.price,
            targetPrice: market.price * 1.03,
            stopLoss: market.price * 0.95,
            timeframe: 3600,
          });
        }
      }
    }
  }
  
  // Sort by strength and return top signals
  return signals.sort((a, b) => b.strength - a.strength);
}

// ============ POSITION MANAGEMENT ==========
function evaluatePositions(
  positions: Position[],
  markets: MarketData[]
): { exits: { position: Position; reason: string; pnl: number }[]; updates: { position: Position; newStop: number }[] } {
  const exits: { position: Position; reason: string; pnl: number }[] = [];
  const updates: { position: Position; newStop: number }[] = [];
  const now = Date.now();
  
  for (const pos of positions) {
    const market = markets.find(m => m.symbol === pos.symbol);
    if (!market) continue;
    
    const pnlPercent = ((market.price - pos.entryPrice) / pos.entryPrice) * 100;
    const holdTime = (now - pos.timestamp) / 1000;
    
    // Dynamic TP/SL based on strategy
    const targets = {
      momentum: { tp: 1.5, sl: -1.0, maxHold: 180 },
      whale: { tp: 1.0, sl: -0.8, maxHold: 120 },
      grid: { tp: 0.4, sl: -0.5, maxHold: 300 },
      dca: { tp: 2.5, sl: -4.0, maxHold: 7200 },
    }[pos.strategy];
    
    // Take profit
    if (pnlPercent >= targets.tp) {
      exits.push({ position: pos, reason: `TP ${pnlPercent.toFixed(2)}%`, pnl: pnlPercent });
      continue;
    }
    
    // Stop loss
    if (pnlPercent <= targets.sl) {
      exits.push({ position: pos, reason: `SL ${pnlPercent.toFixed(2)}%`, pnl: pnlPercent });
      continue;
    }
    
    // Trailing stop for profitable positions
    if (pnlPercent > 0.3 && pos.strategy !== 'dca') {
      const trailingDistance = pos.strategy === 'momentum' ? 0.005 : 0.008;
      const newStop = market.price * (1 - trailingDistance);
      
      if (!pos.trailingStop || newStop > pos.trailingStop) {
        updates.push({ position: pos, newStop });
      } else if (market.price < pos.trailingStop) {
        exits.push({ position: pos, reason: `Trailing stop hit`, pnl: pnlPercent });
        continue;
      }
    }
    
    // Time-based exit with any profit
    if (holdTime > targets.maxHold && pnlPercent > 0.1) {
      exits.push({ position: pos, reason: `Time exit +${pnlPercent.toFixed(2)}%`, pnl: pnlPercent });
    }
  }
  
  return { exits, updates };
}

// ============ RISK MANAGEMENT ============
function checkRiskLimits(state: BrainState): { canTrade: boolean; reason?: string } {
  // Daily loss limit
  if (state.dailyPnL <= MASTER_CONFIG.maxDailyLoss * state.totalBalance) {
    return { canTrade: false, reason: `Daily loss limit hit: ${((state.dailyPnL / state.totalBalance) * 100).toFixed(2)}%` };
  }
  
  // Max exposure
  if (state.exposurePercent >= MASTER_CONFIG.maxTotalExposure * 100) {
    return { canTrade: false, reason: `Max exposure reached: ${state.exposurePercent.toFixed(1)}%` };
  }
  
  // Max positions
  if (state.positions.length >= MASTER_CONFIG.maxOpenPositions) {
    return { canTrade: false, reason: `Max positions: ${state.positions.length}` };
  }
  
  return { canTrade: true };
}

// ============ MAIN BRAIN LOOP ============
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const { durationSeconds = 300 } = await req.json();
    const startTime = Date.now();
    const endTime = startTime + durationSeconds * 1000;
    
    const apiKey = Deno.env.get('GATE_API_KEY');
    const apiSecret = Deno.env.get('GATE_API_SECRET');
    
    if (!apiKey || !apiSecret) {
      throw new Error('Missing Gate.io credentials');
    }

    console.log(`\n🧠 [MASTER BRAIN] Starting intelligent trading session (${durationSeconds}s)`);
    console.log('━'.repeat(60));
    
    // State tracking
    const positions: Position[] = [];
    let totalPnL = 0;
    let totalTrades = 0;
    const strategyStats: Record<Strategy, { trades: number; pnl: number }> = {
      momentum: { trades: 0, pnl: 0 },
      whale: { trades: 0, pnl: 0 },
      grid: { trades: 0, pnl: 0 },
      dca: { trades: 0, pnl: 0 },
    };
    let lastRegime: MarketRegime = 'ranging';
    let cycleCount = 0;

    while (Date.now() < endTime) {
      cycleCount++;
      const cycleStart = Date.now();
      
      try {
        // ========== 1. GET MARKET STATE ==========
        const { balance, markets } = await getFullState(apiKey, apiSecret);
        
        const usedBalance = positions.reduce((s, p) => s + p.usdValue, 0);
        const freeBalance = Math.max(balance - usedBalance, 0);
        const exposurePercent = balance > 0 ? (usedBalance / balance) * 100 : 0;
        
        // ========== 2. DETECT MARKET REGIME ==========
        const { regime, confidence: regimeConfidence } = detectMarketRegime(markets);
        
        if (regime !== lastRegime) {
          console.log(`\n📊 [REGIME CHANGE] ${lastRegime} → ${regime} (${regimeConfidence}% confidence)`);
          lastRegime = regime;
        }
        
        // Get allocation for current regime
        const allocation = MASTER_CONFIG.regimes[regime];
        
        // ========== 3. BUILD BRAIN STATE ==========
        const brainState: BrainState = {
          regime,
          regimeConfidence,
          totalBalance: balance,
          freeBalance,
          exposurePercent,
          positions,
          dailyPnL: totalPnL,
          dailyTrades: totalTrades,
          lastSignals: [],
          isHalted: false,
        };
        
        // ========== 4. CHECK RISK LIMITS ==========
        const riskCheck = checkRiskLimits(brainState);
        if (!riskCheck.canTrade) {
          console.log(`⚠️  [RISK] ${riskCheck.reason}`);
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
        
        // ========== 5. MANAGE EXISTING POSITIONS ==========
        const { exits, updates } = evaluatePositions(positions, markets);
        
        // Execute exits
        for (const exit of exits) {
          const market = markets.find(m => m.symbol === exit.position.symbol);
          if (!market) continue;
          
          const sellAmount = exit.position.amount * 0.998;
          const result = await executeOrder(apiKey, apiSecret, exit.position.symbol, 'sell', sellAmount * market.price, market.price);
          
          if (result.success) {
            const pnlUsd = exit.position.usdValue * (exit.pnl / 100);
            totalPnL += pnlUsd;
            totalTrades++;
            strategyStats[exit.position.strategy].trades++;
            strategyStats[exit.position.strategy].pnl += pnlUsd;
            
            console.log(`✅ [EXIT] ${exit.position.symbol} | ${exit.reason} | $${pnlUsd.toFixed(2)}`);
            
            // Log to database
            await supabase.from('trade_history').insert({
              symbol: exit.position.symbol.replace('_', '/'),
              type: exit.position.strategy,
              side: 'sell',
              amount: sellAmount,
              price: market.price,
              expected_edge: exit.pnl,
              actual_pnl: pnlUsd,
              status: 'executed',
              executed_at: new Date().toISOString(),
            });
            
            // Remove position
            const idx = positions.findIndex(p => p.id === exit.position.id);
            if (idx > -1) positions.splice(idx, 1);
          }
        }
        
        // Update trailing stops
        for (const update of updates) {
          const pos = positions.find(p => p.id === update.position.id);
          if (pos) pos.trailingStop = update.newStop;
        }
        
        // ========== 6. GENERATE NEW SIGNALS ==========
        const signals = generateSignals(markets, regime, brainState, allocation);
        brainState.lastSignals = signals;
        
        // ========== 7. EXECUTE BEST SIGNALS ==========
        const maxNewTrades = Math.min(3, MASTER_CONFIG.maxOpenPositions - positions.length);
        let tradesThisCycle = 0;
        
        for (const signal of signals) {
          if (tradesThisCycle >= maxNewTrades) break;
          if (signal.action !== 'buy') continue;
          if (signal.suggestedSize < MASTER_CONFIG.minTradeSize) continue;
          if (signal.suggestedSize > freeBalance) continue;
          
          // Check single position limit
          if (signal.suggestedSize > balance * MASTER_CONFIG.maxSinglePosition) {
            signal.suggestedSize = balance * MASTER_CONFIG.maxSinglePosition;
          }
          
          const market = markets.find(m => m.symbol === signal.symbol);
          if (!market) continue;
          
          console.log(`\n🎯 [${signal.strategy.toUpperCase()}] ${signal.symbol}`);
          console.log(`   ${signal.reason}`);
          console.log(`   Entry: $${signal.entryPrice.toFixed(6)} | Target: $${signal.targetPrice.toFixed(6)} | Stop: $${signal.stopLoss.toFixed(6)}`);
          
          const result = await executeOrder(apiKey, apiSecret, signal.symbol, 'buy', signal.suggestedSize, market.price);
          
          if (result.success) {
            const newPosition: Position = {
              id: `${signal.symbol}-${Date.now()}`,
              symbol: signal.symbol,
              strategy: signal.strategy,
              side: 'long',
              entryPrice: result.avgPrice || market.price,
              amount: result.filledAmount || (signal.suggestedSize / market.price),
              usdValue: signal.suggestedSize,
              stopLoss: signal.stopLoss,
              takeProfit: signal.targetPrice,
              timestamp: Date.now(),
            };
            
            positions.push(newPosition);
            tradesThisCycle++;
            
            console.log(`   ✅ Filled @ $${newPosition.entryPrice.toFixed(6)} | Size: $${signal.suggestedSize.toFixed(2)}`);
            
            // Log to database
            await supabase.from('trade_history').insert({
              symbol: signal.symbol.replace('_', '/'),
              type: signal.strategy,
              side: 'buy',
              amount: newPosition.amount,
              price: newPosition.entryPrice,
              expected_edge: ((signal.targetPrice - signal.entryPrice) / signal.entryPrice) * 100,
              status: 'executed',
              executed_at: new Date().toISOString(),
            });
          }
        }
        
        // ========== 8. STATUS LOG ==========
        if (cycleCount % 10 === 0) {
          console.log(`\n📈 [STATUS] Cycle ${cycleCount} | ${regime.toUpperCase()} | Pos: ${positions.length} | Exp: ${exposurePercent.toFixed(1)}% | P&L: $${totalPnL.toFixed(2)}`);
        }
        
      } catch (cycleError) {
        console.error(`❌ [ERROR] Cycle ${cycleCount}:`, cycleError);
      }
      
      // Wait for next decision
      const elapsed = Date.now() - cycleStart;
      const sleepTime = Math.max(MASTER_CONFIG.decisionInterval - elapsed, 100);
      await new Promise(r => setTimeout(r, sleepTime));
    }

    // ========== FINAL SUMMARY ==========
    console.log('\n' + '═'.repeat(60));
    console.log('🧠 [MASTER BRAIN] Session Complete');
    console.log('═'.repeat(60));
    console.log(`Duration: ${durationSeconds}s | Cycles: ${cycleCount}`);
    console.log(`Total Trades: ${totalTrades} | Total P&L: $${totalPnL.toFixed(2)}`);
    console.log(`Open Positions: ${positions.length}`);
    console.log('\nBy Strategy:');
    for (const [strategy, stats] of Object.entries(strategyStats)) {
      if (stats.trades > 0) {
        console.log(`  ${strategy}: ${stats.trades} trades, $${stats.pnl.toFixed(2)} P&L`);
      }
    }
    console.log('═'.repeat(60));

    // Update system state
    await supabase.from('trading_system_state').upsert({
      id: 'master-brain',
      is_active: true,
      total_trades: totalTrades,
      total_pnl: totalPnL,
      last_heartbeat: new Date().toISOString(),
      settings: { regime: lastRegime, positions: positions.length },
    });

    return new Response(JSON.stringify({
      success: true,
      cycles: cycleCount,
      totalTrades,
      totalPnL,
      openPositions: positions.length,
      strategyStats,
      lastRegime,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('🧠 [MASTER BRAIN] Fatal error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
