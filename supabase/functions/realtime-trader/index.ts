import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHash, createHmac } from "https://deno.land/std@0.168.0/node/crypto.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ===== BASE CONFIG (adjusted dynamically by Market Regime) =====
const BASE_CONFIG = {
  // Base thresholds (will be adjusted)
  minEdge: 0.15,
  maxSpread: 0.5,
  minVolume: 100_000,
  
  // Position sizing
  minPositionUsdt: 3,
  maxPositionUsdt: 15,
  positionPct: 50,
  
  // WebSocket settings
  wsConnectTimeout: 5000,
  tickBufferSize: 50,
  analysisWindowMs: 3000,
  
  // Pairs to monitor
  watchPairs: [
    'DOGE_USDT', 'XRP_USDT', 'ADA_USDT', 'MATIC_USDT', 'LINK_USDT',
    'AVAX_USDT', 'DOT_USDT', 'UNI_USDT', 'ATOM_USDT', 'LTC_USDT',
    'NEAR_USDT', 'APT_USDT', 'OP_USDT', 'ARB_USDT', 'FIL_USDT',
    'PEPE_USDT', 'SHIB_USDT', 'FLOKI_USDT', 'WIF_USDT', 'BONK_USDT',
  ],
  
  // Execution limits
  maxTradesPerCycle: 3,
  cooldownMs: 2000,
  runDurationMs: 55000,
};

// ===== MARKET REGIME TYPES =====
type MarketRegime = 'trending_up' | 'trending_down' | 'ranging' | 'volatile' | 'crash' | 'pump';

interface DynamicConfig {
  minEdge: number;
  maxSpread: number;
  minVolume: number;
  positionPct: number;
  maxPositionUsdt: number;
  tradingEnabled: boolean;
  regime: MarketRegime;
  regimeConfidence: number;
}

// ===== MARKET REGIME DETECTION =====
function detectMarketRegime(tickBuffers: Map<string, TickBuffer>): { regime: MarketRegime; confidence: number; avgChange: number; volatility: number } {
  const changes: number[] = [];
  const volatilities: number[] = [];
  
  for (const [, buffer] of tickBuffers) {
    if (buffer.ticks.length < 10) continue;
    
    const prices = buffer.ticks.slice(-20).map(t => t.price);
    if (prices.length < 5) continue;
    
    // Calculate change from first to last
    const change = ((prices[prices.length - 1] - prices[0]) / prices[0]) * 100;
    changes.push(change);
    
    // Calculate volatility (standard deviation)
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
    const stdDev = Math.sqrt(variance);
    const volatility = (stdDev / mean) * 100;
    volatilities.push(volatility);
  }
  
  if (changes.length < 3) {
    return { regime: 'ranging', confidence: 50, avgChange: 0, volatility: 0 };
  }
  
  const avgChange = changes.reduce((a, b) => a + b, 0) / changes.length;
  const avgVolatility = volatilities.reduce((a, b) => a + b, 0) / volatilities.length;
  
  // Count positive vs negative changes
  const positiveCount = changes.filter(c => c > 0.1).length;
  const negativeCount = changes.filter(c => c < -0.1).length;
  const directionality = (positiveCount - negativeCount) / changes.length;
  
  let regime: MarketRegime;
  let confidence: number;
  
  // CRASH: Strong negative movement across most pairs
  if (avgChange < -2 && negativeCount / changes.length > 0.7) {
    regime = 'crash';
    confidence = Math.min(90, 50 + Math.abs(avgChange) * 10);
  }
  // PUMP: Strong positive movement across most pairs
  else if (avgChange > 2 && positiveCount / changes.length > 0.7) {
    regime = 'pump';
    confidence = Math.min(90, 50 + avgChange * 10);
  }
  // VOLATILE: High volatility without clear direction
  else if (avgVolatility > 1.5 && Math.abs(directionality) < 0.3) {
    regime = 'volatile';
    confidence = Math.min(85, 50 + avgVolatility * 15);
  }
  // TRENDING UP: Consistent positive movement
  else if (avgChange > 0.5 && directionality > 0.4) {
    regime = 'trending_up';
    confidence = Math.min(80, 50 + directionality * 50);
  }
  // TRENDING DOWN: Consistent negative movement
  else if (avgChange < -0.5 && directionality < -0.4) {
    regime = 'trending_down';
    confidence = Math.min(80, 50 + Math.abs(directionality) * 50);
  }
  // RANGING: Low volatility, no clear direction
  else {
    regime = 'ranging';
    confidence = 60;
  }
  
  return { regime, confidence, avgChange, volatility: avgVolatility };
}

// ===== DYNAMIC CONFIG BASED ON REGIME =====
function getAdaptiveConfig(regime: MarketRegime, confidence: number): DynamicConfig {
  switch (regime) {
    case 'crash':
      // HALT trading during crash - protect capital
      return {
        minEdge: 1.0,           // Very high edge required
        maxSpread: 0.2,         // Only very liquid pairs
        minVolume: 500_000,     // High volume only
        positionPct: 10,        // Minimal position size
        maxPositionUsdt: 5,
        tradingEnabled: false,  // STOP trading
        regime,
        regimeConfidence: confidence,
      };
      
    case 'pump':
      // Aggressive during pump - ride the wave
      return {
        minEdge: 0.1,           // Lower edge acceptable
        maxSpread: 0.6,
        minVolume: 80_000,
        positionPct: 70,        // Larger positions
        maxPositionUsdt: 20,
        tradingEnabled: true,
        regime,
        regimeConfidence: confidence,
      };
      
    case 'volatile':
      // Conservative during high volatility
      return {
        minEdge: 0.3,           // Higher edge required
        maxSpread: 0.4,
        minVolume: 200_000,     // Higher volume for safety
        positionPct: 30,        // Smaller positions
        maxPositionUsdt: 10,
        tradingEnabled: true,
        regime,
        regimeConfidence: confidence,
      };
      
    case 'trending_up':
      // Aggressive on uptrend
      return {
        minEdge: 0.12,          // Lower edge OK in trend
        maxSpread: 0.5,
        minVolume: 100_000,
        positionPct: 60,        // Larger positions
        maxPositionUsdt: 18,
        tradingEnabled: true,
        regime,
        regimeConfidence: confidence,
      };
      
    case 'trending_down':
      // Conservative on downtrend
      return {
        minEdge: 0.25,          // Higher edge for protection
        maxSpread: 0.3,
        minVolume: 150_000,
        positionPct: 35,
        maxPositionUsdt: 10,
        tradingEnabled: true,
        regime,
        regimeConfidence: confidence,
      };
      
    case 'ranging':
    default:
      // Normal parameters for ranging market
      return {
        minEdge: BASE_CONFIG.minEdge,
        maxSpread: BASE_CONFIG.maxSpread,
        minVolume: BASE_CONFIG.minVolume,
        positionPct: BASE_CONFIG.positionPct,
        maxPositionUsdt: BASE_CONFIG.maxPositionUsdt,
        tradingEnabled: true,
        regime,
        regimeConfidence: confidence,
      };
  }
}

// Active config (updated dynamically)
let CONFIG = { ...BASE_CONFIG };

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

async function getBalance(key: string, secret: string): Promise<number> {
  const accounts = await gate('GET', '/spot/accounts', key, secret) as Array<{ currency: string; available: string }>;
  const usdt = accounts.find(a => a.currency === 'USDT');
  return parseFloat(usdt?.available || '0');
}

async function getPairInfo(symbol: string): Promise<{ min: number; prec: number; minQuote: number } | null> {
  try {
    const pairs = await fetch(`https://api.gateio.ws/api/v4/spot/currency_pairs/${symbol}`).then(r => r.json()) as {
      min_base_amount?: string; amount_precision?: number; min_quote_amount?: string;
    };
    return {
      min: parseFloat(pairs.min_base_amount || '0.0001'),
      prec: pairs.amount_precision || 4,
      minQuote: parseFloat(pairs.min_quote_amount || '1'),
    };
  } catch {
    return null;
  }
}

// ===== TICK DATA STRUCTURES =====
interface Tick {
  price: number;
  bid: number;
  ask: number;
  volume: number;
  timestamp: number;
}

interface TickBuffer {
  ticks: Tick[];
  lastUpdate: number;
}

// ===== TICK ANALYSIS =====
function analyzeTickBuffer(buffer: TickBuffer): {
  velocity: number;      // Price change rate per second
  momentum: number;      // Directional strength (-1 to +1)
  volumeSpike: number;   // Volume vs average
  spread: number;        // Current spread %
  signal: 'buy' | 'sell' | 'hold';
  edge: number;
} {
  const ticks = buffer.ticks;
  if (ticks.length < 5) {
    return { velocity: 0, momentum: 0, volumeSpike: 1, spread: 0, signal: 'hold', edge: 0 };
  }
  
  const recent = ticks.slice(-10);
  const oldest = recent[0];
  const newest = recent[recent.length - 1];
  
  // Velocity: price change per second
  const timeDiff = (newest.timestamp - oldest.timestamp) / 1000;
  const priceChange = (newest.price - oldest.price) / oldest.price * 100;
  const velocity = timeDiff > 0 ? priceChange / timeDiff : 0;
  
  // Momentum: count of up vs down ticks
  let upTicks = 0, downTicks = 0;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i].price > recent[i-1].price) upTicks++;
    else if (recent[i].price < recent[i-1].price) downTicks++;
  }
  const momentum = (upTicks - downTicks) / Math.max(upTicks + downTicks, 1);
  
  // Volume spike
  const avgVolume = ticks.reduce((s, t) => s + t.volume, 0) / ticks.length;
  const recentVolume = recent.slice(-3).reduce((s, t) => s + t.volume, 0) / 3;
  const volumeSpike = avgVolume > 0 ? recentVolume / avgVolume : 1;
  
  // Current spread
  const spread = newest.ask > 0 ? ((newest.ask - newest.bid) / newest.ask) * 100 : 0;
  
  // Generate signal
  let signal: 'buy' | 'sell' | 'hold' = 'hold';
  let edge = 0;
  
  // Strong upward momentum with volume
  if (velocity > 0.05 && momentum > 0.3 && volumeSpike > 1.2 && spread < CONFIG.maxSpread) {
    signal = 'buy';
    edge = Math.min(velocity * 0.5, 2) - spread - 0.2; // Minus fees
  }
  // Strong downward for potential short or skip
  else if (velocity < -0.1 && momentum < -0.4) {
    signal = 'sell'; // Exit signal
    edge = Math.abs(velocity) * 0.3;
  }
  // Spread arbitrage opportunity
  else if (spread > 0.3 && spread < 0.8 && volumeSpike > 1.5) {
    signal = 'buy';
    edge = spread - 0.2; // Spread minus fees
  }
  
  return { velocity, momentum, volumeSpike, spread, signal, edge };
}

// ===== MAIN ENGINE =====
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const start = Date.now();
  const results: Array<{ t: number; s?: string; a: string; p?: number }> = [];
  let trades = 0, pnl = 0;

  try {
    const key = Deno.env.get('GATE_API_KEY');
    const secret = Deno.env.get('GATE_API_SECRET');
    if (!key || !secret) throw new Error("No API credentials");

    console.log(`🚀 [REALTIME-TRADER] Starting WebSocket-based trading`);

    // Initialize tick buffers for each pair
    const tickBuffers = new Map<string, TickBuffer>();
    for (const pair of CONFIG.watchPairs) {
      tickBuffers.set(pair, { ticks: [], lastUpdate: 0 });
    }

    // Track recent trades
    const recentTrades = new Map<string, number>();
    const pairInfo = new Map<string, { min: number; prec: number; minQuote: number }>();

    // Get pair info for all watched pairs
    await Promise.all(CONFIG.watchPairs.slice(0, 10).map(async (pair) => {
      const info = await getPairInfo(pair);
      if (info) pairInfo.set(pair, info);
    }));

    // Connect to Gate.io WebSocket
    const ws = new WebSocket('wss://api.gateio.ws/ws/v4/');
    let wsReady = false;
    let lastTickTime = Date.now();

    const wsReadyPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('WebSocket timeout')), CONFIG.wsConnectTimeout);
      
      ws.onopen = () => {
        console.log('[WS] Connected to Gate.io');
        clearTimeout(timeout);
        
        // Subscribe to tickers for all pairs
        ws.send(JSON.stringify({
          time: Math.floor(Date.now() / 1000),
          channel: 'spot.tickers',
          event: 'subscribe',
          payload: CONFIG.watchPairs,
        }));
        
        wsReady = true;
        resolve();
      };

      ws.onerror = (e) => {
        console.error('[WS] Error:', e);
        reject(new Error('WebSocket error'));
      };
    });

    // Handle incoming ticks
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.event === 'update' && data.result) {
          const result = data.result;
          const pair = result.currency_pair;
          
          if (pair && tickBuffers.has(pair)) {
            const buffer = tickBuffers.get(pair)!;
            const tick: Tick = {
              price: parseFloat(result.last || '0'),
              bid: parseFloat(result.highest_bid || '0'),
              ask: parseFloat(result.lowest_ask || '0'),
              volume: parseFloat(result.quote_volume || '0'),
              timestamp: Date.now(),
            };
            
            if (tick.price > 0) {
              buffer.ticks.push(tick);
              buffer.lastUpdate = Date.now();
              lastTickTime = Date.now();
              
              // Keep buffer size limited
              if (buffer.ticks.length > CONFIG.tickBufferSize) {
                buffer.ticks.shift();
              }
            }
          }
        }
      } catch (e) {
        // Ignore parse errors
      }
    };

    // Wait for WebSocket connection
    await wsReadyPromise;
    console.log('[WS] Subscribed to', CONFIG.watchPairs.length, 'pairs');

    // Give time for initial ticks to arrive
    await new Promise(r => setTimeout(r, 2000));

    // Main trading loop
    let cycle = 0;
    let lastRegimeCheck = 0;
    let activeConfig: DynamicConfig = getAdaptiveConfig('ranging', 60);
    const endTime = start + CONFIG.runDurationMs;

    while (Date.now() < endTime) {
      cycle++;
      const cycleStart = Date.now();

      // ===== MARKET REGIME CHECK (every 10 cycles) =====
      if (cycle - lastRegimeCheck >= 10 || cycle === 1) {
        const regimeResult = detectMarketRegime(tickBuffers);
        activeConfig = getAdaptiveConfig(regimeResult.regime, regimeResult.confidence);
        lastRegimeCheck = cycle;
        
        console.log(`📊 [${cycle}] REGIME: ${activeConfig.regime.toUpperCase()} (${activeConfig.regimeConfidence.toFixed(0)}%) | Edge≥${activeConfig.minEdge.toFixed(2)}% Vol≥$${(activeConfig.minVolume/1000).toFixed(0)}K | Trading: ${activeConfig.tradingEnabled ? '✅' : '⛔'}`);
        
        // Log regime to system_log
        if (cycle === 1 || regimeResult.regime !== activeConfig.regime) {
          await supabase.from('system_log').insert({
            level: activeConfig.tradingEnabled ? 'info' : 'warn',
            component: 'REGIME',
            message: `${activeConfig.regime.toUpperCase()} detected | Conf: ${activeConfig.regimeConfidence.toFixed(0)}% | AvgChange: ${regimeResult.avgChange.toFixed(2)}% | Vol: ${regimeResult.volatility.toFixed(2)}%`,
            details: { regime: activeConfig.regime, confidence: activeConfig.regimeConfidence, minEdge: activeConfig.minEdge, minVolume: activeConfig.minVolume },
          });
        }
      }

      // ===== SKIP IF TRADING DISABLED (crash protection) =====
      if (!activeConfig.tradingEnabled) {
        console.log(`⛔ [${cycle}] Trading disabled - ${activeConfig.regime} regime`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      // Check for stale data
      if (Date.now() - lastTickTime > 5000) {
        console.log(`⚠️ [${cycle}] No ticks for 5s, waiting...`);
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }

      // Get balance
      const usdt = await getBalance(key, secret);
      if (usdt < CONFIG.minPositionUsdt) {
        console.log(`💰 [${cycle}] Low balance: $${usdt.toFixed(2)}`);
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }

      // Analyze all pairs and find opportunities
      interface Opportunity {
        pair: string;
        signal: 'buy' | 'sell';
        edge: number;
        velocity: number;
        momentum: number;
        spread: number;
        price: number;
        bid: number;
        ask: number;
      }
      const opportunities: Opportunity[] = [];

      for (const [pair, buffer] of tickBuffers) {
        // Skip if recently traded
        const lastTrade = recentTrades.get(pair);
        if (lastTrade && Date.now() - lastTrade < CONFIG.cooldownMs) continue;

        // Skip if not enough data
        if (buffer.ticks.length < 5) continue;

        // Analyze
        const analysis = analyzeTickBuffer(buffer);
        const latestTick = buffer.ticks[buffer.ticks.length - 1];

        // Use DYNAMIC thresholds from activeConfig
        if (analysis.signal === 'buy' && 
            analysis.edge >= activeConfig.minEdge && 
            analysis.spread <= activeConfig.maxSpread &&
            latestTick.volume >= activeConfig.minVolume) {
          opportunities.push({
            pair,
            signal: 'buy',
            edge: analysis.edge,
            velocity: analysis.velocity,
            momentum: analysis.momentum,
            spread: analysis.spread,
            price: latestTick.price,
            bid: latestTick.bid,
            ask: latestTick.ask,
          });
        }
      }

      // Sort by edge and execute best
      opportunities.sort((a, b) => b.edge - a.edge);

      if (opportunities.length > 0) {
        const best = opportunities[0];
        const info = pairInfo.get(best.pair);
        
        if (!info) {
          const newInfo = await getPairInfo(best.pair);
          if (newInfo) pairInfo.set(best.pair, newInfo);
        }
        
        const pInfo = pairInfo.get(best.pair);
        if (pInfo) {
          // Calculate position size using DYNAMIC config
          let posSize = Math.min(usdt * (activeConfig.positionPct / 100), activeConfig.maxPositionUsdt);
          posSize = Math.max(posSize, BASE_CONFIG.minPositionUsdt);
          
          // Check minimums
          if (posSize < pInfo.minQuote) {
            console.log(`⏭️ [${cycle}] ${best.pair} minQuote $${pInfo.minQuote} > $${posSize.toFixed(2)}`);
          } else {
            const mult = Math.pow(10, pInfo.prec);
            let amount = posSize / best.ask;
            if (amount < pInfo.min) amount = pInfo.min * 1.05;
            amount = Math.floor(amount * mult) / mult;
            
            if (amount >= pInfo.min) {
              console.log(`⚡ [${cycle}] ${best.pair}: vel=${best.velocity.toFixed(3)}/s mom=${best.momentum.toFixed(2)} edge=${best.edge.toFixed(3)}%`);

              try {
                // BUY
                const buyOrder = await gate('POST', '/spot/orders', key, secret, {
                  currency_pair: best.pair,
                  side: 'buy',
                  type: 'market',
                  amount: amount.toFixed(pInfo.prec),
                  time_in_force: 'ioc',
                }) as { id?: string; avg_deal_price?: string; filled_total?: string };

                const buyFilled = parseFloat(buyOrder.filled_total || '0');
                const buyPrice = parseFloat(buyOrder.avg_deal_price || best.ask.toString());

                if (buyFilled >= 1) {
                  const boughtAmount = buyFilled / buyPrice;
                  
                  // SELL IMMEDIATELY
                  const sellAmt = (boughtAmount * 0.998).toFixed(pInfo.prec);
                  
                  const sellOrder = await gate('POST', '/spot/orders', key, secret, {
                    currency_pair: best.pair,
                    side: 'sell',
                    type: 'market',
                    amount: sellAmt,
                    time_in_force: 'ioc',
                  }) as { id?: string; avg_deal_price?: string; filled_total?: string };

                  const sellFilled = parseFloat(sellOrder.filled_total || '0');
                  const sellPrice = parseFloat(sellOrder.avg_deal_price || best.bid.toString());

                  const netPnl = sellFilled - buyFilled;
                  const netPnlPct = (netPnl / buyFilled) * 100;

                  trades += 2;
                  pnl += netPnlPct;
                  recentTrades.set(best.pair, Date.now());

                  // Log trades
                  await supabase.from('trade_history').insert([
                    {
                      symbol: best.pair, side: 'buy', type: 'RT', amount: boughtAmount,
                      price: buyPrice, expected_edge: best.edge, actual_pnl: 0,
                      order_id: buyOrder.id, status: 'executed', executed_at: new Date().toISOString(),
                    },
                    {
                      symbol: best.pair, side: 'sell', type: 'RT', amount: parseFloat(sellAmt),
                      price: sellPrice, expected_edge: best.edge, actual_pnl: netPnl,
                      order_id: sellOrder.id, status: 'executed', executed_at: new Date().toISOString(),
                    }
                  ]);

                  const emoji = netPnl >= 0 ? '✅' : '❌';
                  console.log(`${emoji} [${cycle}] RT ${best.pair} Buy@${buyPrice.toFixed(6)} Sell@${sellPrice.toFixed(6)} = $${netPnl.toFixed(4)} (${netPnlPct.toFixed(3)}%)`);
                  results.push({ t: cycle, s: best.pair, a: 'RT', p: netPnlPct });
                } else {
                  console.log(`⚠️ [${cycle}] ${best.pair} Buy not filled`);
                  results.push({ t: cycle, s: best.pair, a: 'nofill' });
                }
              } catch (e) {
                const msg = e instanceof Error ? e.message : 'Unknown';
                console.log(`❌ [${cycle}] ${best.pair}: ${msg.slice(0, 60)}`);
                results.push({ t: cycle, s: best.pair, a: 'fail' });
                recentTrades.set(best.pair, Date.now() + 10000); // Longer cooldown on error
              }
            }
          }
        }
      } else {
        results.push({ t: cycle, a: 'scan' });
      }

      // Wait for next cycle (500ms intervals for fast reaction)
      const elapsed = Date.now() - cycleStart;
      const wait = Math.max(0, 500 - elapsed);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
    }

    // Cleanup
    ws.close();

    const duration = Date.now() - start;
    console.log(`🏁 [REALTIME-TRADER] ${cycle} cycles | ${trades} trades | ${pnl >= 0 ? '+' : ''}${pnl.toFixed(3)}% | ${duration}ms`);

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
