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

interface ExecuteRequest {
  credentials: GateCredentials;
  opportunityType: 'spread' | 'arbitrage' | 'momentum' | 'breakout' | 'reversion' | 'volume_spike';
  symbol: string;
  side: 'buy' | 'sell';
  amount: string;
  price?: string;
  route?: string[];
  
  // Risk parameters
  maxTradeSize: number;
  minEdge: number;
  expectedEdge: number;
  
  // Smart execution parameters
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  slippageTolerance?: number; // Default 0.5%
}

interface TradeResult {
  success: boolean;
  orderId?: string;
  executedAmount?: string;
  executedPrice?: string;
  slippage?: number;
  error?: string;
  timestamp: number;
  executionTime?: number;
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

async function getTicker(pair: string): Promise<{ bid: number; ask: number; last: number; volume: number } | null> {
  const response = await fetch(`https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${pair}`);
  const data = await response.json();
  
  if (!data || data.length === 0) return null;
  
  return {
    bid: parseFloat(data[0].highest_bid),
    ask: parseFloat(data[0].lowest_ask),
    last: parseFloat(data[0].last),
    volume: parseFloat(data[0].quote_volume),
  };
}

async function getOrderBook(pair: string, limit = 5): Promise<{ asks: [string, string][]; bids: [string, string][] } | null> {
  const response = await fetch(`https://api.gateio.ws/api/v4/spot/order_book?currency_pair=${pair}&limit=${limit}`);
  const data = await response.json();
  
  if (!data || !data.asks || !data.bids) return null;
  
  return data;
}

// ============ SMART ORDER PLACEMENT ============

async function placeSmartOrder(
  credentials: GateCredentials,
  pair: string,
  side: 'buy' | 'sell',
  amount: string,
  expectedPrice: number,
  slippageTolerance: number
): Promise<TradeResult> {
  const startTime = Date.now();
  const baseUrl = 'https://api.gateio.ws';
  const endpoint = '/api/v4/spot/orders';
  
  // Get current order book to optimize execution
  const orderBook = await getOrderBook(pair);
  const ticker = await getTicker(pair);
  
  if (!orderBook || !ticker) {
    return {
      success: false,
      error: 'Failed to fetch market data',
      timestamp: Date.now(),
    };
  }

  // Calculate optimal price based on order book
  let optimalPrice: number;
  
  if (side === 'buy') {
    // For buy: price should be at or slightly above best ask for immediate fill
    const bestAsk = parseFloat(orderBook.asks[0][0]);
    const priceWithSlippage = expectedPrice * (1 + slippageTolerance / 100);
    
    // Use the lower of: best ask, expected price + slippage
    optimalPrice = Math.min(bestAsk, priceWithSlippage);
    
    // Verify slippage is acceptable
    const actualSlippage = ((optimalPrice - expectedPrice) / expectedPrice) * 100;
    if (actualSlippage > slippageTolerance) {
      return {
        success: false,
        error: `Slippage too high: ${actualSlippage.toFixed(3)}% > ${slippageTolerance}%`,
        timestamp: Date.now(),
        slippage: actualSlippage,
      };
    }
  } else {
    // For sell: price should be at or slightly below best bid
    const bestBid = parseFloat(orderBook.bids[0][0]);
    const priceWithSlippage = expectedPrice * (1 - slippageTolerance / 100);
    
    optimalPrice = Math.max(bestBid, priceWithSlippage);
    
    const actualSlippage = ((expectedPrice - optimalPrice) / expectedPrice) * 100;
    if (actualSlippage > slippageTolerance) {
      return {
        success: false,
        error: `Slippage too high: ${actualSlippage.toFixed(3)}% > ${slippageTolerance}%`,
        timestamp: Date.now(),
        slippage: actualSlippage,
      };
    }
  }

  // Check liquidity - ensure enough volume at price level
  const tradeAmount = parseFloat(amount);
  let availableLiquidity = 0;
  const levels = side === 'buy' ? orderBook.asks : orderBook.bids;
  
  for (const level of levels) {
    const levelPrice = parseFloat(level[0]);
    const levelAmount = parseFloat(level[1]);
    const levelValue = levelPrice * levelAmount;
    
    if (side === 'buy' && levelPrice <= optimalPrice) {
      availableLiquidity += levelValue;
    } else if (side === 'sell' && levelPrice >= optimalPrice) {
      availableLiquidity += levelValue;
    }
    
    if (availableLiquidity >= tradeAmount * 1.5) break; // 50% buffer
  }

  if (availableLiquidity < tradeAmount) {
    return {
      success: false,
      error: `Insufficient liquidity: $${availableLiquidity.toFixed(2)} available vs $${tradeAmount.toFixed(2)} needed`,
      timestamp: Date.now(),
    };
  }

  // Place IOC order for immediate execution
  const priceStr = optimalPrice.toFixed(8);
  
  const body = {
    currency_pair: pair,
    side,
    amount,
    price: priceStr,
    type: 'limit',
    time_in_force: 'ioc', // Immediate-or-Cancel
  };
  
  const payloadString = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = await generateSignature('POST', endpoint, '', payloadString, timestamp, credentials.apiSecret);

  const headers = {
    'KEY': credentials.apiKey,
    'SIGN': signature,
    'Timestamp': timestamp,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  console.log(`[Trade Executor] Placing smart ${side} order: ${amount} ${pair} @ ${priceStr}`);

  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers,
    body: payloadString,
  });

  const data = await response.json();
  const executionTime = Date.now() - startTime;

  if (!response.ok) {
    console.error(`[Trade Executor] Order failed:`, data);
    return {
      success: false,
      error: data.message || data.label || 'Order placement failed',
      timestamp: Date.now(),
      executionTime,
    };
  }

  // Calculate actual slippage
  const executedPrice = parseFloat(data.price || priceStr);
  const slippage = side === 'buy' 
    ? ((executedPrice - expectedPrice) / expectedPrice) * 100
    : ((expectedPrice - executedPrice) / expectedPrice) * 100;

  console.log(`[Trade Executor] Order executed in ${executionTime}ms, slippage: ${slippage.toFixed(4)}%`);
  
  return {
    success: true,
    orderId: data.id,
    executedAmount: data.amount || data.filled_total,
    executedPrice: data.price || priceStr,
    slippage,
    timestamp: Date.now(),
    executionTime,
  };
}

// ============ ARBITRAGE EXECUTION ============

async function executeArbitrage(
  credentials: GateCredentials,
  route: string[],
  startAmount: number,
  slippageTolerance: number
): Promise<TradeResult> {
  console.log(`[Trade Executor] Executing arbitrage: ${route.join(' → ')}`);
  
  // Verify route is still profitable
  const pairs: { pair: string; side: 'buy' | 'sell' }[] = [];
  
  // Build trade pairs from route
  for (let i = 0; i < route.length - 1; i++) {
    const from = route[i];
    const to = route[i + 1];
    
    // Try both pair directions
    const pairNormal = `${to}_${from}`;
    const pairReverse = `${from}_${to}`;
    
    const tickerNormal = await getTicker(pairNormal);
    const tickerReverse = await getTicker(pairReverse);
    
    if (tickerNormal) {
      pairs.push({ pair: pairNormal, side: 'buy' });
    } else if (tickerReverse) {
      pairs.push({ pair: pairReverse, side: 'sell' });
    } else {
      return {
        success: false,
        error: `No pair found for ${from} → ${to}`,
        timestamp: Date.now(),
      };
    }
  }

  // Calculate expected final amount
  let expectedAmount = startAmount;
  const fees = 0.002; // 0.2% per trade
  
  for (const { pair, side } of pairs) {
    const ticker = await getTicker(pair);
    if (!ticker) {
      return {
        success: false,
        error: `Failed to get ticker for ${pair}`,
        timestamp: Date.now(),
      };
    }
    
    if (side === 'buy') {
      expectedAmount = (expectedAmount / ticker.ask) * (1 - fees);
    } else {
      expectedAmount = expectedAmount * ticker.bid * (1 - fees);
    }
  }

  const expectedProfit = ((expectedAmount - startAmount) / startAmount) * 100;
  
  if (expectedProfit <= 0) {
    return {
      success: false,
      error: `Arbitrage no longer profitable: ${expectedProfit.toFixed(4)}%`,
      timestamp: Date.now(),
    };
  }

  console.log(`[Trade Executor] Arbitrage expected profit: ${expectedProfit.toFixed(4)}%`);
  
  // For safety, don't execute actual arbitrage automatically
  // This requires atomic execution or careful leg management
  return {
    success: false,
    error: 'Arbitrage auto-execution disabled for safety - manual execution recommended',
    timestamp: Date.now(),
  };
}

// ============ MAIN HANDLER ============

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const request: ExecuteRequest = await req.json();
    const { 
      credentials, 
      opportunityType, 
      symbol, 
      side, 
      amount,
      maxTradeSize,
      minEdge,
      expectedEdge,
      entryPrice,
      targetPrice,
      stopLoss,
      route,
      slippageTolerance = 0.5,
    } = request;

    // ============ HARD GUARDRAILS ============
    
    // 1. Get credentials - prefer from request, fall back to env vars (server mode)
    const apiKey = credentials?.apiKey || Deno.env.get('GATE_API_KEY');
    const apiSecret = credentials?.apiSecret || Deno.env.get('GATE_API_SECRET');
    
    if (!apiKey || !apiSecret) {
      throw new Error('Missing API credentials - please configure GATE_API_KEY and GATE_API_SECRET');
    }
    
    // Use resolved credentials
    const resolvedCredentials: GateCredentials = { apiKey, apiSecret };

    // 2. Check minimum edge threshold
    if (expectedEdge < minEdge) {
      throw new Error(`Edge ${expectedEdge.toFixed(3)}% below minimum threshold ${minEdge}%`);
    }

    // 3. Validate trade size
    const tradeAmount = parseFloat(amount);
    if (tradeAmount > maxTradeSize) {
      throw new Error(`Trade size $${tradeAmount.toFixed(2)} exceeds max allowed $${maxTradeSize}`);
    }

    // 4. Sanity check - prevent obviously bad trades
    if (expectedEdge > 5) {
      throw new Error(`Edge ${expectedEdge.toFixed(3)}% suspiciously high - possible stale data`);
    }

    // 5. Validate risk/reward
    const riskPercent = ((entryPrice - stopLoss) / entryPrice) * 100;
    const rewardPercent = ((targetPrice - entryPrice) / entryPrice) * 100;
    const riskRewardRatio = rewardPercent / riskPercent;
    
    if (riskRewardRatio < 1.5 && opportunityType !== 'spread' && opportunityType !== 'arbitrage') {
      throw new Error(`Risk/Reward ratio ${riskRewardRatio.toFixed(2)} below minimum 1.5`);
    }

    console.log(`[Trade Executor] Executing ${opportunityType} opportunity: ${symbol}`);
    console.log(`[Trade Executor] Entry: $${entryPrice} | Target: $${targetPrice} | Stop: $${stopLoss}`);
    console.log(`[Trade Executor] R/R Ratio: ${riskRewardRatio.toFixed(2)}`);

    // ============ EXECUTE BASED ON TYPE ============

    if (opportunityType === 'arbitrage' && route && route.length >= 4) {
      const result = await executeArbitrage(resolvedCredentials, route, tradeAmount, slippageTolerance);
      return new Response(JSON.stringify({
        type: 'arbitrage',
        ...result,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // All other types use smart order placement
    const pair = symbol.replace('/', '_');
    
    // Verify opportunity still valid
    const ticker = await getTicker(pair);
    if (!ticker) {
      throw new Error(`Could not fetch ticker for ${pair}`);
    }

    // Check if price moved too much
    const priceDrift = Math.abs((ticker.last - entryPrice) / entryPrice) * 100;
    if (priceDrift > slippageTolerance * 2) {
      throw new Error(`Price drifted ${priceDrift.toFixed(3)}% from expected entry - opportunity stale`);
    }

    // Execute with smart order placement
    const result = await placeSmartOrder(
      resolvedCredentials,
      pair,
      side,
      amount,
      entryPrice,
      slippageTolerance
    );

    return new Response(JSON.stringify({
      type: opportunityType,
      symbol,
      ...result,
      riskRewardRatio,
      targetPrice,
      stopLoss,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[Trade Executor] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return new Response(JSON.stringify({ 
      success: false, 
      error: errorMessage,
      timestamp: Date.now(),
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
