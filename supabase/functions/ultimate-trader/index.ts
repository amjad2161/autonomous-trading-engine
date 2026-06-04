import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { gateSign } from "../_shared/gate-sign.ts";
import { guardSpotOrder } from "../_shared/safety.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============ CONFIGURATION ============
const CONFIG = {
  // Whale Tracking
  whale: {
    minVolumeSpike: 3.0,        // 3x average volume = whale activity
    followDelay: 500,           // ms to wait before following
    maxFollowSize: 0.05,        // 5% of balance per whale follow
  },
  // Grid Trading
  grid: {
    levels: 5,                  // Number of grid levels each side
    spacing: 0.003,             // 0.3% between levels
    orderSize: 0.02,            // 2% of balance per grid order
    profitTarget: 0.004,        // 0.4% profit per grid trade
  },
  // Smart DCA
  dca: {
    dipThreshold: -0.03,        // -3% = significant dip
    maxPositions: 5,            // Max DCA entries
    sizeMultiplier: 1.5,        // Each DCA 1.5x bigger
    baseSize: 0.03,             // 3% base position
  },
  // General
  maxOpenPositions: 10,
  minTradeSize: 5,              // Gate.io minimum
  maxBalanceUsage: 0.7,         // Use max 70% of balance
};

interface Position {
  symbol: string;
  side: 'buy' | 'sell';
  entryPrice: number;
  amount: number;
  strategy: 'whale' | 'grid' | 'dca' | 'momentum';
  timestamp: number;
  dcaLevel?: number;
  gridLevel?: number;
}

interface MarketData {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  volume24h: number;
  change24h: number;
  high24h: number;
  low24h: number;
}

// ============ GATE.IO API ============
async function gateRequest(
  method: string, endpoint: string, apiKey: string, apiSecret: string,
  params: Record<string, string> = {}, body?: unknown
): Promise<unknown> {
  // SAFETY GATE: honour DRY_RUN / kill switch / risk caps for live order POSTs.
  if (method === 'POST' && endpoint.includes('/spot/orders') && body) {
    const __sim = guardSpotOrder('ultimate-trader', body as Record<string, unknown>);
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

async function getBalance(apiKey: string, apiSecret: string): Promise<number> {
  const accounts = await gateRequest('GET', '/api/v4/spot/accounts', apiKey, apiSecret) as Array<{ currency: string; available: string }>;
  const usdt = accounts.find(a => a.currency === 'USDT');
  return usdt ? parseFloat(usdt.available) : 0;
}

async function getMarketData(apiKey: string, apiSecret: string): Promise<MarketData[]> {
  const tickers = await gateRequest('GET', '/api/v4/spot/tickers', apiKey, apiSecret) as Array<{
    currency_pair: string;
    last: string;
    highest_bid: string;
    lowest_ask: string;
    quote_volume: string;
    change_percentage: string;
    high_24h: string;
    low_24h: string;
  }>;
  
  return tickers
    .filter(t => t.currency_pair.endsWith('_USDT'))
    .map(t => ({
      symbol: t.currency_pair,
      price: parseFloat(t.last),
      bid: parseFloat(t.highest_bid),
      ask: parseFloat(t.lowest_ask),
      volume24h: parseFloat(t.quote_volume),
      change24h: parseFloat(t.change_percentage),
      high24h: parseFloat(t.high_24h),
      low24h: parseFloat(t.low_24h),
    }))
    .filter(m => m.price > 0 && m.volume24h > 100000);
}

async function placeOrder(
  apiKey: string, apiSecret: string,
  symbol: string, side: 'buy' | 'sell', amount: string,
  refPrice = 0,
): Promise<{ success: boolean; orderId?: string; filledAmount?: number; avgPrice?: number; error?: string }> {
  try {
    const result = await gateRequest('POST', '/api/v4/spot/orders', apiKey, apiSecret, {}, {
      currency_pair: symbol,
      type: 'market',
      side,
      // Gate spot MARKET orders: BUY `amount` is quote (USDT) to spend; SELL
      // `amount` is base quantity. Callers pass the side-correct unit.
      amount,
      time_in_force: 'ioc',
    }) as { id?: string; filled_amount?: string; filled_total?: string; avg_deal_price?: string; message?: string };

    if (result.id) {
      // Report the BASE quantity actually filled, never the submitted amount
      // (which is quote for a market buy). `refPrice` (caller's market price)
      // backstops avg_deal_price, absent in the DRY_RUN synthetic order.
      const avg = parseFloat(result.avg_deal_price || '0') || refPrice;
      let base: number;
      if (side === 'sell') {
        base = parseFloat(result.filled_amount || '0');
        if (base <= 0) {
          const ft = parseFloat(result.filled_total || '0');
          if (ft > 0 && avg > 0) base = ft / avg;
        }
      } else {
        // BUY: submitted amount and fills are QUOTE; convert to base via price.
        // Use ONLY the actual quote filled — no fallback to the submitted amount,
        // else an unfilled LIVE market buy (filled_total 0, id present) reads as
        // fully filled and opens a phantom position. DRY_RUN synthetic orders DO
        // populate filled_total, so simulation is unaffected.
        const q = parseFloat(result.filled_total || '0');
        base = (q > 0 && avg > 0) ? q / avg : 0;
      }
      // Require an actual fill — an unfilled IOC still returns an id. Treating it
      // as success would open a phantom position (buy) or book an unfilled exit.
      if (base <= 0) {
        return { success: false, orderId: result.id, error: 'IOC order not filled' };
      }
      return { success: true, orderId: result.id, filledAmount: base, avgPrice: avg };
    }
    return { success: false, error: result.message || 'Unknown error' };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

// ============ STRATEGY 1: WHALE TRACKING ============
interface WhaleSignal {
  symbol: string;
  direction: 'buy' | 'sell';
  volumeRatio: number;
  priceImpact: number;
  confidence: number;
}

function detectWhaleActivity(markets: MarketData[], historicalVolumes: Map<string, number[]>): WhaleSignal[] {
  const signals: WhaleSignal[] = [];
  
  for (const market of markets) {
    const history = historicalVolumes.get(market.symbol) || [];
    if (history.length < 3) continue;
    
    const avgVolume = history.reduce((a, b) => a + b, 0) / history.length;
    const volumeRatio = market.volume24h / avgVolume;
    
    // Whale detected: volume spike + significant price movement
    if (volumeRatio >= CONFIG.whale.minVolumeSpike) {
      const priceRange = (market.high24h - market.low24h) / market.price;
      const isNearHigh = market.price > market.high24h * 0.98;
      const isNearLow = market.price < market.low24h * 1.02;
      
      // Whale buying: volume spike + price near high + positive change
      if (isNearHigh && market.change24h > 2) {
        signals.push({
          symbol: market.symbol,
          direction: 'buy',
          volumeRatio,
          priceImpact: market.change24h,
          confidence: Math.min(volumeRatio * 20, 95),
        });
      }
      // Whale selling: volume spike + price near low + negative change
      else if (isNearLow && market.change24h < -2) {
        signals.push({
          symbol: market.symbol,
          direction: 'sell',
          volumeRatio,
          priceImpact: market.change24h,
          confidence: Math.min(volumeRatio * 20, 95),
        });
      }
    }
  }
  
  return signals.sort((a, b) => b.confidence - a.confidence).slice(0, 3);
}

// ============ STRATEGY 2: GRID TRADING ============
interface GridLevel {
  symbol: string;
  price: number;
  side: 'buy' | 'sell';
  level: number;
  filled: boolean;
}

function calculateGridLevels(market: MarketData): GridLevel[] {
  const levels: GridLevel[] = [];
  const currentPrice = market.price;
  
  // Buy levels below current price
  for (let i = 1; i <= CONFIG.grid.levels; i++) {
    levels.push({
      symbol: market.symbol,
      price: currentPrice * (1 - CONFIG.grid.spacing * i),
      side: 'buy',
      level: -i,
      filled: false,
    });
  }
  
  // Sell levels above current price
  for (let i = 1; i <= CONFIG.grid.levels; i++) {
    levels.push({
      symbol: market.symbol,
      price: currentPrice * (1 + CONFIG.grid.spacing * i),
      side: 'sell',
      level: i,
      filled: false,
    });
  }
  
  return levels;
}

function checkGridTriggers(
  market: MarketData, 
  gridLevels: GridLevel[],
  lastPrices: Map<string, number>
): GridLevel[] {
  const triggered: GridLevel[] = [];
  const lastPrice = lastPrices.get(market.symbol) || market.price;
  
  for (const level of gridLevels) {
    if (level.symbol !== market.symbol || level.filled) continue;
    
    // Check if price crossed the level
    if (level.side === 'buy' && lastPrice > level.price && market.price <= level.price) {
      triggered.push(level);
    } else if (level.side === 'sell' && lastPrice < level.price && market.price >= level.price) {
      triggered.push(level);
    }
  }
  
  return triggered;
}

// ============ STRATEGY 3: SMART DCA ============
interface DCAOpportunity {
  symbol: string;
  currentPrice: number;
  dipPercent: number;
  suggestedSize: number;
  dcaLevel: number;
}

function findDCAOpportunities(
  markets: MarketData[],
  existingPositions: Position[],
  balance: number
): DCAOpportunity[] {
  const opportunities: DCAOpportunity[] = [];
  
  for (const market of markets) {
    // Look for significant dips
    if (market.change24h > CONFIG.dca.dipThreshold * 100) continue;
    
    // Check existing positions for this symbol
    const symbolPositions = existingPositions.filter(
      p => p.symbol === market.symbol && p.strategy === 'dca'
    );
    
    if (symbolPositions.length >= CONFIG.dca.maxPositions) continue;
    
    // Calculate DCA level and size
    const dcaLevel = symbolPositions.length + 1;
    const sizeMultiplier = Math.pow(CONFIG.dca.sizeMultiplier, dcaLevel - 1);
    const suggestedSize = balance * CONFIG.dca.baseSize * sizeMultiplier;
    
    // Check if price is below average entry (for existing positions)
    if (symbolPositions.length > 0) {
      const avgEntry = symbolPositions.reduce((sum, p) => sum + p.entryPrice * p.amount, 0) /
                       symbolPositions.reduce((sum, p) => sum + p.amount, 0);
      
      // Only DCA if current price is at least 2% below average
      if (market.price > avgEntry * 0.98) continue;
    }
    
    opportunities.push({
      symbol: market.symbol,
      currentPrice: market.price,
      dipPercent: market.change24h,
      suggestedSize,
      dcaLevel,
    });
  }
  
  return opportunities
    .sort((a, b) => a.dipPercent - b.dipPercent) // Bigger dips first
    .slice(0, 3);
}

// ============ STRATEGY 4: MOMENTUM SCANNER ============
interface MomentumSignal {
  symbol: string;
  direction: 'long' | 'short';
  strength: number;
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
}

function scanMomentum(markets: MarketData[]): MomentumSignal[] {
  const signals: MomentumSignal[] = [];
  
  for (const market of markets) {
    const range = market.high24h - market.low24h;
    const volatility = range / market.price;
    
    // Skip low volatility pairs
    if (volatility < 0.02 || volatility > 0.15) continue;
    
    const pricePosition = (market.price - market.low24h) / range;
    
    // Strong uptrend near high with momentum
    if (market.change24h >= 4 && pricePosition >= 0.85) {
      signals.push({
        symbol: market.symbol,
        direction: 'long',
        strength: Math.min(market.change24h / 10, 1) * 100,
        entryPrice: market.price,
        targetPrice: market.price * 1.015,
        stopLoss: market.price * 0.99,
      });
    }
    // Oversold bounce opportunity
    else if (market.change24h <= -6 && pricePosition <= 0.2) {
      signals.push({
        symbol: market.symbol,
        direction: 'long',
        strength: Math.min(Math.abs(market.change24h) / 12, 1) * 100,
        entryPrice: market.price,
        targetPrice: market.price * 1.02,
        stopLoss: market.low24h * 0.98,
      });
    }
  }
  
  return signals.sort((a, b) => b.strength - a.strength).slice(0, 5);
}

// ============ POSITION MANAGEMENT ============
function checkExitConditions(
  positions: Position[],
  markets: MarketData[]
): { position: Position; reason: string; pnl: number }[] {
  const exits: { position: Position; reason: string; pnl: number }[] = [];
  const now = Date.now();
  
  for (const position of positions) {
    const market = markets.find(m => m.symbol === position.symbol);
    if (!market) continue;
    
    const pnlPercent = ((market.price - position.entryPrice) / position.entryPrice) * 100;
    const holdTime = (now - position.timestamp) / 1000; // seconds
    
    // Take profit based on strategy
    const tpTarget = position.strategy === 'whale' ? 1.0 :
                     position.strategy === 'grid' ? 0.4 :
                     position.strategy === 'dca' ? 2.0 : 1.5;
    
    if (pnlPercent >= tpTarget) {
      exits.push({ position, reason: `TP hit (${pnlPercent.toFixed(2)}%)`, pnl: pnlPercent });
      continue;
    }
    
    // Stop loss
    const slTarget = position.strategy === 'whale' ? -0.8 :
                     position.strategy === 'grid' ? -0.5 :
                     position.strategy === 'dca' ? -3.0 : -1.5;
    
    if (pnlPercent <= slTarget) {
      exits.push({ position, reason: `SL hit (${pnlPercent.toFixed(2)}%)`, pnl: pnlPercent });
      continue;
    }
    
    // Time-based exits
    const maxHoldTime = position.strategy === 'whale' ? 120 :
                        position.strategy === 'grid' ? 300 :
                        position.strategy === 'dca' ? 3600 : 180;
    
    if (holdTime > maxHoldTime && pnlPercent > 0.1) {
      exits.push({ position, reason: `Time exit with profit`, pnl: pnlPercent });
    }
  }
  
  return exits;
}

// ============ MAIN TRADING LOOP ============
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { durationSeconds = 300 } = await req.json();
    const startTime = Date.now();
    const endTime = startTime + durationSeconds * 1000;
    
    const apiKey = Deno.env.get('GATE_API_KEY');
    const apiSecret = Deno.env.get('GATE_API_SECRET');
    
    if (!apiKey || !apiSecret) {
      throw new Error('Missing Gate.io credentials');
    }

    console.log(`[Ultimate Trader] Starting ${durationSeconds}s trading session with all strategies`);
    
    // State
    const positions: Position[] = [];
    const historicalVolumes = new Map<string, number[]>();
    const lastPrices = new Map<string, number>();
    const gridLevels: GridLevel[] = [];
    let totalTrades = 0;
    let totalPnL = 0;
    
    // Stats per strategy
    const stats = {
      whale: { trades: 0, pnl: 0 },
      grid: { trades: 0, pnl: 0 },
      dca: { trades: 0, pnl: 0 },
      momentum: { trades: 0, pnl: 0 },
    };

    while (Date.now() < endTime) {
      const cycleStart = Date.now();
      
      try {
        // Get current state
        const [balance, markets] = await Promise.all([
          getBalance(apiKey, apiSecret),
          getMarketData(apiKey, apiSecret),
        ]);
        
        const availableBalance = balance * CONFIG.maxBalanceUsage;
        const usedBalance = positions.reduce((sum, p) => sum + p.amount * p.entryPrice, 0);
        const freeBalance = availableBalance - usedBalance;
        
        console.log(`[Ultimate] Balance: $${balance.toFixed(2)} | Positions: ${positions.length} | Free: $${freeBalance.toFixed(2)}`);
        
        // Update historical data
        for (const market of markets.slice(0, 50)) {
          const history = historicalVolumes.get(market.symbol) || [];
          history.push(market.volume24h);
          if (history.length > 10) history.shift();
          historicalVolumes.set(market.symbol, history);
        }
        
        // ========== CHECK EXITS FIRST ==========
        const exits = checkExitConditions(positions, markets);
        for (const exit of exits) {
          const market = markets.find(m => m.symbol === exit.position.symbol);
          if (!market) continue;
          
          const sellAmount = (exit.position.amount * 0.998).toFixed(6); // Account for fees
          const result = await placeOrder(apiKey, apiSecret, exit.position.symbol, 'sell', sellAmount, market.price);
          
          if (result.success) {
            console.log(`[EXIT] ${exit.position.symbol} | ${exit.reason} | PnL: ${exit.pnl.toFixed(2)}%`);
            stats[exit.position.strategy].trades++;
            stats[exit.position.strategy].pnl += exit.pnl;
            totalTrades++;
            totalPnL += exit.pnl;
            
            // Remove position
            const idx = positions.indexOf(exit.position);
            if (idx > -1) positions.splice(idx, 1);
          }
        }
        
        // Skip new entries if too many positions
        if (positions.length >= CONFIG.maxOpenPositions) {
          console.log('[Ultimate] Max positions reached, waiting for exits...');
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }
        
        // ========== STRATEGY 1: WHALE TRACKING ==========
        if (freeBalance >= CONFIG.minTradeSize) {
          const whaleSignals = detectWhaleActivity(markets, historicalVolumes);
          
          for (const signal of whaleSignals.slice(0, 1)) { // Max 1 whale trade per cycle
            if (signal.direction !== 'buy') continue; // Only follow buys for now
            
            const market = markets.find(m => m.symbol === signal.symbol);
            if (!market) continue;
            
            const tradeSize = Math.min(freeBalance * CONFIG.whale.maxFollowSize, freeBalance);
            if (tradeSize < CONFIG.minTradeSize) continue;
            
            // Market BUY: send quote (USDT) to spend; store BASE size from the fill.
            const buyQuote = tradeSize.toFixed(6);

            console.log(`[WHALE] Following ${signal.symbol} | Vol: ${signal.volumeRatio.toFixed(1)}x | Conf: ${signal.confidence}%`);

            await new Promise(r => setTimeout(r, CONFIG.whale.followDelay));
            const result = await placeOrder(apiKey, apiSecret, signal.symbol, 'buy', buyQuote, market.price);

            if (result.success) {
              positions.push({
                symbol: signal.symbol,
                side: 'buy',
                entryPrice: result.avgPrice || market.price,
                amount: result.filledAmount || (tradeSize / market.price),
                strategy: 'whale',
                timestamp: Date.now(),
              });
              console.log(`[WHALE] Entered ${signal.symbol} @ $${market.price}`);
            }
          }
        }
        
        // ========== STRATEGY 2: GRID TRADING ==========
        // Initialize grid for top volatile pairs
        if (gridLevels.length === 0) {
          const gridPairs = markets
            .filter(m => m.volume24h > 500000)
            .sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h))
            .slice(0, 3);
          
          for (const pair of gridPairs) {
            gridLevels.push(...calculateGridLevels(pair));
          }
          console.log(`[GRID] Initialized ${gridLevels.length} grid levels for ${gridPairs.length} pairs`);
        }
        
        // Check grid triggers
        for (const market of markets) {
          const triggered = checkGridTriggers(market, gridLevels, lastPrices);
          
          for (const level of triggered) {
            if (freeBalance < CONFIG.minTradeSize) break;
            
            const tradeSize = Math.min(freeBalance * CONFIG.grid.orderSize, freeBalance);
            if (tradeSize < CONFIG.minTradeSize) continue;

            // Market order units differ by side: BUY spends quote (USDT), SELL
            // sends base quantity.
            const baseEst = tradeSize / market.price;
            const orderAmount = level.side === 'buy' ? tradeSize.toFixed(6) : baseEst.toFixed(6);

            console.log(`[GRID] ${level.side.toUpperCase()} ${level.symbol} @ level ${level.level}`);
            const result = await placeOrder(apiKey, apiSecret, level.symbol, level.side, orderAmount, market.price);

            if (result.success) {
              level.filled = true;

              if (level.side === 'buy') {
                positions.push({
                  symbol: level.symbol,
                  side: 'buy',
                  entryPrice: result.avgPrice || market.price,
                  amount: result.filledAmount || baseEst,
                  strategy: 'grid',
                  timestamp: Date.now(),
                  gridLevel: level.level,
                });
              }
            }
          }
          
          lastPrices.set(market.symbol, market.price);
        }
        
        // ========== STRATEGY 3: SMART DCA ==========
        const dcaOpportunities = findDCAOpportunities(markets, positions, freeBalance);
        
        for (const opp of dcaOpportunities.slice(0, 1)) { // Max 1 DCA per cycle
          if (opp.suggestedSize < CONFIG.minTradeSize) continue;
          if (freeBalance < opp.suggestedSize) continue;
          
          const market = markets.find(m => m.symbol === opp.symbol);
          if (!market) continue;
          
          // Market BUY: send quote (USDT) to spend; store BASE size from the fill.
          const buyQuote = opp.suggestedSize.toFixed(6);

          console.log(`[DCA] Level ${opp.dcaLevel} entry ${opp.symbol} | Dip: ${opp.dipPercent.toFixed(1)}%`);
          const result = await placeOrder(apiKey, apiSecret, opp.symbol, 'buy', buyQuote, market.price);

          if (result.success) {
            positions.push({
              symbol: opp.symbol,
              side: 'buy',
              entryPrice: result.avgPrice || market.price,
              amount: result.filledAmount || (opp.suggestedSize / market.price),
              strategy: 'dca',
              timestamp: Date.now(),
              dcaLevel: opp.dcaLevel,
            });
          }
        }
        
        // ========== STRATEGY 4: MOMENTUM ==========
        const momentumSignals = scanMomentum(markets);
        
        for (const signal of momentumSignals.slice(0, 1)) { // Max 1 momentum per cycle
          // Skip if already have position in this symbol
          if (positions.some(p => p.symbol === signal.symbol)) continue;
          
          const tradeSize = Math.min(freeBalance * 0.1, freeBalance);
          if (tradeSize < CONFIG.minTradeSize) continue;
          
          const market = markets.find(m => m.symbol === signal.symbol);
          if (!market) continue;
          
          // Market BUY: send quote (USDT) to spend; store BASE size from the fill.
          const buyQuote = tradeSize.toFixed(6);

          console.log(`[MOMENTUM] ${signal.direction.toUpperCase()} ${signal.symbol} | Strength: ${signal.strength.toFixed(0)}%`);
          const result = await placeOrder(apiKey, apiSecret, signal.symbol, 'buy', buyQuote, market.price);

          if (result.success) {
            positions.push({
              symbol: signal.symbol,
              side: 'buy',
              entryPrice: result.avgPrice || market.price,
              amount: result.filledAmount || (tradeSize / market.price),
              strategy: 'momentum',
              timestamp: Date.now(),
            });
          }
        }
        
      } catch (cycleError) {
        console.error('[Ultimate] Cycle error:', cycleError);
      }
      
      // Fast polling interval
      const elapsed = Date.now() - cycleStart;
      const sleepTime = Math.max(500 - elapsed, 100);
      await new Promise(r => setTimeout(r, sleepTime));
    }
    
    // Final summary
    console.log(`\n[Ultimate Trader] Session Complete!`);
    console.log(`Total Trades: ${totalTrades} | Total PnL: ${totalPnL.toFixed(2)}%`);
    console.log(`Whale: ${stats.whale.trades} trades, ${stats.whale.pnl.toFixed(2)}% PnL`);
    console.log(`Grid: ${stats.grid.trades} trades, ${stats.grid.pnl.toFixed(2)}% PnL`);
    console.log(`DCA: ${stats.dca.trades} trades, ${stats.dca.pnl.toFixed(2)}% PnL`);
    console.log(`Momentum: ${stats.momentum.trades} trades, ${stats.momentum.pnl.toFixed(2)}% PnL`);
    console.log(`Open Positions: ${positions.length}`);

    return new Response(JSON.stringify({
      success: true,
      totalTrades,
      totalPnL,
      stats,
      openPositions: positions.length,
      duration: durationSeconds,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[Ultimate Trader] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
