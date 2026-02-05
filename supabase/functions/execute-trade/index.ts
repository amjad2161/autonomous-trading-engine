import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createHmac } from "https://deno.land/std@0.177.0/node/crypto.ts";
import { encodeHex } from "https://deno.land/std@0.224.0/encoding/hex.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ExecuteRequest {
  opportunityType: 'spread' | 'arbitrage' | 'momentum' | 'breakout' | 'reversion' | 'volume_spike';
  symbol: string;
  side: 'buy' | 'sell';
  amount: string;
  price?: string;
  route?: string[];
  maxTradeSize: number;
  minEdge: number;
  expectedEdge: number;
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  slippageTolerance?: number;
}

interface GateCredentials {
  apiKey: string;
  apiSecret: string;
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

// SECURITY: Input validation helpers
const VALID_OPPORTUNITY_TYPES = ['spread', 'arbitrage', 'momentum', 'breakout', 'reversion', 'volume_spike'];
const VALID_SIDES = ['buy', 'sell'];
const SYMBOL_REGEX = /^[A-Z0-9]+\/[A-Z0-9]+$/;
const AMOUNT_REGEX = /^\d+(\.\d+)?$/;

function validateRequest(request: any): { valid: boolean; error?: string } {
  if (!request.symbol || typeof request.symbol !== 'string' || !SYMBOL_REGEX.test(request.symbol)) {
    return { valid: false, error: 'Invalid symbol format' };
  }
  if (!request.side || !VALID_SIDES.includes(request.side)) {
    return { valid: false, error: 'Invalid side - must be buy or sell' };
  }
  if (!request.amount || !AMOUNT_REGEX.test(request.amount)) {
    return { valid: false, error: 'Invalid amount format' };
  }
  if (!request.opportunityType || !VALID_OPPORTUNITY_TYPES.includes(request.opportunityType)) {
    return { valid: false, error: 'Invalid opportunity type' };
  }
  if (typeof request.maxTradeSize !== 'number' || request.maxTradeSize <= 0 || request.maxTradeSize > 10000) {
    return { valid: false, error: 'Invalid maxTradeSize - must be 0-10000' };
  }
  if (typeof request.expectedEdge !== 'number' || request.expectedEdge < 0 || request.expectedEdge > 100) {
    return { valid: false, error: 'Invalid expectedEdge - must be 0-100' };
  }
  if (typeof request.entryPrice !== 'number' || request.entryPrice <= 0) {
    return { valid: false, error: 'Invalid entryPrice' };
  }
  if (typeof request.targetPrice !== 'number' || request.targetPrice <= 0) {
    return { valid: false, error: 'Invalid targetPrice' };
  }
  if (typeof request.stopLoss !== 'number' || request.stopLoss <= 0) {
    return { valid: false, error: 'Invalid stopLoss' };
  }
  return { valid: true };
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
  
  const orderBook = await getOrderBook(pair);
  const ticker = await getTicker(pair);
  
  if (!orderBook || !ticker) {
    return { success: false, error: 'Failed to fetch market data', timestamp: Date.now() };
  }

  let optimalPrice: number;
  
  if (side === 'buy') {
    const bestAsk = parseFloat(orderBook.asks[0][0]);
    const priceWithSlippage = expectedPrice * (1 + slippageTolerance / 100);
    optimalPrice = Math.min(bestAsk, priceWithSlippage);
    const actualSlippage = ((optimalPrice - expectedPrice) / expectedPrice) * 100;
    if (actualSlippage > slippageTolerance) {
      return { success: false, error: `Slippage too high: ${actualSlippage.toFixed(3)}%`, timestamp: Date.now(), slippage: actualSlippage };
    }
  } else {
    const bestBid = parseFloat(orderBook.bids[0][0]);
    const priceWithSlippage = expectedPrice * (1 - slippageTolerance / 100);
    optimalPrice = Math.max(bestBid, priceWithSlippage);
    const actualSlippage = ((expectedPrice - optimalPrice) / expectedPrice) * 100;
    if (actualSlippage > slippageTolerance) {
      return { success: false, error: `Slippage too high: ${actualSlippage.toFixed(3)}%`, timestamp: Date.now(), slippage: actualSlippage };
    }
  }

  const tradeAmount = parseFloat(amount);
  let availableLiquidity = 0;
  const levels = side === 'buy' ? orderBook.asks : orderBook.bids;
  
  for (const level of levels) {
    const levelPrice = parseFloat(level[0]);
    const levelAmount = parseFloat(level[1]);
    const levelValue = levelPrice * levelAmount;
    if (side === 'buy' && levelPrice <= optimalPrice) availableLiquidity += levelValue;
    else if (side === 'sell' && levelPrice >= optimalPrice) availableLiquidity += levelValue;
    if (availableLiquidity >= tradeAmount * 1.5) break;
  }

  if (availableLiquidity < tradeAmount) {
    return { success: false, error: `Insufficient liquidity`, timestamp: Date.now() };
  }

  const priceStr = optimalPrice.toFixed(8);
  const body = { currency_pair: pair, side, amount, price: priceStr, type: 'limit', time_in_force: 'ioc' };
  const payloadString = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = await generateSignature('POST', endpoint, '', payloadString, timestamp, credentials.apiSecret);

  const headers = { 'KEY': credentials.apiKey, 'SIGN': signature, 'Timestamp': timestamp, 'Content-Type': 'application/json', 'Accept': 'application/json' };
  console.log(`[Trade Executor] Placing smart ${side} order: ${amount} ${pair} @ ${priceStr}`);

  const response = await fetch(`${baseUrl}${endpoint}`, { method: 'POST', headers, body: payloadString });
  const data = await response.json();
  const executionTime = Date.now() - startTime;

  if (!response.ok) {
    console.error(`[Trade Executor] Order failed:`, data);
    return { success: false, error: data.message || 'Order placement failed', timestamp: Date.now(), executionTime };
  }

  const executedPrice = parseFloat(data.price || priceStr);
  const slippage = side === 'buy' ? ((executedPrice - expectedPrice) / expectedPrice) * 100 : ((expectedPrice - executedPrice) / expectedPrice) * 100;
  console.log(`[Trade Executor] Order executed in ${executionTime}ms, slippage: ${slippage.toFixed(4)}%`);
  
  return { success: true, orderId: data.id, executedAmount: data.amount || data.filled_total, executedPrice: data.price || priceStr, slippage, timestamp: Date.now(), executionTime };
}

async function executeArbitrage(credentials: GateCredentials, route: string[], startAmount: number, slippageTolerance: number): Promise<TradeResult> {
  console.log(`[Trade Executor] Executing arbitrage: ${route.join(' → ')}`);
  return { success: false, error: 'Arbitrage auto-execution disabled for safety', timestamp: Date.now() };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // SECURITY: Require authorization
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ success: false, error: 'Authorization required', timestamp: Date.now() }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const request = await req.json();
    
    // SECURITY: Validate all inputs
    const validation = validateRequest(request);
    if (!validation.valid) {
      return new Response(JSON.stringify({ success: false, error: validation.error, timestamp: Date.now() }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { opportunityType, symbol, side, amount, maxTradeSize, minEdge, expectedEdge, entryPrice, targetPrice, stopLoss, route, slippageTolerance = 0.5 } = request as ExecuteRequest;

    // SECURITY: Only use server-side credentials
    const apiKey = Deno.env.get('GATE_API_KEY');
    const apiSecret = Deno.env.get('GATE_API_SECRET');
    
    if (!apiKey || !apiSecret) {
      throw new Error('Missing API credentials - please configure GATE_API_KEY and GATE_API_SECRET');
    }
    
    const resolvedCredentials: GateCredentials = { apiKey, apiSecret };

    if (expectedEdge < minEdge) throw new Error(`Edge ${expectedEdge.toFixed(3)}% below minimum threshold ${minEdge}%`);

    const tradeAmount = parseFloat(amount);
    if (tradeAmount > maxTradeSize) throw new Error(`Trade size exceeds max allowed`);
    if (expectedEdge > 5) throw new Error(`Edge suspiciously high - possible stale data`);

    const riskPercent = ((entryPrice - stopLoss) / entryPrice) * 100;
    const rewardPercent = ((targetPrice - entryPrice) / entryPrice) * 100;
    const riskRewardRatio = rewardPercent / riskPercent;
    
    if (riskRewardRatio < 1.5 && opportunityType !== 'spread' && opportunityType !== 'arbitrage') {
      throw new Error(`Risk/Reward ratio ${riskRewardRatio.toFixed(2)} below minimum 1.5`);
    }

    console.log(`[Trade Executor] Executing ${opportunityType} opportunity: ${symbol}`);

    if (opportunityType === 'arbitrage' && route && route.length >= 4) {
      const result = await executeArbitrage(resolvedCredentials, route, tradeAmount, slippageTolerance);
      return new Response(JSON.stringify({ type: 'arbitrage', ...result }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const pair = symbol.replace('/', '_');
    const ticker = await getTicker(pair);
    if (!ticker) throw new Error(`Could not fetch ticker for ${pair}`);

    const priceDrift = Math.abs((ticker.last - entryPrice) / entryPrice) * 100;
    if (priceDrift > slippageTolerance * 2) throw new Error(`Price drifted too much - opportunity stale`);

    const result = await placeSmartOrder(resolvedCredentials, pair, side, amount, entryPrice, slippageTolerance);

    return new Response(JSON.stringify({ type: opportunityType, symbol, ...result, riskRewardRatio, targetPrice, stopLoss }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[Trade Executor] Error:', error);
    // SECURITY: Return generic error with correct 500 status code
    return new Response(JSON.stringify({ success: false, error: 'Trade execution failed', timestamp: Date.now() }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});