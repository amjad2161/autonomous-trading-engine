import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { gateSign } from "../_shared/gate-sign.ts";
import { guardSpotOrder } from "../_shared/safety.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============ MASTER CONFIGURATION ============
const MASTER_CONFIG = {
  regimes: {
    trending: { momentum: 0.4, whale: 0.3, grid: 0.1, dca: 0.2 },
    ranging: { momentum: 0.1, whale: 0.2, grid: 0.5, dca: 0.2 },
    volatile: { momentum: 0.2, whale: 0.4, grid: 0.1, dca: 0.3 },
    crash: { momentum: 0.0, whale: 0.1, grid: 0.2, dca: 0.7 },
    pump: { momentum: 0.5, whale: 0.3, grid: 0.1, dca: 0.1 },
  },
  maxTotalExposure: 0.7,
  maxSinglePosition: 0.15,
  maxDailyLoss: -0.05,
  maxOpenPositions: 12,
  minTradeSize: 5,
  reallocation: {
    minEdgeImprovement: 0.5,
    dustThreshold: 1.0,
    minHoldTime: 30,
    forceLiquidateAt: -2.0,
    opportunityCostWeight: 0.3,
  },
  decisionInterval: 500,
  staleDataThreshold: 5000,
};

// ============ PAPER TRADING MODE ============
interface PaperState {
  balance: number;
  positions: Map<string, { amount: number; entryPrice: number }>;
}

interface SystemSettings {
  paperMode: boolean;
  allocations: Record<string, number>;
  isActive: boolean;
}

async function getSystemSettings(supabase: ReturnType<typeof createClient>): Promise<SystemSettings> {
  try {
    const { data } = await supabase
      .from('trading_system_state')
      .select('*')
      .eq('id', 'master-brain')
      .maybeSingle();
    
    if (!data) {
      return {
        paperMode: false,
        isActive: true,
        allocations: { momentum: 0.3, whale: 0.25, grid: 0.2, dca: 0.25 },
      };
    }
    
    const record = data as unknown as { settings?: Record<string, unknown>; is_active?: boolean };
    const settings = record.settings || {};
    
    return {
      paperMode: Boolean(settings.paper_mode),
      isActive: record.is_active !== false,
      allocations: {
        momentum: (settings.momentum_allocation as number) || 0.3,
        whale: (settings.whale_allocation as number) || 0.25,
        grid: (settings.grid_allocation as number) || 0.2,
        dca: (settings.dca_allocation as number) || 0.25,
      },
    };
  } catch {
    return {
      paperMode: false,
      isActive: true,
      allocations: { momentum: 0.3, whale: 0.25, grid: 0.2, dca: 0.25 },
    };
  }
}

// ============ TYPES ============
type MarketRegime = 'trending' | 'ranging' | 'volatile' | 'crash' | 'pump';
type Strategy = 'momentum' | 'whale' | 'grid' | 'dca';

interface Signal {
  strategy: Strategy;
  symbol: string;
  action: 'buy' | 'sell';
  strength: number;
  expectedEdge: number;
  reason: string;
  suggestedSize: number;
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  timeframe: number;
  urgency: number;
}

interface Position {
  id: string;
  symbol: string;
  strategy: Strategy;
  entryPrice: number;
  amount: number;
  usdValue: number;
  currentValue: number;
  pnlPercent: number;
  stopLoss: number;
  takeProfit: number;
  timestamp: number;
  trailingStop?: number;
}

interface WalletBalance {
  currency: string;
  available: number;
  usdValue: number;
}

interface MarketData {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  spread: number;
  volume24h: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volatility: number;
  lastUpdate: number;
}

// ============ GATE.IO API ============
async function gateRequest(
  method: string, endpoint: string, apiKey: string, apiSecret: string,
  params: Record<string, string> = {}, body?: unknown
): Promise<unknown> {
  // SAFETY GATE: honour DRY_RUN / kill switch / risk caps for live order POSTs.
  if (method === 'POST' && endpoint.includes('/spot/orders') && body) {
    const __sim = guardSpotOrder('master-brain', body as Record<string, unknown>);
    if (__sim) return __sim;
  }
  const baseUrl = 'https://api.gateio.ws';
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const queryString = new URLSearchParams(params).toString();
  const bodyString = body ? JSON.stringify(body) : '';
  
  const signature = await gateSign(method, endpoint, queryString, bodyString, timestamp, apiSecret);
  
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
  usdtBalance: number;
  walletBalances: WalletBalance[];
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
  
  const now = Date.now();
  const markets: MarketData[] = tickers
    .filter(t => t.currency_pair.endsWith('_USDT'))
    .map(t => {
      const price = parseFloat(t.last);
      const high = parseFloat(t.high_24h);
      const low = parseFloat(t.low_24h);
      const bid = parseFloat(t.highest_bid);
      const ask = parseFloat(t.lowest_ask);
      
      return {
        symbol: t.currency_pair,
        price,
        bid,
        ask,
        spread: price > 0 ? ((ask - bid) / price) * 100 : 0,
        volume24h: parseFloat(t.quote_volume),
        change24h: parseFloat(t.change_percentage),
        high24h: high,
        low24h: low,
        volatility: price > 0 ? ((high - low) / price) * 100 : 0,
        lastUpdate: now,
      };
    })
    .filter(m => m.price > 0 && m.volume24h > 50000);
  
  // Calculate wallet balances with USD values
  const walletBalances: WalletBalance[] = [];
  let usdtBalance = 0;
  
  for (const acc of accounts) {
    const available = parseFloat(acc.available) + parseFloat(acc.locked || '0');
    if (available <= 0) continue;
    
    if (acc.currency === 'USDT') {
      usdtBalance = available;
      walletBalances.push({ currency: 'USDT', available, usdValue: available });
    } else {
      const market = markets.find(m => m.symbol === `${acc.currency}_USDT`);
      if (market) {
        const usdValue = available * market.price;
        walletBalances.push({ currency: acc.currency, available, usdValue });
      }
    }
  }
  
  return { usdtBalance, walletBalances, markets };
}

async function executeOrder(
  apiKey: string, apiSecret: string,
  symbol: string, side: 'buy' | 'sell', amount: string,
  refPrice = 0,
): Promise<{ success: boolean; orderId?: string; filledAmount?: number; avgPrice?: number; error?: string }> {
  try {
    const result = await gateRequest('POST', '/api/v4/spot/orders', apiKey, apiSecret, {}, {
      currency_pair: symbol,
      type: 'market',
      side,
      // Gate spot MARKET orders: for BUY, `amount` is the quote (USDT) to spend;
      // for SELL, `amount` is the base quantity. Callers pass the side-correct unit.
      amount,
      time_in_force: 'ioc',
    }) as { id?: string; amount?: string; filled_amount?: string; filled_total?: string; avg_deal_price?: string; message?: string };

    if (result.id) {
      // Always report the BASE quantity actually filled, never the submitted
      // amount (which is quote for a market buy). `refPrice` (the caller's market
      // price) backstops avg_deal_price, which is absent in the DRY_RUN synthetic
      // order — without it a simulated market buy would misread quote as base.
      const avg = parseFloat(result.avg_deal_price || '0') || refPrice;
      let base: number;
      if (side === 'sell') {
        // SELL amount/fills are already base.
        base = parseFloat(result.filled_amount || '0');
        if (base <= 0) {
          const ft = parseFloat(result.filled_total || '0');
          if (ft > 0 && avg > 0) base = ft / avg;
        }
      } else {
        // BUY: submitted amount and fills are QUOTE; convert to base via price.
        const q = parseFloat(result.filled_total || '0') || parseFloat(amount || '0');
        base = (q > 0 && avg > 0) ? q / avg : 0;
      }
      // Require an actual fill. An unfilled IOC still returns an id; treating it
      // as success would create a phantom position on a buy and book a
      // mark-to-market P&L as realized on an unfilled exit.
      if (base <= 0) {
        return { success: false, orderId: result.id, error: 'IOC order not filled' };
      }
      return {
        success: true,
        orderId: result.id,
        filledAmount: base,
        avgPrice: avg,
      };
    }
    return { success: false, error: result.message || 'Unknown error' };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

// ============ SMART CAPITAL REALLOCATION ============
interface ReallocationDecision {
  type: 'liquidate' | 'convert_dust' | 'swap';
  position?: Position;
  balance?: WalletBalance;
  reason: string;
  freedAmount: number;
  forOpportunity?: Signal;
}

function evaluateReallocation(
  positions: Position[],
  walletBalances: WalletBalance[],
  signals: Signal[],
  freeUsdt: number,
  markets: MarketData[]
): ReallocationDecision[] {
  const decisions: ReallocationDecision[] = [];
  const now = Date.now();
  
  // 1. CONVERT DUST - Small balances that aren't worth keeping
  for (const balance of walletBalances) {
    if (balance.currency === 'USDT') continue;
    if (balance.usdValue < MASTER_CONFIG.reallocation.dustThreshold && balance.usdValue > 0.1) {
      decisions.push({
        type: 'convert_dust',
        balance,
        reason: `Dust cleanup: ${balance.currency} worth $${balance.usdValue.toFixed(2)}`,
        freedAmount: balance.usdValue * 0.995, // Account for fees
      });
    }
  }
  
  // 2. SMART SWAP - Close position for better opportunity
  const topOpportunities = signals.filter(s => s.expectedEdge > 0.5).slice(0, 5);
  
  for (const opportunity of topOpportunities) {
    // Skip if we have enough free capital
    if (freeUsdt >= opportunity.suggestedSize) continue;
    
    // Find worst performing position that can be swapped
    const swappablePositions = positions
      .filter(p => {
        const holdTime = (now - p.timestamp) / 1000;
        return holdTime >= MASTER_CONFIG.reallocation.minHoldTime;
      })
      .sort((a, b) => a.pnlPercent - b.pnlPercent); // Worst first
    
    for (const pos of swappablePositions) {
      // Calculate if swap is worth it
      const currentPotential = pos.pnlPercent < 0 ? pos.pnlPercent : (pos.takeProfit - pos.entryPrice) / pos.entryPrice * 100 - pos.pnlPercent;
      const edgeImprovement = opportunity.expectedEdge - currentPotential;
      
      if (edgeImprovement >= MASTER_CONFIG.reallocation.minEdgeImprovement) {
        // Force liquidate losing positions for much better opportunities
        if (pos.pnlPercent <= MASTER_CONFIG.reallocation.forceLiquidateAt || edgeImprovement >= 1.0) {
          decisions.push({
            type: 'swap',
            position: pos,
            reason: `Swap ${pos.symbol} (${pos.pnlPercent.toFixed(2)}%) for ${opportunity.symbol} (+${opportunity.expectedEdge.toFixed(2)}% edge)`,
            freedAmount: pos.currentValue * 0.995,
            forOpportunity: opportunity,
          });
          break; // One swap per opportunity
        }
      }
    }
  }
  
  // 3. FORCE LIQUIDATE - Very bad positions
  for (const pos of positions) {
    if (pos.pnlPercent <= -3.0) { // -3% or worse
      const holdTime = (now - pos.timestamp) / 1000;
      if (holdTime > 60) { // Held for over a minute
        decisions.push({
          type: 'liquidate',
          position: pos,
          reason: `Force liquidate ${pos.symbol} at ${pos.pnlPercent.toFixed(2)}% - cut losses`,
          freedAmount: pos.currentValue * 0.995,
        });
      }
    }
  }
  
  return decisions;
}

// ============ MARKET REGIME DETECTION ============
function detectMarketRegime(markets: MarketData[]): { regime: MarketRegime; confidence: number } {
  const topMarkets = markets.sort((a, b) => b.volume24h - a.volume24h).slice(0, 20);
  
  const avgChange = topMarkets.reduce((s, m) => s + m.change24h, 0) / topMarkets.length;
  const avgVolatility = topMarkets.reduce((s, m) => s + m.volatility, 0) / topMarkets.length;
  const bullishCount = topMarkets.filter(m => m.change24h > 2).length;
  const bearishCount = topMarkets.filter(m => m.change24h < -2).length;
  
  if (avgChange < -5 || bearishCount >= 15) return { regime: 'crash', confidence: Math.min(Math.abs(avgChange) * 5, 95) };
  if (avgChange > 5 || bullishCount >= 15) return { regime: 'pump', confidence: Math.min(avgChange * 5, 95) };
  if (avgVolatility > 8) return { regime: 'volatile', confidence: Math.min(avgVolatility * 5, 85) };
  if (Math.abs(avgChange) > 2 && avgVolatility > 3) return { regime: 'trending', confidence: Math.min(Math.abs(avgChange) * 10, 80) };
  
  return { regime: 'ranging', confidence: Math.max(60 - avgVolatility * 5, 40) };
}

// ============ SIGNAL GENERATION ============
function generateSignals(
  markets: MarketData[],
  regime: MarketRegime,
  freeUsdt: number,
  positions: Position[],
  allocation: Record<Strategy, number>
): Signal[] {
  const signals: Signal[] = [];
  
  for (const market of markets.slice(0, 50)) {
    if (positions.some(p => p.symbol === market.symbol)) continue;
    
    const positionInRange = market.price > 0 ? (market.price - market.low24h) / (market.high24h - market.low24h) : 0.5;
    
    // MOMENTUM - Breakout
    if (allocation.momentum > 0.05 && market.change24h >= 4 && positionInRange >= 0.9) {
      const expectedEdge = Math.min(market.change24h * 0.3, 3);
      signals.push({
        strategy: 'momentum',
        symbol: market.symbol,
        action: 'buy',
        strength: Math.min(market.change24h * 8, 95),
        expectedEdge,
        reason: `Breakout +${market.change24h.toFixed(1)}%`,
        suggestedSize: freeUsdt * allocation.momentum * 0.3,
        entryPrice: market.price,
        targetPrice: market.price * (1 + expectedEdge / 100),
        stopLoss: market.price * 0.985,
        timeframe: 180,
        urgency: Math.min(market.change24h * 5, 90),
      });
    }
    
    // MOMENTUM - Oversold bounce
    if (allocation.momentum > 0.05 && market.change24h <= -6 && positionInRange <= 0.15) {
      const expectedEdge = Math.abs(market.change24h) * 0.25;
      signals.push({
        strategy: 'momentum',
        symbol: market.symbol,
        action: 'buy',
        strength: Math.min(Math.abs(market.change24h) * 6, 90),
        expectedEdge,
        reason: `Oversold bounce ${market.change24h.toFixed(1)}%`,
        suggestedSize: freeUsdt * allocation.momentum * 0.25,
        entryPrice: market.price,
        targetPrice: market.price * (1 + expectedEdge / 100),
        stopLoss: market.low24h * 0.98,
        timeframe: 300,
        urgency: 70,
      });
    }
    
    // WHALE - Volume spike
    if (allocation.whale > 0.05 && market.change24h > 3 && positionInRange > 0.7 && market.volume24h > 1000000) {
      const expectedEdge = 1.2;
      signals.push({
        strategy: 'whale',
        symbol: market.symbol,
        action: 'buy',
        strength: Math.min(market.change24h * 10, 90),
        expectedEdge,
        reason: `Whale activity detected`,
        suggestedSize: freeUsdt * allocation.whale * 0.4,
        entryPrice: market.price,
        targetPrice: market.price * 1.012,
        stopLoss: market.price * 0.992,
        timeframe: 120,
        urgency: 85,
      });
    }
    
    // GRID - Ranging market
    if (allocation.grid > 0.05 && regime === 'ranging' && market.spread >= 0.15 && market.volatility >= 2 && market.volatility <= 6) {
      const expectedEdge = market.spread * 0.6;
      signals.push({
        strategy: 'grid',
        symbol: market.symbol,
        action: 'buy',
        strength: Math.min(market.spread * 100, 85),
        expectedEdge,
        reason: `Grid: ${market.spread.toFixed(2)}% spread`,
        suggestedSize: freeUsdt * allocation.grid * 0.2,
        entryPrice: market.bid + (market.spread * market.price / 400),
        targetPrice: market.ask - (market.spread * market.price / 400),
        stopLoss: market.bid * 0.995,
        timeframe: 60,
        urgency: 50,
      });
    }
    
    // DCA - Dip buying
    if (allocation.dca > 0.05 && market.change24h <= -4 && market.volume24h > 500000) {
      const dcaCount = positions.filter(p => p.symbol === market.symbol && p.strategy === 'dca').length;
      if (dcaCount < 5) {
        const multiplier = Math.pow(1.5, dcaCount);
        const expectedEdge = 2.5;
        signals.push({
          strategy: 'dca',
          symbol: market.symbol,
          action: 'buy',
          strength: Math.min(Math.abs(market.change24h) * 10, 85),
          expectedEdge,
          reason: `DCA Level ${dcaCount + 1}: ${market.change24h.toFixed(1)}%`,
          suggestedSize: freeUsdt * allocation.dca * 0.2 * multiplier,
          entryPrice: market.price,
          targetPrice: market.price * 1.025,
          stopLoss: market.price * 0.95,
          timeframe: 3600,
          urgency: 40,
        });
      }
    }
  }
  
  return signals.sort((a, b) => (b.strength + b.urgency) / 2 - (a.strength + a.urgency) / 2);
}

// ============ POSITION MANAGEMENT ============
function evaluatePositions(positions: Position[], markets: MarketData[]): { exits: { pos: Position; reason: string; pnl: number }[] } {
  const exits: { pos: Position; reason: string; pnl: number }[] = [];
  const now = Date.now();
  
  for (const pos of positions) {
    const market = markets.find(m => m.symbol === pos.symbol);
    if (!market) continue;
    
    const holdTime = (now - pos.timestamp) / 1000;
    
    const targets = {
      momentum: { tp: 1.5, sl: -1.0, maxHold: 180 },
      whale: { tp: 1.0, sl: -0.8, maxHold: 120 },
      grid: { tp: 0.4, sl: -0.5, maxHold: 300 },
      dca: { tp: 2.5, sl: -4.0, maxHold: 7200 },
    }[pos.strategy];
    
    if (pos.pnlPercent >= targets.tp) {
      exits.push({ pos, reason: `TP ${pos.pnlPercent.toFixed(2)}%`, pnl: pos.pnlPercent });
    } else if (pos.pnlPercent <= targets.sl) {
      exits.push({ pos, reason: `SL ${pos.pnlPercent.toFixed(2)}%`, pnl: pos.pnlPercent });
    } else if (holdTime > targets.maxHold && pos.pnlPercent > 0.1) {
      exits.push({ pos, reason: `Time exit +${pos.pnlPercent.toFixed(2)}%`, pnl: pos.pnlPercent });
    }
  }
  
  return { exits };
}

// ============ MAIN BRAIN LOOP ============
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  try {
    const { durationSeconds = 300 } = await req.json();
    const startTime = Date.now();
    const endTime = startTime + durationSeconds * 1000;
    
    const apiKey = Deno.env.get('GATE_API_KEY');
    const apiSecret = Deno.env.get('GATE_API_SECRET');
    
    if (!apiKey || !apiSecret) throw new Error('Missing Gate.io credentials');

    console.log(`\n🧠 [MASTER BRAIN] Starting with smart capital reallocation (${durationSeconds}s)`);
    
    const positions: Position[] = [];
    let totalPnL = 0;
    let totalTrades = 0;
    let reallocations = 0;
    let dustConverted = 0;
    let lastRegime: MarketRegime = 'ranging';
    let cycleCount = 0;

    while (Date.now() < endTime) {
      cycleCount++;
      
      try {
        const { usdtBalance, walletBalances, markets } = await getFullState(apiKey, apiSecret);
        
        // Update position values
        for (const pos of positions) {
          const market = markets.find(m => m.symbol === pos.symbol);
          if (market) {
            pos.currentValue = pos.amount * market.price;
            pos.pnlPercent = ((market.price - pos.entryPrice) / pos.entryPrice) * 100;
          }
        }
        
        const lockedInPositions = positions.reduce((s, p) => s + p.currentValue, 0);
        const totalBalance = usdtBalance + lockedInPositions;
        const freeUsdt = usdtBalance;
        
        // Detect regime
        const { regime, confidence } = detectMarketRegime(markets);
        if (regime !== lastRegime) {
          console.log(`📊 [REGIME] ${lastRegime} → ${regime} (${confidence.toFixed(0)}%)`);
          lastRegime = regime;
        }
        
        const allocation = MASTER_CONFIG.regimes[regime];
        
        // ========== 1. EXIT EXISTING POSITIONS ==========
        const { exits } = evaluatePositions(positions, markets);
        
        for (const { pos, reason, pnl } of exits) {
          const market = markets.find(m => m.symbol === pos.symbol);
          if (!market) continue;
          
          const sellAmount = (pos.amount * 0.998).toFixed(6);
          const result = await executeOrder(apiKey, apiSecret, pos.symbol, 'sell', sellAmount);
          
          if (result.success) {
            const pnlUsd = pos.usdValue * (pnl / 100);
            totalPnL += pnlUsd;
            totalTrades++;
            
            console.log(`✅ [EXIT] ${pos.symbol} | ${reason} | $${pnlUsd.toFixed(2)}`);
            
            await supabase.from('trade_history').insert({
              symbol: pos.symbol.replace('_', '/'),
              type: pos.strategy,
              side: 'sell',
              amount: pos.amount,
              price: market.price,
              actual_pnl: pnlUsd,
              status: 'executed',
            });
            
            const idx = positions.findIndex(p => p.id === pos.id);
            if (idx > -1) positions.splice(idx, 1);
          }
        }
        
        // ========== 2. GENERATE SIGNALS ==========
        const signals = generateSignals(markets, regime, freeUsdt, positions, allocation);
        
        // ========== 3. SMART REALLOCATION ==========
        const reallocationDecisions = evaluateReallocation(positions, walletBalances, signals, freeUsdt, markets);
        
        for (const decision of reallocationDecisions) {
          if (decision.type === 'convert_dust' && decision.balance) {
            const symbol = `${decision.balance.currency}_USDT`;
            const market = markets.find(m => m.symbol === symbol);
            if (!market) continue;
            
            const sellAmount = (decision.balance.available * 0.99).toFixed(6);
            const result = await executeOrder(apiKey, apiSecret, symbol, 'sell', sellAmount);
            
            if (result.success) {
              dustConverted += decision.freedAmount;
              console.log(`🧹 [DUST] Converted ${decision.balance.currency} → +$${decision.freedAmount.toFixed(2)} USDT`);
            }
          } else if (decision.type === 'swap' && decision.position && decision.forOpportunity) {
            const pos = decision.position;
            const opp = decision.forOpportunity;
            const market = markets.find(m => m.symbol === pos.symbol);
            if (!market) continue;
            
            // Sell current position
            const sellAmount = (pos.amount * 0.998).toFixed(6);
            const sellResult = await executeOrder(apiKey, apiSecret, pos.symbol, 'sell', sellAmount);
            
            if (sellResult.success) {
              const pnlUsd = pos.usdValue * (pos.pnlPercent / 100);
              totalPnL += pnlUsd;
              
              console.log(`🔄 [SWAP] Sold ${pos.symbol} (${pos.pnlPercent.toFixed(2)}%) → Buying ${opp.symbol}`);
              
              // Remove old position
              const idx = positions.findIndex(p => p.id === pos.id);
              if (idx > -1) positions.splice(idx, 1);
              
              // Buy new opportunity
              const oppMarket = markets.find(m => m.symbol === opp.symbol);
              if (oppMarket) {
                // Market BUY: send the quote (USDT) to spend; store the BASE size
                // from the actual fill (fallback to a base estimate, never the quote).
                const buyQuote = decision.freedAmount.toFixed(6);
                const buyResult = await executeOrder(apiKey, apiSecret, opp.symbol, 'buy', buyQuote, oppMarket.price);

                if (buyResult.success) {
                  positions.push({
                    id: `${opp.symbol}-${Date.now()}`,
                    symbol: opp.symbol,
                    strategy: opp.strategy,
                    entryPrice: buyResult.avgPrice || oppMarket.price,
                    amount: buyResult.filledAmount || (decision.freedAmount / oppMarket.price),
                    usdValue: decision.freedAmount,
                    currentValue: decision.freedAmount,
                    pnlPercent: 0,
                    stopLoss: opp.stopLoss,
                    takeProfit: opp.targetPrice,
                    timestamp: Date.now(),
                  });
                  
                  reallocations++;
                  totalTrades += 2;
                  console.log(`   ✅ Entered ${opp.symbol} @ $${oppMarket.price.toFixed(6)}`);
                }
              }
            }
          } else if (decision.type === 'liquidate' && decision.position) {
            const pos = decision.position;
            const market = markets.find(m => m.symbol === pos.symbol);
            if (!market) continue;
            
            const sellAmount = (pos.amount * 0.998).toFixed(6);
            const result = await executeOrder(apiKey, apiSecret, pos.symbol, 'sell', sellAmount);
            
            if (result.success) {
              const pnlUsd = pos.usdValue * (pos.pnlPercent / 100);
              totalPnL += pnlUsd;
              totalTrades++;
              
              console.log(`⚠️ [LIQUIDATE] ${pos.symbol} | ${decision.reason} | $${pnlUsd.toFixed(2)}`);
              
              const idx = positions.findIndex(p => p.id === pos.id);
              if (idx > -1) positions.splice(idx, 1);
            }
          }
        }
        
        // ========== 4. ENTER NEW POSITIONS ==========
        if (positions.length < MASTER_CONFIG.maxOpenPositions) {
          const maxNew = Math.min(3, MASTER_CONFIG.maxOpenPositions - positions.length);
          let entered = 0;
          
          for (const signal of signals) {
            if (entered >= maxNew) break;
            if (signal.suggestedSize < MASTER_CONFIG.minTradeSize) continue;
            if (signal.suggestedSize > freeUsdt) continue;
            
            const market = markets.find(m => m.symbol === signal.symbol);
            if (!market) continue;
            
            const size = Math.min(signal.suggestedSize, totalBalance * MASTER_CONFIG.maxSinglePosition);
            // Market BUY: send the quote (USDT) to spend; store the BASE size from
            // the actual fill (fallback to a base estimate, never the quote).
            const buyQuote = size.toFixed(6);

            const result = await executeOrder(apiKey, apiSecret, signal.symbol, 'buy', buyQuote, market.price);

            if (result.success) {
              positions.push({
                id: `${signal.symbol}-${Date.now()}`,
                symbol: signal.symbol,
                strategy: signal.strategy,
                entryPrice: result.avgPrice || market.price,
                amount: result.filledAmount || (size / market.price),
                usdValue: size,
                currentValue: size,
                pnlPercent: 0,
                stopLoss: signal.stopLoss,
                takeProfit: signal.targetPrice,
                timestamp: Date.now(),
              });
              
              entered++;
              console.log(`🎯 [${signal.strategy.toUpperCase()}] ${signal.symbol} | ${signal.reason} | $${size.toFixed(2)}`);
            }
          }
        }
        
        // Status log
        if (cycleCount % 10 === 0) {
          console.log(`📈 [STATUS] Cycle ${cycleCount} | ${regime} | Pos: ${positions.length} | P&L: $${totalPnL.toFixed(2)} | Swaps: ${reallocations}`);
        }
        
      } catch (e) {
        console.error(`❌ [ERROR]`, e);
      }
      
      await new Promise(r => setTimeout(r, MASTER_CONFIG.decisionInterval));
    }

    console.log(`\n${'═'.repeat(50)}`);
    console.log(`🧠 [SUMMARY] Trades: ${totalTrades} | P&L: $${totalPnL.toFixed(2)} | Reallocations: ${reallocations} | Dust: $${dustConverted.toFixed(2)}`);

    return new Response(JSON.stringify({
      success: true,
      totalTrades,
      totalPnL,
      reallocations,
      dustConverted,
      openPositions: positions.length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('🧠 [FATAL]', error);
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
