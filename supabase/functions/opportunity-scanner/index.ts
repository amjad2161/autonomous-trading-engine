import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createHmac } from "https://deno.land/std@0.177.0/node/crypto.ts";
import { encodeHex } from "https://deno.land/std@0.224.0/encoding/hex.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GateCredentials {
  apiKey: string;
  apiSecret: string;
}

interface Ticker {
  currency_pair: string;
  last: string;
  lowest_ask: string;
  highest_bid: string;
  change_percentage: string;
  base_volume: string;
  quote_volume: string;
  high_24h: string;
  low_24h: string;
}

interface Opportunity {
  id: string;
  type: 'arbitrage' | 'spread' | 'breakout' | 'reversion' | 'momentum' | 'volume_spike';
  symbol: string;
  expectedEdge: number;
  confidence: number;
  expiresIn: number;
  riskLevel: 'low' | 'medium' | 'high';
  details: string;
  route?: string[];
  action: 'buy' | 'sell';
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
}

interface ScanRequest {
  credentials?: GateCredentials;
  minSpread?: number;
  minVolume?: number;
}

// ============ UTILITY FUNCTIONS ============

async function sha512Hash(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-512', msgBuffer);
  return encodeHex(new Uint8Array(hashBuffer));
}

async function generateSignature(
  method: string,
  url: string,
  queryString: string,
  payloadString: string,
  timestamp: string,
  secret: string
): Promise<string> {
  const hashedPayload = await sha512Hash(payloadString);
  const signatureString = `${method}\n${url}\n${queryString}\n${hashedPayload}\n${timestamp}`;
  return createHmac('sha512', secret).update(signatureString).digest('hex');
}

async function fetchTickers(credentials?: GateCredentials): Promise<Ticker[]> {
  const baseUrl = 'https://api.gateio.ws';
  const endpoint = '/api/v4/spot/tickers';
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  if (credentials) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = await generateSignature('GET', endpoint, '', '', timestamp, credentials.apiSecret);
    headers['KEY'] = credentials.apiKey;
    headers['SIGN'] = signature;
    headers['Timestamp'] = timestamp;
  }

  const response = await fetch(`${baseUrl}${endpoint}`, { headers });
  return await response.json();
}

// ============ STRATEGY 1: SPREAD/MARKET MAKING ============

function findSpreadOpportunities(tickers: Ticker[], minSpread: number, minVolume: number): Opportunity[] {
  const opportunities: Opportunity[] = [];
  
  const usdtPairs = tickers.filter(t => 
    t.currency_pair.endsWith('_USDT') && 
    parseFloat(t.quote_volume) >= minVolume
  );

  for (const ticker of usdtPairs) {
    const bid = parseFloat(ticker.highest_bid);
    const ask = parseFloat(ticker.lowest_ask);
    const last = parseFloat(ticker.last);
    
    if (bid <= 0 || ask <= 0 || last <= 0) continue;
    
    const spreadPercent = ((ask - bid) / last) * 100;
    
    if (spreadPercent >= minSpread) {
      const fees = 0.2;
      const netEdge = spreadPercent - fees;
      
      if (netEdge > 0) {
        const volume = parseFloat(ticker.quote_volume);
        const volumeScore = Math.min(volume / 1000000, 1) * 50;
        const spreadScore = Math.min(spreadPercent / 1, 1) * 50;
        const confidence = Math.round(volumeScore + spreadScore);
        
        const riskLevel = spreadPercent > 0.5 ? 'high' : spreadPercent > 0.3 ? 'medium' : 'low';
        const midPrice = (bid + ask) / 2;
        
        opportunities.push({
          id: `spread-${ticker.currency_pair}-${Date.now()}`,
          type: 'spread',
          symbol: ticker.currency_pair.replace('_', '/'),
          expectedEdge: netEdge,
          confidence,
          expiresIn: 30,
          riskLevel,
          details: `Bid: $${bid.toFixed(6)} | Ask: $${ask.toFixed(6)} | Spread: ${spreadPercent.toFixed(3)}%`,
          action: 'buy',
          entryPrice: bid + (spreadPercent * last / 400), // Slightly above bid
          targetPrice: ask - (spreadPercent * last / 400), // Slightly below ask
          stopLoss: bid * 0.995, // 0.5% below bid
        });
      }
    }
  }

  return opportunities.sort((a, b) => b.expectedEdge - a.expectedEdge).slice(0, 10);
}

// ============ STRATEGY 2: TRIANGULAR ARBITRAGE ============

function findTriangularArbitrage(tickers: Ticker[], minVolume: number): Opportunity[] {
  const opportunities: Opportunity[] = [];
  
  const priceMap: Record<string, { bid: number; ask: number; volume: number }> = {};
  
  for (const ticker of tickers) {
    const bid = parseFloat(ticker.highest_bid);
    const ask = parseFloat(ticker.lowest_ask);
    const volume = parseFloat(ticker.quote_volume);
    
    if (bid > 0 && ask > 0) {
      priceMap[ticker.currency_pair] = { bid, ask, volume };
    }
  }

  const altCoins = ['SOL', 'XRP', 'DOGE', 'ADA', 'MATIC', 'LINK', 'AVAX', 'DOT', 'UNI', 'ATOM', 'LTC', 'BCH', 'NEAR', 'APT', 'OP', 'ARB'];

  for (const coin of altCoins) {
    // Path: USDT -> Coin -> BTC -> USDT
    const coinUsdt = priceMap[`${coin}_USDT`];
    const coinBtc = priceMap[`${coin}_BTC`];
    const btcUsdt = priceMap['BTC_USDT'];

    if (coinUsdt && coinBtc && btcUsdt && coinUsdt.volume >= minVolume) {
      // Forward
      const step1 = 1 / coinUsdt.ask;
      const step2 = step1 * coinBtc.bid;
      const step3 = step2 * btcUsdt.bid;
      
      const forwardProfit = ((step3 - 1) * 100) - 0.6;
      
      if (forwardProfit > 0.05) {
        const confidence = Math.min(Math.round(forwardProfit * 100), 95);
        opportunities.push({
          id: `arb-${coin}-BTC-${Date.now()}`,
          type: 'arbitrage',
          symbol: `${coin}`,
          expectedEdge: forwardProfit,
          confidence,
          expiresIn: 10,
          riskLevel: forwardProfit > 0.3 ? 'high' : forwardProfit > 0.15 ? 'medium' : 'low',
          details: `Route: USDT → ${coin} → BTC → USDT`,
          route: ['USDT', coin, 'BTC', 'USDT'],
          action: 'buy',
          entryPrice: coinUsdt.ask,
          targetPrice: coinUsdt.ask * (1 + forwardProfit / 100),
          stopLoss: coinUsdt.ask * 0.99,
        });
      }

      // Reverse
      const revStep1 = 1 / btcUsdt.ask;
      const revStep2 = revStep1 / coinBtc.ask;
      const revStep3 = revStep2 * coinUsdt.bid;
      
      const reverseProfit = ((revStep3 - 1) * 100) - 0.6;
      
      if (reverseProfit > 0.05) {
        const confidence = Math.min(Math.round(reverseProfit * 100), 95);
        opportunities.push({
          id: `arb-${coin}-BTC-rev-${Date.now()}`,
          type: 'arbitrage',
          symbol: `${coin}`,
          expectedEdge: reverseProfit,
          confidence,
          expiresIn: 10,
          riskLevel: reverseProfit > 0.3 ? 'high' : reverseProfit > 0.15 ? 'medium' : 'low',
          details: `Route: USDT → BTC → ${coin} → USDT`,
          route: ['USDT', 'BTC', coin, 'USDT'],
          action: 'buy',
          entryPrice: btcUsdt.ask,
          targetPrice: btcUsdt.ask * (1 + reverseProfit / 100),
          stopLoss: btcUsdt.ask * 0.99,
        });
      }
    }

    // Path: USDT -> Coin -> ETH -> USDT
    const coinEth = priceMap[`${coin}_ETH`];
    const ethUsdt = priceMap['ETH_USDT'];

    if (coinUsdt && coinEth && ethUsdt && coinUsdt.volume >= minVolume) {
      const step1 = 1 / coinUsdt.ask;
      const step2 = step1 * coinEth.bid;
      const step3 = step2 * ethUsdt.bid;
      
      const profit = ((step3 - 1) * 100) - 0.6;
      
      if (profit > 0.05) {
        const confidence = Math.min(Math.round(profit * 100), 95);
        opportunities.push({
          id: `arb-${coin}-ETH-${Date.now()}`,
          type: 'arbitrage',
          symbol: `${coin}`,
          expectedEdge: profit,
          confidence,
          expiresIn: 10,
          riskLevel: profit > 0.3 ? 'high' : profit > 0.15 ? 'medium' : 'low',
          details: `Route: USDT → ${coin} → ETH → USDT`,
          route: ['USDT', coin, 'ETH', 'USDT'],
          action: 'buy',
          entryPrice: coinUsdt.ask,
          targetPrice: coinUsdt.ask * (1 + profit / 100),
          stopLoss: coinUsdt.ask * 0.99,
        });
      }
    }
  }

  return opportunities.sort((a, b) => b.expectedEdge - a.expectedEdge).slice(0, 5);
}

// ============ STRATEGY 3: MOMENTUM ============

function findMomentumOpportunities(tickers: Ticker[], minVolume: number): Opportunity[] {
  const opportunities: Opportunity[] = [];
  
  const usdtPairs = tickers.filter(t => 
    t.currency_pair.endsWith('_USDT') && 
    parseFloat(t.quote_volume) >= minVolume
  );

  for (const ticker of usdtPairs) {
    const change = parseFloat(ticker.change_percentage);
    const last = parseFloat(ticker.last);
    const volume = parseFloat(ticker.quote_volume);
    const high24h = parseFloat(ticker.high_24h);
    const low24h = parseFloat(ticker.low_24h);
    
    if (last <= 0 || high24h <= 0 || low24h <= 0) continue;
    
    // Strong upward momentum: >3% gain with price near 24h high
    const pricePositionInRange = (last - low24h) / (high24h - low24h);
    
    if (change >= 3 && pricePositionInRange >= 0.8) {
      // Momentum continuation play
      const expectedContinuation = Math.min(change * 0.3, 2); // Expect 30% of current move, max 2%
      const fees = 0.2;
      const netEdge = expectedContinuation - fees;
      
      if (netEdge > 0.1) {
        const volumeScore = Math.min(volume / 2000000, 1) * 40;
        const momentumScore = Math.min(change / 10, 1) * 40;
        const positionScore = pricePositionInRange * 20;
        const confidence = Math.round(volumeScore + momentumScore + positionScore);
        
        opportunities.push({
          id: `momentum-bull-${ticker.currency_pair}-${Date.now()}`,
          type: 'momentum',
          symbol: ticker.currency_pair.replace('_', '/'),
          expectedEdge: netEdge,
          confidence,
          expiresIn: 60,
          riskLevel: change > 10 ? 'high' : change > 5 ? 'medium' : 'low',
          details: `24h: +${change.toFixed(2)}% | Near high | Vol: $${(volume/1000000).toFixed(2)}M`,
          action: 'buy',
          entryPrice: last,
          targetPrice: last * (1 + expectedContinuation / 100),
          stopLoss: last * 0.98, // 2% stop loss
        });
      }
    }
    
    // Strong downward momentum for short (if available) or mean reversion
    if (change <= -5 && pricePositionInRange <= 0.3) {
      // Oversold bounce play
      const expectedBounce = Math.abs(change) * 0.2; // Expect 20% retracement
      const fees = 0.2;
      const netEdge = expectedBounce - fees;
      
      if (netEdge > 0.2) {
        const volumeScore = Math.min(volume / 2000000, 1) * 40;
        const oversoldScore = Math.min(Math.abs(change) / 15, 1) * 40;
        const positionScore = (1 - pricePositionInRange) * 20;
        const confidence = Math.round(volumeScore + oversoldScore + positionScore);
        
        opportunities.push({
          id: `momentum-reversal-${ticker.currency_pair}-${Date.now()}`,
          type: 'reversion',
          symbol: ticker.currency_pair.replace('_', '/'),
          expectedEdge: netEdge,
          confidence,
          expiresIn: 120,
          riskLevel: change < -15 ? 'high' : change < -8 ? 'medium' : 'low',
          details: `24h: ${change.toFixed(2)}% | Near low | Oversold bounce potential`,
          action: 'buy',
          entryPrice: last,
          targetPrice: last * (1 + expectedBounce / 100),
          stopLoss: low24h * 0.98,
        });
      }
    }
  }

  return opportunities.sort((a, b) => b.expectedEdge - a.expectedEdge).slice(0, 5);
}

// ============ STRATEGY 4: VOLUME SPIKE DETECTION ============

function findVolumeSpikeOpportunities(tickers: Ticker[], minVolume: number): Opportunity[] {
  const opportunities: Opportunity[] = [];
  
  // Calculate average volume across all USDT pairs
  const usdtPairs = tickers.filter(t => t.currency_pair.endsWith('_USDT'));
  
  // Sort by quote volume to find outliers
  const sortedByVolume = usdtPairs
    .map(t => ({
      ticker: t,
      volume: parseFloat(t.quote_volume),
      change: parseFloat(t.change_percentage),
    }))
    .filter(t => t.volume >= minVolume)
    .sort((a, b) => b.volume - a.volume);

  // Top 20 by volume
  const topVolume = sortedByVolume.slice(0, 20);
  
  for (const item of topVolume) {
    const { ticker, volume, change } = item;
    const last = parseFloat(ticker.last);
    const high24h = parseFloat(ticker.high_24h);
    const low24h = parseFloat(ticker.low_24h);
    
    if (last <= 0) continue;
    
    // Volume spike with positive momentum = potential breakout
    if (volume >= 5000000 && change >= 2 && change <= 15) {
      const range = high24h - low24h;
      const volatility = (range / last) * 100;
      
      // Good volatility (2-10%) means tradeable
      if (volatility >= 2 && volatility <= 10) {
        const expectedMove = volatility * 0.15; // Expect 15% of daily volatility
        const fees = 0.2;
        const netEdge = expectedMove - fees;
        
        if (netEdge > 0.1) {
          const volumeScore = Math.min(volume / 10000000, 1) * 50;
          const volatilityScore = Math.min(volatility / 5, 1) * 30;
          const momentumScore = Math.min(change / 5, 1) * 20;
          const confidence = Math.round(volumeScore + volatilityScore + momentumScore);
          
          opportunities.push({
            id: `volume-spike-${ticker.currency_pair}-${Date.now()}`,
            type: 'volume_spike',
            symbol: ticker.currency_pair.replace('_', '/'),
            expectedEdge: netEdge,
            confidence,
            expiresIn: 90,
            riskLevel: volatility > 7 ? 'high' : volatility > 4 ? 'medium' : 'low',
            details: `Vol: $${(volume/1000000).toFixed(2)}M | Volatility: ${volatility.toFixed(2)}% | Trend: +${change.toFixed(2)}%`,
            action: 'buy',
            entryPrice: last,
            targetPrice: last * (1 + expectedMove / 100),
            stopLoss: last * (1 - volatility / 200), // Stop at half daily volatility
          });
        }
      }
    }
  }

  return opportunities.sort((a, b) => b.expectedEdge - a.expectedEdge).slice(0, 5);
}

// ============ STRATEGY 5: BREAKOUT DETECTION ============

function findBreakoutOpportunities(tickers: Ticker[], minVolume: number): Opportunity[] {
  const opportunities: Opportunity[] = [];
  
  const usdtPairs = tickers.filter(t => 
    t.currency_pair.endsWith('_USDT') && 
    parseFloat(t.quote_volume) >= minVolume
  );

  for (const ticker of usdtPairs) {
    const last = parseFloat(ticker.last);
    const high24h = parseFloat(ticker.high_24h);
    const low24h = parseFloat(ticker.low_24h);
    const change = parseFloat(ticker.change_percentage);
    const volume = parseFloat(ticker.quote_volume);
    
    if (last <= 0 || high24h <= 0 || low24h <= 0) continue;
    
    const range = high24h - low24h;
    const rangePercent = (range / last) * 100;
    
    // Breakout above 24h high
    if (last >= high24h * 0.998 && change >= 1 && rangePercent >= 3) {
      const breakoutStrength = change / rangePercent;
      const expectedContinuation = Math.min(rangePercent * 0.3, 3);
      const fees = 0.2;
      const netEdge = expectedContinuation - fees;
      
      if (netEdge > 0.15 && breakoutStrength >= 0.3) {
        const volumeScore = Math.min(volume / 3000000, 1) * 35;
        const breakoutScore = Math.min(breakoutStrength, 1) * 35;
        const rangeScore = Math.min(rangePercent / 8, 1) * 30;
        const confidence = Math.round(volumeScore + breakoutScore + rangeScore);
        
        opportunities.push({
          id: `breakout-${ticker.currency_pair}-${Date.now()}`,
          type: 'breakout',
          symbol: ticker.currency_pair.replace('_', '/'),
          expectedEdge: netEdge,
          confidence,
          expiresIn: 45,
          riskLevel: rangePercent > 6 ? 'high' : rangePercent > 4 ? 'medium' : 'low',
          details: `Breaking 24h high | Range: ${rangePercent.toFixed(2)}% | Momentum: +${change.toFixed(2)}%`,
          action: 'buy',
          entryPrice: last,
          targetPrice: high24h * (1 + expectedContinuation / 100),
          stopLoss: high24h * 0.99, // Just below breakout level
        });
      }
    }
  }

  return opportunities.sort((a, b) => b.expectedEdge - a.expectedEdge).slice(0, 5);
}

// ============ MAIN HANDLER ============

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { credentials, minSpread = 0.15, minVolume = 50000 } = await req.json() as ScanRequest;

    console.log('[Opportunity Scanner] Starting comprehensive scan...');
    
    const tickers = await fetchTickers(credentials);
    console.log(`[Opportunity Scanner] Fetched ${tickers.length} tickers`);

    // Run all strategies in parallel
    const [
      spreadOpportunities,
      arbitrageOpportunities,
      momentumOpportunities,
      volumeSpikeOpportunities,
      breakoutOpportunities,
    ] = await Promise.all([
      Promise.resolve(findSpreadOpportunities(tickers, minSpread, minVolume)),
      Promise.resolve(findTriangularArbitrage(tickers, minVolume)),
      Promise.resolve(findMomentumOpportunities(tickers, minVolume * 2)), // Higher volume for momentum
      Promise.resolve(findVolumeSpikeOpportunities(tickers, minVolume * 3)), // Even higher for volume spikes
      Promise.resolve(findBreakoutOpportunities(tickers, minVolume * 2)),
    ]);

    // Combine and rank all opportunities
    const allOpportunities = [
      ...arbitrageOpportunities,     // Highest priority - guaranteed profit
      ...spreadOpportunities,         // Market making
      ...breakoutOpportunities,       // Breakouts
      ...momentumOpportunities,       // Momentum plays
      ...volumeSpikeOpportunities,    // Volume anomalies
    ]
      .sort((a, b) => {
        // Rank by: (expectedEdge * confidence) / riskMultiplier
        const riskMultiplier = { low: 1, medium: 1.5, high: 2.5 };
        const scoreA = (a.expectedEdge * a.confidence) / riskMultiplier[a.riskLevel];
        const scoreB = (b.expectedEdge * b.confidence) / riskMultiplier[b.riskLevel];
        return scoreB - scoreA;
      })
      .slice(0, 20);

    console.log(`[Opportunity Scanner] Found ${allOpportunities.length} opportunities:`);
    console.log(`  - Arbitrage: ${arbitrageOpportunities.length}`);
    console.log(`  - Spread: ${spreadOpportunities.length}`);
    console.log(`  - Momentum: ${momentumOpportunities.length}`);
    console.log(`  - Volume Spike: ${volumeSpikeOpportunities.length}`);
    console.log(`  - Breakout: ${breakoutOpportunities.length}`);

    return new Response(JSON.stringify({
      success: true,
      opportunities: allOpportunities,
      scannedPairs: tickers.length,
      timestamp: Date.now(),
      strategies: {
        arbitrage: arbitrageOpportunities.length,
        spread: spreadOpportunities.length,
        momentum: momentumOpportunities.length,
        volumeSpike: volumeSpikeOpportunities.length,
        breakout: breakoutOpportunities.length,
      },
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[Opportunity Scanner] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return new Response(JSON.stringify({ 
      success: false, 
      error: errorMessage,
      opportunities: [],
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
