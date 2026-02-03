import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac } from "https://deno.land/std@0.177.0/node/crypto.ts";
import { encodeHex } from "https://deno.land/std@0.224.0/encoding/hex.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Initialize Supabase client
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseKey);

// ===================== CONFIGURATION =====================
const CONFIG = {
  // Layer 1: Scanner
  SCAN_INTERVAL_MS: 5000,
  MIN_VOLUME: 500000,        // Higher volume requirement
  MAX_SPREAD: 0.30,          // Max 0.30% spread
  
  // Layer 3: Capital Deployment
  BASE_RISK_PER_TRADE: 0.012,    // 1.2% base risk
  AGGRESSIVE_RISK: 0.016,         // 1.6% aggressive mode
  MAX_PER_ASSET: 0.12,            // 12% max per asset
  MAX_SIMULTANEOUS_POSITIONS: 4,
  MAX_TOTAL_EXPOSURE: 0.50,       // 50% max exposure
  
  // Layer 4: Risk Control
  STOP_LOSS_MIN: 0.020,      // 2.0% minimum stop
  STOP_LOSS_MAX: 0.028,      // 2.8% maximum stop
  TRAILING_ACTIVATION: 0.035, // Activate trailing at +3.5%
  TRAILING_DISTANCE_MIN: 0.020,
  TRAILING_DISTANCE_MAX: 0.032,
  
  // Layer 5: Profit Extraction
  TP1_PERCENT: 0.05,         // First TP at +5%
  TP1_SIZE: 0.35,            // Sell 35%
  TP2_PERCENT: 0.09,         // Second TP at +9%
  TP2_SIZE: 0.25,            // Sell 25%
  
  // Layer 7: Loss Containment
  DAILY_DRAWDOWN_CAUTION: 0.03,  // -3% → Defense Mode
  DAILY_DRAWDOWN_HALT: 0.05,     // -5% → HARD STOP
  MIN_WIN_RATE: 0.35,            // 35% minimum win rate
  CONSECUTIVE_LOSS_THRESHOLD: 2,
};

// ===================== TYPES =====================
interface Position {
  symbol: string;
  currency: string;
  entryPrice: number;
  amount: number;
  value: number;
  currentPrice: number;
  pnlPercent: number;
  stopLoss: number;
  trailingStop?: number;
  trailingActivated: boolean;
  tp1Hit: boolean;
  tp2Hit: boolean;
  entryTime: number;
}

interface MarketData {
  pair: string;
  currency: string;
  last: number;
  bid: number;
  ask: number;
  spread: number;
  volume: number;
  change1h: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volumeAcceleration: number;
  orderBookImbalance: number;
  momentum1m: number;
  momentum5m: number;
  atr: number;
  volatility: number;
  score: number;
}

interface SystemState {
  mode: 'normal' | 'aggressive' | 'defense' | 'halted';
  consecutiveLosses: number;
  dailyPnL: number;
  dailyPnLPercent: number;
  startingBalance: number;
  currentBalance: number;
  totalExposure: number;
  positions: Position[];
  riskMultiplier: number;
  winRate: number;
  totalTrades: number;
  winningTrades: number;
}

// ===================== GATE.IO API HELPERS =====================
async function sha512Hash(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-512', msgBuffer);
  return encodeHex(new Uint8Array(hashBuffer));
}

async function generateSignature(method: string, url: string, queryString: string, payloadString: string, timestamp: string, secret: string): Promise<string> {
  const hashedPayload = await sha512Hash(payloadString);
  const signatureString = `${method}\n${url}\n${queryString}\n${hashedPayload}\n${timestamp}`;
  return createHmac('sha512', secret).update(signatureString).digest('hex');
}

async function gateRequest(endpoint: string, method: 'GET' | 'POST' | 'DELETE' = 'GET', params: Record<string, string> = {}, body?: Record<string, unknown>) {
  const GATE_API_KEY = Deno.env.get('GATE_API_KEY')!;
  const GATE_API_SECRET = Deno.env.get('GATE_API_SECRET')!;
  const baseUrl = 'https://api.gateio.ws';
  const apiPrefix = '/api/v4';
  const url = `${apiPrefix}${endpoint}`;
  const queryString = new URLSearchParams(params).toString();
  const fullUrl = queryString ? `${baseUrl}${url}?${queryString}` : `${baseUrl}${url}`;
  const payloadString = body ? JSON.stringify(body) : '';
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = await generateSignature(method, url, queryString, payloadString, timestamp, GATE_API_SECRET);

  const response = await fetch(fullUrl, {
    method,
    headers: { 'KEY': GATE_API_KEY, 'SIGN': signature, 'Timestamp': timestamp, 'Content-Type': 'application/json' },
    body: payloadString || undefined,
  });
  return response.json();
}

// ===================== LOGGING & STATE =====================
async function log(level: string, component: string, message: string, details?: unknown) {
  const logLine = `[${component}] ${message}`;
  console.log(logLine);
  await supabase.from('system_log').insert({ level, component, message, details });
}

async function getDBState() {
  const { data } = await supabase.from('trading_system_state').select('*').limit(1).single();
  return data;
}

async function updateDBState(updates: Record<string, unknown>) {
  const { data } = await supabase.from('trading_system_state').select('*').limit(1).single();
  if (data) {
    await supabase.from('trading_system_state').update({
      ...updates,
      last_heartbeat: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', data.id);
  }
}

async function recordTrade(trade: {
  orderId: string;
  symbol: string;
  side: string;
  type: string;
  amount: number;
  price: number;
  expectedEdge: number;
  actualPnL?: number;
  status: string;
  error?: string;
}) {
  await supabase.from('trade_history').insert({
    order_id: trade.orderId,
    symbol: trade.symbol,
    side: trade.side,
    type: trade.type,
    amount: trade.amount,
    price: trade.price,
    expected_edge: trade.expectedEdge,
    actual_pnl: trade.actualPnL || 0,
    status: trade.status,
    error: trade.error,
    executed_at: new Date().toISOString(),
  });
}

// ===================== LAYER 1: MARKET SCANNER =====================
async function scanMarkets(): Promise<MarketData[]> {
  const tickers = await gateRequest('/spot/tickers');
  const markets: MarketData[] = [];
  
  for (const ticker of tickers) {
    if (!ticker.currency_pair.endsWith('_USDT')) continue;
    
    const volume = parseFloat(ticker.quote_volume);
    if (volume < CONFIG.MIN_VOLUME) continue;
    
    const last = parseFloat(ticker.last);
    const bid = parseFloat(ticker.highest_bid);
    const ask = parseFloat(ticker.lowest_ask);
    const spread = ((ask - bid) / last) * 100;
    
    // Reject: thin liquidity, high spread
    if (spread > CONFIG.MAX_SPREAD) continue;
    
    const high24h = parseFloat(ticker.high_24h);
    const low24h = parseFloat(ticker.low_24h);
    const change24h = parseFloat(ticker.change_percentage);
    
    // Calculate ATR proxy (24h range)
    const atr = ((high24h - low24h) / last) * 100;
    const volatility = atr / 24; // Hourly volatility proxy
    
    // Volume acceleration (rough estimate - current vs average)
    const avgDailyVolume = volume; // Would need historical data for real comparison
    const volumeAcceleration = 1.0; // Placeholder - needs OHLCV data
    
    // Momentum alignment (simplified)
    const momentum1m = change24h > 0 ? 1 : -1;
    const momentum5m = change24h > 0 ? 1 : -1;
    
    // Order book imbalance (placeholder - needs order book data)
    const orderBookImbalance = 0;
    
    // Composite score for ranking
    const score = (
      (volumeAcceleration * 20) +
      (volatility * 10) +
      (1 - spread) * 30 +
      (orderBookImbalance * 20) +
      ((momentum1m === momentum5m ? 1 : 0) * 20)
    );
    
    markets.push({
      pair: ticker.currency_pair,
      currency: ticker.currency_pair.split('_')[0],
      last,
      bid,
      ask,
      spread,
      volume,
      change1h: change24h / 24, // Estimate
      change24h,
      high24h,
      low24h,
      volumeAcceleration,
      orderBookImbalance,
      momentum1m,
      momentum5m,
      atr,
      volatility,
      score,
    });
  }
  
  // Rank by score
  markets.sort((a, b) => b.score - a.score);
  
  return markets;
}

// ===================== LAYER 2: ENTRY ENGINE =====================
interface EntrySignal {
  pair: string;
  currency: string;
  price: number;
  reason: string;
  expectedReturn: number;
  risk: number;
  rewardRisk: number;
  stopLoss: number;
  confidence: number;
}

function analyzeEntrySignals(markets: MarketData[], state: SystemState): EntrySignal[] {
  const signals: EntrySignal[] = [];
  
  for (const market of markets) {
    // Skip if already holding
    if (state.positions.some(p => p.currency === market.currency)) continue;
    
    // Skip if at max positions
    if (state.positions.length >= CONFIG.MAX_SIMULTANEOUS_POSITIONS) break;
    
    // Calculate dynamic stop loss based on volatility
    const stopLossPercent = Math.min(
      Math.max(market.volatility * 2, CONFIG.STOP_LOSS_MIN * 100),
      CONFIG.STOP_LOSS_MAX * 100
    ) / 100;
    
    const stopLoss = market.last * (1 - stopLossPercent);
    
    // Entry conditions
    let reason = '';
    let expectedReturn = 0;
    let confidence = 0;
    
    // Breakout: Near 24h high with momentum
    const distanceFromHigh = (market.high24h - market.last) / market.high24h;
    if (distanceFromHigh < 0.01 && market.change24h > 3 && market.change24h < 15) {
      reason = 'breakout_continuation';
      expectedReturn = 0.05; // 5% target
      confidence = 70 + (market.volume / 1000000);
    }
    
    // Bounce: Near 24h low with reversal signs
    const distanceFromLow = (market.last - market.low24h) / market.low24h;
    if (!reason && distanceFromLow < 0.03 && market.change24h > -8 && market.change24h < 0) {
      reason = 'support_bounce';
      expectedReturn = 0.04;
      confidence = 65 + (market.volume / 1000000);
    }
    
    // Momentum continuation: Strong trend with pullback
    if (!reason && market.change24h > 5 && market.change24h < 20 && market.spread < 0.15) {
      reason = 'momentum_continuation';
      expectedReturn = 0.06;
      confidence = 60 + (market.volume / 500000);
    }
    
    if (!reason) continue;
    
    // Calculate reward/risk
    const risk = stopLossPercent;
    const rewardRisk = expectedReturn / risk;
    
    // Only accept R:R >= 2:1
    if (rewardRisk < 2) continue;
    
    // Don't chase extended candles
    if (market.change24h > 20) continue;
    
    signals.push({
      pair: market.pair,
      currency: market.currency,
      price: market.last,
      reason,
      expectedReturn,
      risk,
      rewardRisk,
      stopLoss,
      confidence: Math.min(confidence, 95),
    });
  }
  
  // Sort by confidence * R:R
  signals.sort((a, b) => (b.confidence * b.rewardRisk) - (a.confidence * a.rewardRisk));
  
  return signals;
}

// ===================== LAYER 3: CAPITAL DEPLOYMENT =====================
function calculatePositionSize(signal: EntrySignal, state: SystemState): number {
  // Base risk
  let riskPercent = CONFIG.BASE_RISK_PER_TRADE;
  
  // Aggressive mode in strong trend regime
  if (state.mode === 'aggressive' && signal.confidence > 80) {
    riskPercent = CONFIG.AGGRESSIVE_RISK;
  }
  
  // Reduce after consecutive losses
  if (state.consecutiveLosses >= CONFIG.CONSECUTIVE_LOSS_THRESHOLD) {
    riskPercent *= 0.7; // Reduce by 30%
  }
  
  // Defense mode reduction
  if (state.mode === 'defense') {
    riskPercent *= 0.6; // Reduce by 40%
  }
  
  // Apply risk multiplier
  riskPercent *= state.riskMultiplier;
  
  // Calculate position size based on risk
  const riskAmount = state.currentBalance * riskPercent;
  const positionSize = riskAmount / signal.risk;
  
  // Apply limits
  const maxPerAsset = state.currentBalance * CONFIG.MAX_PER_ASSET;
  const maxExposure = state.currentBalance * CONFIG.MAX_TOTAL_EXPOSURE - state.totalExposure;
  
  return Math.min(positionSize, maxPerAsset, maxExposure, state.currentBalance * 0.2);
}

// ===================== LAYER 4: RISK CONTROL SYSTEM =====================
function calculateStopLoss(entryPrice: number, volatility: number): number {
  const stopPercent = Math.min(
    Math.max(volatility * 2, CONFIG.STOP_LOSS_MIN * 100),
    CONFIG.STOP_LOSS_MAX * 100
  ) / 100;
  return entryPrice * (1 - stopPercent);
}

function calculateTrailingStop(position: Position, currentPrice: number): number | undefined {
  const pnlPercent = (currentPrice - position.entryPrice) / position.entryPrice;
  
  // Activate trailing at +3.5%
  if (pnlPercent >= CONFIG.TRAILING_ACTIVATION) {
    // Calculate trailing distance based on volatility (simplified)
    const trailingDistance = (CONFIG.TRAILING_DISTANCE_MIN + CONFIG.TRAILING_DISTANCE_MAX) / 2;
    const newTrailingStop = currentPrice * (1 - trailingDistance);
    
    // Trailing can only tighten (move up)
    if (!position.trailingStop || newTrailingStop > position.trailingStop) {
      return newTrailingStop;
    }
    return position.trailingStop;
  }
  
  return position.trailingStop;
}

// ===================== LAYER 5: PROFIT EXTRACTION =====================
interface ExitAction {
  symbol: string;
  currency: string;
  amount: number;
  price: number;
  reason: 'stop_loss' | 'trailing_stop' | 'tp1' | 'tp2' | 'hard_stop';
  pnlPercent: number;
}

function determineExits(positions: Position[], currentPrices: Map<string, number>): ExitAction[] {
  const exits: ExitAction[] = [];
  
  for (const pos of positions) {
    const currentPrice = currentPrices.get(pos.symbol) || pos.currentPrice;
    const pnlPercent = (currentPrice - pos.entryPrice) / pos.entryPrice;
    
    // Hard Stop Loss
    if (currentPrice <= pos.stopLoss) {
      exits.push({
        symbol: pos.symbol,
        currency: pos.currency,
        amount: pos.amount, // Sell all
        price: currentPrice,
        reason: 'stop_loss',
        pnlPercent,
      });
      continue;
    }
    
    // Trailing Stop
    if (pos.trailingActivated && pos.trailingStop && currentPrice <= pos.trailingStop) {
      exits.push({
        symbol: pos.symbol,
        currency: pos.currency,
        amount: pos.amount, // Sell all
        price: currentPrice,
        reason: 'trailing_stop',
        pnlPercent,
      });
      continue;
    }
    
    // TP1: Sell 35% at +5%
    if (!pos.tp1Hit && pnlPercent >= CONFIG.TP1_PERCENT) {
      const tp1Amount = pos.amount * CONFIG.TP1_SIZE;
      exits.push({
        symbol: pos.symbol,
        currency: pos.currency,
        amount: tp1Amount,
        price: currentPrice,
        reason: 'tp1',
        pnlPercent,
      });
    }
    
    // TP2: Sell 25% at +9%
    if (!pos.tp2Hit && pos.tp1Hit && pnlPercent >= CONFIG.TP2_PERCENT) {
      const remainingAmount = pos.amount * (1 - CONFIG.TP1_SIZE);
      const tp2Amount = remainingAmount * (CONFIG.TP2_SIZE / (1 - CONFIG.TP1_SIZE));
      exits.push({
        symbol: pos.symbol,
        currency: pos.currency,
        amount: tp2Amount,
        price: currentPrice,
        reason: 'tp2',
        pnlPercent,
      });
    }
  }
  
  return exits;
}

// ===================== LAYER 7: LOSS CONTAINMENT =====================
function evaluateSystemMode(state: SystemState): SystemState['mode'] {
  // HARD STOP
  if (state.dailyPnLPercent <= -CONFIG.DAILY_DRAWDOWN_HALT) {
    return 'halted';
  }
  
  // Defense Mode
  if (state.dailyPnLPercent <= -CONFIG.DAILY_DRAWDOWN_CAUTION) {
    return 'defense';
  }
  
  // Win rate too low
  if (state.totalTrades >= 10 && state.winRate < CONFIG.MIN_WIN_RATE) {
    return 'defense';
  }
  
  // Consecutive losses
  if (state.consecutiveLosses >= CONFIG.CONSECUTIVE_LOSS_THRESHOLD) {
    return 'defense';
  }
  
  // Aggressive mode for strong performance
  if (state.winRate > 0.55 && state.dailyPnLPercent > 0.01 && state.consecutiveLosses === 0) {
    return 'aggressive';
  }
  
  return 'normal';
}

// ===================== LAYER 8: EXECUTION =====================
async function executeOrder(
  pair: string,
  side: 'buy' | 'sell',
  amount: number,
  price: number,
  useLimit: boolean = true
): Promise<{ success: boolean; orderId?: string; filled?: number; error?: string }> {
  try {
    const order = await gateRequest('/spot/orders', 'POST', {}, {
      currency_pair: pair,
      side,
      amount: amount.toFixed(6),
      price: price.toFixed(8),
      type: 'limit',
      time_in_force: useLimit ? 'gtc' : 'ioc',
    });
    
    if (order.id) {
      return { success: true, orderId: order.id, filled: parseFloat(order.filled_total || order.amount) };
    }
    return { success: false, error: JSON.stringify(order) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

// ===================== LAYER 9: PERFORMANCE FEEDBACK =====================
async function getPerformanceMetrics(): Promise<{
  winRate: number;
  profitFactor: number;
  totalTrades: number;
  winningTrades: number;
  avgWin: number;
  avgLoss: number;
}> {
  const { data: trades } = await supabase
    .from('trade_history')
    .select('*')
    .gte('executed_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('executed_at', { ascending: false });
  
  if (!trades || trades.length === 0) {
    return { winRate: 0.5, profitFactor: 1, totalTrades: 0, winningTrades: 0, avgWin: 0, avgLoss: 0 };
  }
  
  const wins = trades.filter(t => (t.actual_pnl || 0) > 0);
  const losses = trades.filter(t => (t.actual_pnl || 0) < 0);
  
  const totalWins = wins.reduce((sum, t) => sum + (t.actual_pnl || 0), 0);
  const totalLosses = Math.abs(losses.reduce((sum, t) => sum + (t.actual_pnl || 0), 0));
  
  return {
    winRate: trades.length > 0 ? wins.length / trades.length : 0.5,
    profitFactor: totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? 10 : 1,
    totalTrades: trades.length,
    winningTrades: wins.length,
    avgWin: wins.length > 0 ? totalWins / wins.length : 0,
    avgLoss: losses.length > 0 ? totalLosses / losses.length : 0,
  };
}

// ===================== MAIN ORCHESTRATOR =====================
async function runTradingCycle(): Promise<{
  scanned: number;
  signals: number;
  entries: number;
  exits: number;
  pnl: number;
  balance: number;
  mode: string;
}> {
  const cycleStart = Date.now();
  
  // Get balances and current state
  const balances = await gateRequest('/spot/accounts');
  const usdtBalance = balances.find((b: { currency: string }) => b.currency === 'USDT');
  const currentUSDT = usdtBalance ? parseFloat(usdtBalance.available) : 0;
  
  // Get DB state
  const dbState = await getDBState();
  const startingBalance = dbState?.current_balance || currentUSDT;
  
  // Get performance metrics
  const metrics = await getPerformanceMetrics();
  
  // Build current positions
  const positions: Position[] = [];
  const tickers = await gateRequest('/spot/tickers');
  const tickerMap = new Map<string, { last: string; highest_bid: string }>(
    tickers.map((t: { currency_pair: string; last: string; highest_bid: string }) => [t.currency_pair, t])
  );
  
  let totalExposure = 0;
  
  for (const balance of balances) {
    if (balance.currency === 'USDT' || parseFloat(balance.available) <= 0) continue;
    
    const pair = `${balance.currency}_USDT`;
    const ticker = tickerMap.get(pair);
    if (!ticker) continue;
    
    const currentPrice = parseFloat(ticker.last);
    const amount = parseFloat(balance.available);
    const value = amount * currentPrice;
    
    if (value < 3) continue; // Skip dust
    
    // Get entry info from trade history
    const { data: entryTrade } = await supabase
      .from('trade_history')
      .select('*')
      .eq('symbol', pair.replace('_', '/'))
      .eq('side', 'buy')
      .order('executed_at', { ascending: false })
      .limit(1);
    
    const entryPrice = entryTrade?.[0]?.price || currentPrice;
    const pnlPercent = (currentPrice - entryPrice) / entryPrice;
    const stopLoss = entryPrice * (1 - CONFIG.STOP_LOSS_MIN);
    const trailingActivated = pnlPercent >= CONFIG.TRAILING_ACTIVATION;
    
    positions.push({
      symbol: pair,
      currency: balance.currency,
      entryPrice,
      amount,
      value,
      currentPrice,
      pnlPercent,
      stopLoss,
      trailingStop: trailingActivated ? calculateTrailingStop({ stopLoss, trailingStop: undefined, trailingActivated: false } as Position, currentPrice) : undefined,
      trailingActivated,
      tp1Hit: false, // Would need to track this
      tp2Hit: false,
      entryTime: Date.now(),
    });
    
    totalExposure += value;
  }
  
  // Calculate daily P&L
  const dailyPnL = currentUSDT + totalExposure - startingBalance;
  const dailyPnLPercent = startingBalance > 0 ? dailyPnL / startingBalance : 0;
  
  // Build system state
  const state: SystemState = {
    mode: 'normal',
    consecutiveLosses: 0, // Would track from trade history
    dailyPnL,
    dailyPnLPercent,
    startingBalance,
    currentBalance: currentUSDT,
    totalExposure,
    positions,
    riskMultiplier: 1.0,
    winRate: metrics.winRate,
    totalTrades: metrics.totalTrades,
    winningTrades: metrics.winningTrades,
  };
  
  // Evaluate system mode
  state.mode = evaluateSystemMode(state);
  
  // HALTED - No trading
  if (state.mode === 'halted') {
    await log('error', 'ENGINE', `🛑 SYSTEM HALTED - Daily drawdown: ${(dailyPnLPercent * 100).toFixed(2)}%`);
    return { scanned: 0, signals: 0, entries: 0, exits: 0, pnl: dailyPnL, balance: currentUSDT + totalExposure, mode: 'halted' };
  }
  
  await log('info', 'ENGINE', `Mode: ${state.mode.toUpperCase()} | Balance: $${currentUSDT.toFixed(2)} | Exposure: $${totalExposure.toFixed(2)} | Daily P&L: ${(dailyPnLPercent * 100).toFixed(2)}%`);
  
  // LAYER 1: Scan markets
  const markets = await scanMarkets();
  await log('info', 'SCANNER', `Scanned ${markets.length} pairs (filtered from tickers)`);
  
  // LAYER 4: Process exits first (risk control)
  const currentPrices = new Map<string, number>(
    positions.map(p => [p.symbol, p.currentPrice])
  );
  const exitActions = determineExits(positions, currentPrices);
  
  let totalExitPnL = 0;
  let exitCount = 0;
  
  for (const exit of exitActions) {
    const bid = parseFloat(tickerMap.get(exit.symbol)?.highest_bid || '0');
    if (bid <= 0) continue;
    
    const result = await executeOrder(exit.symbol, 'sell', exit.amount, bid, false);
    
    if (result.success) {
      const pnlUSDT = exit.amount * exit.price * exit.pnlPercent;
      totalExitPnL += pnlUSDT;
      exitCount++;
      
      await recordTrade({
        orderId: result.orderId || 'unknown',
        symbol: exit.symbol.replace('_', '/'),
        side: 'sell',
        type: exit.reason,
        amount: exit.amount,
        price: exit.price,
        expectedEdge: exit.pnlPercent * 100,
        actualPnL: pnlUSDT,
        status: 'filled',
      });
      
      const emoji = exit.reason === 'stop_loss' ? '🔴' : exit.reason.startsWith('tp') ? '🟢' : '🟡';
      await log('info', 'EXIT', `${emoji} ${exit.reason.toUpperCase()}: ${exit.currency} | ${(exit.pnlPercent * 100).toFixed(2)}% | $${pnlUSDT.toFixed(2)}`);
      
      // After TP1, move stop to breakeven
      if (exit.reason === 'tp1') {
        // Would update position's stop loss to entry + fees
      }
    }
    
    await new Promise(r => setTimeout(r, 200));
  }
  
  // LAYER 2: Entry signals
  const signals = analyzeEntrySignals(markets, state);
  await log('info', 'SIGNALS', `Found ${signals.length} entry signals`);
  
  // LAYER 6: Capital rotation - deploy capital immediately
  let entryCount = 0;
  const maxNewPositions = CONFIG.MAX_SIMULTANEOUS_POSITIONS - positions.length + exitCount;
  
  for (const signal of signals.slice(0, Math.min(maxNewPositions, 2))) {
    // Defense mode: only top 10 liquidity
    if (state.mode === 'defense') {
      const marketRank = markets.findIndex(m => m.pair === signal.pair);
      if (marketRank > 10) continue;
    }
    
    // Calculate position size
    const size = calculatePositionSize(signal, state);
    if (size < 5) continue; // Min trade size
    
    const amount = size / signal.price;
    
    // Prefer limit orders
    const result = await executeOrder(signal.pair, 'buy', amount, signal.price, true);
    
    if (result.success) {
      entryCount++;
      
      await recordTrade({
        orderId: result.orderId || 'unknown',
        symbol: signal.pair.replace('_', '/'),
        side: 'buy',
        type: signal.reason,
        amount,
        price: signal.price,
        expectedEdge: signal.expectedReturn * 100,
        status: 'filled',
      });
      
      await log('info', 'ENTRY', `🔵 ${signal.reason.toUpperCase()}: ${signal.currency} @ $${signal.price.toFixed(6)} | R:R ${signal.rewardRisk.toFixed(1)} | SL: $${signal.stopLoss.toFixed(6)}`);
    }
    
    await new Promise(r => setTimeout(r, 200));
  }
  
  // Update DB state
  const newBalance = currentUSDT + totalExposure + totalExitPnL;
  await updateDBState({
    current_balance: newBalance,
    total_pnl: (dbState?.total_pnl || 0) + totalExitPnL,
    total_trades: (dbState?.total_trades || 0) + entryCount + exitCount,
    successful_trades: (dbState?.successful_trades || 0) + (totalExitPnL > 0 ? 1 : 0),
    total_cycles: (dbState?.total_cycles || 0) + 1,
  });
  
  const cycleDuration = Date.now() - cycleStart;
  await log('info', 'ENGINE', `Cycle complete in ${cycleDuration}ms | Entries: ${entryCount} | Exits: ${exitCount} | P&L: $${totalExitPnL.toFixed(2)}`);
  
  return {
    scanned: markets.length,
    signals: signals.length,
    entries: entryCount,
    exits: exitCount,
    pnl: totalExitPnL,
    balance: newBalance,
    mode: state.mode,
  };
}

// ===================== HTTP HANDLER =====================
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const command = body.command || 'cycle';
    
    const dbState = await getDBState();
    
    // Command handlers
    if (command === 'stop') {
      await updateDBState({ is_active: false });
      await log('warn', 'ENGINE', '🛑 System STOPPED by user');
      return new Response(JSON.stringify({ success: true, message: 'System stopped' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    if (command === 'start') {
      await updateDBState({ is_active: true, started_at: new Date().toISOString() });
      await log('info', 'ENGINE', '🚀 System STARTED');
    }
    
    if (command === 'status') {
      const metrics = await getPerformanceMetrics();
      const recentTrades = await supabase.from('trade_history').select('*').order('created_at', { ascending: false }).limit(10);
      const recentLogs = await supabase.from('system_log').select('*').order('created_at', { ascending: false }).limit(20);
      
      return new Response(JSON.stringify({
        success: true,
        state: dbState,
        metrics,
        recentTrades: recentTrades.data,
        recentLogs: recentLogs.data,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // Check if active
    if (!dbState?.is_active && command !== 'start') {
      return new Response(JSON.stringify({ success: false, error: 'System is stopped. Send command: "start" to activate.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // Run trading cycle
    const result = await runTradingCycle();
    
    return new Response(JSON.stringify({
      success: true,
      ...result,
      timestamp: Date.now(),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
    
  } catch (error) {
    console.error('[ENGINE] Error:', error);
    await log('error', 'ENGINE', 'Cycle failed', { error: error instanceof Error ? error.message : 'Unknown' });
    
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
