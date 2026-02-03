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
}

interface Opportunity {
  id: string;
  type: 'arbitrage' | 'spread' | 'breakout' | 'reversion';
  symbol: string;
  expectedEdge: number;
  confidence: number;
  expiresIn: number;
  riskLevel: 'low' | 'medium' | 'high';
  details: string;
  route?: string[];
}

interface ScanRequest {
  credentials?: GateCredentials;
  minSpread?: number; // Minimum spread percentage to consider
  minVolume?: number; // Minimum 24h volume in USDT
}

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

  // Add auth headers if credentials provided
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

function findSpreadOpportunities(tickers: Ticker[], minSpread: number, minVolume: number): Opportunity[] {
  const opportunities: Opportunity[] = [];
  
  // Filter to USDT pairs with sufficient volume
  const usdtPairs = tickers.filter(t => 
    t.currency_pair.endsWith('_USDT') && 
    parseFloat(t.quote_volume) >= minVolume
  );

  for (const ticker of usdtPairs) {
    const bid = parseFloat(ticker.highest_bid);
    const ask = parseFloat(ticker.lowest_ask);
    const last = parseFloat(ticker.last);
    
    if (bid <= 0 || ask <= 0 || last <= 0) continue;
    
    // Calculate spread percentage
    const spreadPercent = ((ask - bid) / last) * 100;
    
    // Only consider pairs with spread above minimum threshold
    if (spreadPercent >= minSpread) {
      // Estimate net edge after fees (0.2% maker + taker)
      const fees = 0.2;
      const netEdge = spreadPercent - fees;
      
      if (netEdge > 0) {
        // Calculate confidence based on volume and spread stability
        const volume = parseFloat(ticker.quote_volume);
        const volumeScore = Math.min(volume / 1000000, 1) * 50; // Max 50 points for $1M+ volume
        const spreadScore = Math.min(spreadPercent / 1, 1) * 50; // Max 50 points for 1%+ spread
        const confidence = Math.round(volumeScore + spreadScore);
        
        // Risk level based on spread size (higher spread = higher risk of slippage)
        const riskLevel = spreadPercent > 0.5 ? 'high' : spreadPercent > 0.3 ? 'medium' : 'low';
        
        opportunities.push({
          id: `spread-${ticker.currency_pair}-${Date.now()}`,
          type: 'spread',
          symbol: ticker.currency_pair.replace('_', '/'),
          expectedEdge: netEdge,
          confidence,
          expiresIn: 30, // Spread opportunities are short-lived
          riskLevel,
          details: `Bid: $${bid.toFixed(6)} | Ask: $${ask.toFixed(6)} | Spread: ${spreadPercent.toFixed(3)}%`,
        });
      }
    }
  }

  // Sort by expected edge descending
  return opportunities.sort((a, b) => b.expectedEdge - a.expectedEdge).slice(0, 10);
}

function findTriangularArbitrage(tickers: Ticker[], minVolume: number): Opportunity[] {
  const opportunities: Opportunity[] = [];
  
  // Build price maps
  const priceMap: Record<string, { bid: number; ask: number; volume: number }> = {};
  
  for (const ticker of tickers) {
    const bid = parseFloat(ticker.highest_bid);
    const ask = parseFloat(ticker.lowest_ask);
    const volume = parseFloat(ticker.quote_volume);
    
    if (bid > 0 && ask > 0) {
      priceMap[ticker.currency_pair] = { bid, ask, volume };
    }
  }

  // Common base currencies for triangular arbitrage
  const baseCurrencies = ['BTC', 'ETH', 'USDT'];
  const altCoins = ['SOL', 'XRP', 'DOGE', 'ADA', 'MATIC', 'LINK', 'AVAX', 'DOT', 'UNI', 'ATOM'];

  // Look for triangular opportunities: USDT -> Coin -> BTC/ETH -> USDT
  for (const coin of altCoins) {
    // Path: USDT -> Coin -> BTC -> USDT
    const coinUsdt = priceMap[`${coin}_USDT`];
    const coinBtc = priceMap[`${coin}_BTC`];
    const btcUsdt = priceMap['BTC_USDT'];

    if (coinUsdt && coinBtc && btcUsdt && coinUsdt.volume >= minVolume) {
      // Forward: Buy Coin with USDT, Sell Coin for BTC, Sell BTC for USDT
      const step1 = 1 / coinUsdt.ask; // USDT -> Coin
      const step2 = step1 * coinBtc.bid; // Coin -> BTC
      const step3 = step2 * btcUsdt.bid; // BTC -> USDT
      
      const forwardProfit = ((step3 - 1) * 100) - 0.6; // Subtract 3x 0.2% fees
      
      if (forwardProfit > 0.05) { // Minimum 0.05% profit
        const confidence = Math.min(Math.round(forwardProfit * 100), 95);
        opportunities.push({
          id: `arb-${coin}-BTC-${Date.now()}`,
          type: 'arbitrage',
          symbol: `${coin}`,
          expectedEdge: forwardProfit,
          confidence,
          expiresIn: 10, // Arbitrage opportunities are very short-lived
          riskLevel: forwardProfit > 0.3 ? 'high' : forwardProfit > 0.15 ? 'medium' : 'low',
          details: `Route: USDT → ${coin} → BTC → USDT`,
          route: ['USDT', coin, 'BTC', 'USDT'],
        });
      }

      // Reverse: Buy BTC with USDT, Buy Coin with BTC, Sell Coin for USDT
      const revStep1 = 1 / btcUsdt.ask; // USDT -> BTC
      const revStep2 = revStep1 / coinBtc.ask; // BTC -> Coin
      const revStep3 = revStep2 * coinUsdt.bid; // Coin -> USDT
      
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
        });
      }
    }
  }

  return opportunities.sort((a, b) => b.expectedEdge - a.expectedEdge).slice(0, 5);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { credentials, minSpread = 0.15, minVolume = 50000 } = await req.json() as ScanRequest;

    console.log('[Opportunity Scanner] Starting scan...');
    
    // Fetch all tickers
    const tickers = await fetchTickers(credentials);
    console.log(`[Opportunity Scanner] Fetched ${tickers.length} tickers`);

    // Find opportunities
    const spreadOpportunities = findSpreadOpportunities(tickers, minSpread, minVolume);
    const arbitrageOpportunities = findTriangularArbitrage(tickers, minVolume);

    const allOpportunities = [...arbitrageOpportunities, ...spreadOpportunities]
      .sort((a, b) => b.expectedEdge - a.expectedEdge)
      .slice(0, 15);

    console.log(`[Opportunity Scanner] Found ${allOpportunities.length} opportunities`);

    return new Response(JSON.stringify({
      success: true,
      opportunities: allOpportunities,
      scannedPairs: tickers.length,
      timestamp: Date.now(),
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
