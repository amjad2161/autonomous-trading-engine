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
  // Layer 1: Session Filter
  HIGH_LIQUIDITY_HOURS: [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], // London + NY overlap (UTC)
  OFF_HOURS_FREQUENCY_REDUCTION: 0.6, // 40% less trades
  
  // Layer 2: Dynamic Universe
  MIN_VOLUME: 500000,
  MAX_SPREAD_NORMAL: 0.30,
  MAX_SPREAD_HIGH_VOL: 0.35,
  MAX_SLIPPAGE: 0.15,
  WHITELIST_UPDATE_MINUTES: 30,
  
  // Layer 3: Scanner
  SCAN_INTERVAL_MS: 5000,
  IDLE_CAPITAL_THRESHOLD_MS: 7 * 60 * 1000, // 7 minutes
  
  // Layer 4: Entry Engine
  MIN_REWARD_RISK: 2.2,
  
  // Layer 5: Execution
  MAX_FEE_SLIPPAGE_RATIO: 0.18, // 18% of profit target
  
  // Layer 6: Position Sizing
  BASE_RISK_PER_TRADE: 0.012,
  AGGRESSIVE_RISK: 0.016,
  MAX_PER_ASSET: 0.12,
  MAX_POSITIONS: 4,
  MAX_EXPOSURE: 0.50,
  LOSS_SIZE_REDUCTION: 0.30,
  LOSS_WINDOW_MS: 90 * 60 * 1000, // 90 minutes
  
  // Layer 7: Risk Control
  STOP_LOSS_MIN: 0.020,
  STOP_LOSS_MAX: 0.028,
  TRAILING_ACTIVATION: 0.035,
  TRAILING_MIN: 0.020,
  TRAILING_MAX: 0.032,
  
  // Layer 8: Profit Extraction
  TP1_RANGE: [0.05, 0.06],
  TP1_SIZE: 0.35,
  TP2_RANGE: [0.08, 0.11],
  TP2_SIZE: 0.25,
  ADDON_THRESHOLD: 0.06,
  ADDON_SIZE: 0.20,
  
  // Layer 10: Circuit Breakers
  CONSECUTIVE_LOSS_THRESHOLD: 2,
  DAILY_DRAWDOWN_DEFENSE: 0.03,
  DAILY_DRAWDOWN_HALT: 0.05,
  DEFENSE_TOP_PAIRS: 10,
};

// ===================== TYPES =====================
type MarketRegime = 'TREND_CONTINUATION' | 'BREAKOUT_EXPANSION' | 'RANGE_MEAN_REVERSION' | 'DISTRIBUTION_EXHAUSTION' | 'PANIC_LIQUIDITY_EVENT';
type LossReason = 'BAD_TIMING' | 'SLIPPAGE' | 'STOP_HUNT' | 'REGIME_CHANGE' | 'OVEREXTENDED_ENTRY' | 'VOLUME_FAKE' | 'UNKNOWN';

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
  atr: number;
  volatility: number;
  vwapRelation: number;
  volumeImpulse: number;
  trendAlignment: number;
  orderBookImbalance: number;
  score: number;
  regime: MarketRegime;
}

interface Position {
  symbol: string;
  currency: string;
  entryPrice: number;
  amount: number;
  originalAmount: number;
  value: number;
  currentPrice: number;
  pnlPercent: number;
  stopLoss: number;
  trailingStop?: number;
  trailingActivated: boolean;
  tp1Hit: boolean;
  tp2Hit: boolean;
  addOnExecuted: boolean;
  entryTime: number;
  regime: MarketRegime;
}

interface SystemState {
  mode: 'normal' | 'aggressive' | 'defense' | 'halted';
  regime: MarketRegime;
  isHighLiquiditySession: boolean;
  consecutiveLosses: number;
  recentLossTime?: number;
  dailyPnL: number;
  dailyPnLPercent: number;
  startingBalance: number;
  currentBalance: number;
  totalExposure: number;
  positions: Position[];
  riskMultiplier: number;
  winRate: number;
  totalTrades: number;
  lastTradeTime: number;
  capitalIdleTime: number;
  whitelistedPairs: string[];
}

// ===================== GATE.IO API =====================
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

// ===================== LOGGING =====================
async function log(level: string, component: string, message: string, details?: unknown) {
  console.log(`[${component}] ${message}`);
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

// ===================== LAYER 1: SESSION FILTER =====================
function isHighLiquiditySession(): boolean {
  const now = new Date();
  const utcHour = now.getUTCHours();
  return CONFIG.HIGH_LIQUIDITY_HOURS.includes(utcHour);
}

// ===================== LAYER 2: REGIME DETECTION =====================
function detectMarketRegime(market: MarketData): MarketRegime {
  const { change24h, volatility, volume, atr, trendAlignment } = market;
  
  // PANIC: Extreme volatility + high volume + large negative move
  if (volatility > 8 && change24h < -10) {
    return 'PANIC_LIQUIDITY_EVENT';
  }
  
  // DISTRIBUTION: High volume but price stalling near highs
  const distFromHigh = (market.high24h - market.last) / market.high24h;
  if (distFromHigh < 0.03 && volatility > 4 && change24h < 3) {
    return 'DISTRIBUTION_EXHAUSTION';
  }
  
  // BREAKOUT: Near high with strong momentum and volume
  if (distFromHigh < 0.02 && change24h > 5 && volume > 1000000) {
    return 'BREAKOUT_EXPANSION';
  }
  
  // RANGE: Low volatility, oscillating
  if (volatility < 2 && Math.abs(change24h) < 3) {
    return 'RANGE_MEAN_REVERSION';
  }
  
  // TREND: Aligned momentum with volume
  if (trendAlignment > 0.7 && change24h > 3) {
    return 'TREND_CONTINUATION';
  }
  
  return 'RANGE_MEAN_REVERSION';
}

// ===================== LAYER 3: DYNAMIC UNIVERSE =====================
async function buildWhitelist(tickers: any[], highVolatility: boolean): Promise<string[]> {
  const maxSpread = highVolatility ? CONFIG.MAX_SPREAD_HIGH_VOL : CONFIG.MAX_SPREAD_NORMAL;
  
  const candidates = tickers
    .filter(t => {
      if (!t.currency_pair.endsWith('_USDT')) return false;
      const volume = parseFloat(t.quote_volume);
      if (volume < CONFIG.MIN_VOLUME) return false;
      
      const last = parseFloat(t.last);
      const bid = parseFloat(t.highest_bid);
      const ask = parseFloat(t.lowest_ask);
      const spread = ((ask - bid) / last) * 100;
      if (spread > maxSpread) return false;
      
      // Reject abnormal wick behavior
      const high = parseFloat(t.high_24h);
      const low = parseFloat(t.low_24h);
      const wickRatio = (high - low) / last;
      if (wickRatio > 0.5) return false; // 50% range is abnormal
      
      return true;
    })
    .sort((a, b) => parseFloat(b.quote_volume) - parseFloat(a.quote_volume))
    .slice(0, 100);
  
  return candidates.map(c => c.currency_pair);
}

// ===================== LAYER 4: MARKET SCANNER =====================
async function scanMarkets(whitelist: string[], highVolatility: boolean): Promise<MarketData[]> {
  const tickers = await gateRequest('/spot/tickers');
  const markets: MarketData[] = [];
  
  for (const ticker of tickers) {
    if (!whitelist.includes(ticker.currency_pair)) continue;
    
    const last = parseFloat(ticker.last);
    const bid = parseFloat(ticker.highest_bid);
    const ask = parseFloat(ticker.lowest_ask);
    const spread = ((ask - bid) / last) * 100;
    const volume = parseFloat(ticker.quote_volume);
    const high24h = parseFloat(ticker.high_24h);
    const low24h = parseFloat(ticker.low_24h);
    const change24h = parseFloat(ticker.change_percentage);
    
    const atr = ((high24h - low24h) / last) * 100;
    const volatility = atr / 24;
    
    // Simplified VWAP relation (above/below average)
    const midPrice = (high24h + low24h) / 2;
    const vwapRelation = (last - midPrice) / midPrice;
    
    // Volume impulse (simplified - would need historical)
    const volumeImpulse = volume > 1000000 ? 1.5 : 1.0;
    
    // Trend alignment (simplified)
    const trendAlignment = change24h > 0 ? Math.min(change24h / 10, 1) : 0;
    
    // Composite score
    const score = (
      volumeImpulse * 25 +
      (1 - spread) * 30 +
      trendAlignment * 25 +
      (volatility > 1 && volatility < 5 ? 20 : 10)
    );
    
    const market: MarketData = {
      pair: ticker.currency_pair,
      currency: ticker.currency_pair.split('_')[0],
      last, bid, ask, spread, volume,
      change1h: change24h / 24,
      change24h, high24h, low24h, atr, volatility,
      vwapRelation, volumeImpulse, trendAlignment,
      orderBookImbalance: 0,
      score,
      regime: 'RANGE_MEAN_REVERSION',
    };
    
    market.regime = detectMarketRegime(market);
    markets.push(market);
  }
  
  markets.sort((a, b) => b.score - a.score);
  return markets;
}

// ===================== LAYER 5: ENTRY ENGINE =====================
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
  regime: MarketRegime;
  slippageBudget: number;
}

function analyzeEntrySignals(markets: MarketData[], state: SystemState): EntrySignal[] {
  const signals: EntrySignal[] = [];
  
  // In defense mode, only top pairs
  const eligibleMarkets = state.mode === 'defense' 
    ? markets.slice(0, CONFIG.DEFENSE_TOP_PAIRS)
    : markets;
  
  for (const market of eligibleMarkets) {
    // Skip if already holding
    if (state.positions.some(p => p.currency === market.currency)) continue;
    
    // Skip if at max positions (reduced in defense)
    const maxPos = state.mode === 'defense' ? Math.floor(CONFIG.MAX_POSITIONS / 2) : CONFIG.MAX_POSITIONS;
    if (state.positions.length >= maxPos) break;
    
    // Skip PANIC regime
    if (market.regime === 'PANIC_LIQUIDITY_EVENT') continue;
    
    // Skip DISTRIBUTION unless very strong signal
    if (market.regime === 'DISTRIBUTION_EXHAUSTION' && market.score < 70) continue;
    
    // Dynamic stop loss based on volatility
    const stopPercent = Math.min(
      Math.max(market.volatility * 2, CONFIG.STOP_LOSS_MIN * 100),
      CONFIG.STOP_LOSS_MAX * 100
    ) / 100;
    const stopLoss = market.last * (1 - stopPercent);
    
    let reason = '';
    let expectedReturn = 0;
    let confidence = 0;
    
    // REGIME-SPECIFIC ENTRY LOGIC
    switch (market.regime) {
      case 'TREND_CONTINUATION':
        // Prefer pullback entries in trend
        if (market.change24h > 3 && market.change24h < 15 && market.vwapRelation > 0) {
          reason = 'trend_continuation';
          expectedReturn = 0.06;
          confidence = 75 + market.trendAlignment * 15;
        }
        break;
        
      case 'BREAKOUT_EXPANSION':
        // Fast entry on confirmed breakout
        const distFromHigh = (market.high24h - market.last) / market.high24h;
        if (distFromHigh < 0.01 && market.volume > 800000) {
          reason = 'breakout_expansion';
          expectedReturn = 0.05;
          confidence = 70 + (market.volume / 2000000) * 10;
        }
        break;
        
      case 'RANGE_MEAN_REVERSION':
        // Small scalps near support
        const distFromLow = (market.last - market.low24h) / market.low24h;
        if (distFromLow < 0.03 && market.change24h > -5) {
          reason = 'range_scalp';
          expectedReturn = 0.03;
          confidence = 65 + (market.spread < 0.15 ? 10 : 0);
        }
        break;
    }
    
    if (!reason) continue;
    
    // Calculate R:R
    const risk = stopPercent;
    const rewardRisk = expectedReturn / risk;
    
    // Layer 4: Must have R:R >= 2.2 after fees
    const fees = 0.004; // 0.4% round trip
    const netReturn = expectedReturn - fees;
    const netRR = netReturn / risk;
    if (netRR < CONFIG.MIN_REWARD_RISK) continue;
    
    // Layer 5: Slippage budget check
    const estimatedSlippage = market.spread / 100;
    const slippageBudget = (fees + estimatedSlippage) / expectedReturn;
    if (slippageBudget > CONFIG.MAX_FEE_SLIPPAGE_RATIO) continue;
    
    // Reject extended entries (late entries)
    if (market.change24h > 20) continue;
    
    // VWAP filter for longs
    if (market.vwapRelation < -0.05) continue; // Too far below VWAP
    
    signals.push({
      pair: market.pair,
      currency: market.currency,
      price: market.last,
      reason,
      expectedReturn,
      risk,
      rewardRisk: netRR,
      stopLoss,
      confidence: Math.min(confidence, 95),
      regime: market.regime,
      slippageBudget,
    });
  }
  
  signals.sort((a, b) => (b.confidence * b.rewardRisk) - (a.confidence * a.rewardRisk));
  return signals;
}

// ===================== LAYER 6: POSITION SIZING =====================
function calculatePositionSize(signal: EntrySignal, state: SystemState): number {
  let riskPercent = CONFIG.BASE_RISK_PER_TRADE;
  
  // Aggressive mode in strong trend
  if (state.mode === 'aggressive' && signal.regime === 'TREND_CONTINUATION') {
    riskPercent = CONFIG.AGGRESSIVE_RISK;
  }
  
  // Reduce after consecutive losses
  if (state.consecutiveLosses >= CONFIG.CONSECUTIVE_LOSS_THRESHOLD) {
    riskPercent *= (1 - CONFIG.LOSS_SIZE_REDUCTION);
  }
  
  // Defense mode reduction
  if (state.mode === 'defense') {
    riskPercent *= 0.6;
  }
  
  // Off-hours reduction
  if (!state.isHighLiquiditySession) {
    riskPercent *= CONFIG.OFF_HOURS_FREQUENCY_REDUCTION;
  }
  
  const riskAmount = state.currentBalance * riskPercent;
  const positionSize = riskAmount / signal.risk;
  
  // Limits
  const maxPerAsset = state.currentBalance * CONFIG.MAX_PER_ASSET;
  const maxExposure = state.currentBalance * CONFIG.MAX_EXPOSURE - state.totalExposure;
  
  return Math.min(positionSize, maxPerAsset, maxExposure, state.currentBalance * 0.2);
}

// ===================== LAYER 7: RISK CONTROL =====================
function calculateTrailingStop(position: Position, currentPrice: number, volatility: number): number | undefined {
  const pnlPercent = (currentPrice - position.entryPrice) / position.entryPrice;
  
  if (pnlPercent >= CONFIG.TRAILING_ACTIVATION) {
    // Volatility-weighted trailing distance
    const trailingDist = Math.min(
      Math.max(volatility * 0.02, CONFIG.TRAILING_MIN),
      CONFIG.TRAILING_MAX
    );
    const newTrailing = currentPrice * (1 - trailingDist);
    
    // Only tighten, never loosen
    if (!position.trailingStop || newTrailing > position.trailingStop) {
      return newTrailing;
    }
  }
  return position.trailingStop;
}

// ===================== LAYER 8: EXITS & PROFIT EXTRACTION =====================
interface ExitAction {
  symbol: string;
  currency: string;
  amount: number;
  price: number;
  reason: 'stop_loss' | 'trailing_stop' | 'tp1' | 'tp2' | 'regime_exit' | 'panic_exit';
  pnlPercent: number;
}

function determineExits(positions: Position[], markets: Map<string, MarketData>): ExitAction[] {
  const exits: ExitAction[] = [];
  
  for (const pos of positions) {
    const market = markets.get(pos.symbol);
    const currentPrice = market?.last || pos.currentPrice;
    const pnlPercent = (currentPrice - pos.entryPrice) / pos.entryPrice;
    
    // PANIC regime - exit immediately
    if (market?.regime === 'PANIC_LIQUIDITY_EVENT') {
      exits.push({
        symbol: pos.symbol,
        currency: pos.currency,
        amount: pos.amount,
        price: currentPrice,
        reason: 'panic_exit',
        pnlPercent,
      });
      continue;
    }
    
    // Hard Stop Loss
    if (currentPrice <= pos.stopLoss) {
      exits.push({
        symbol: pos.symbol,
        currency: pos.currency,
        amount: pos.amount,
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
        amount: pos.amount,
        price: currentPrice,
        reason: 'trailing_stop',
        pnlPercent,
      });
      continue;
    }
    
    // TP1: Take 35% at +5% to +6%
    if (!pos.tp1Hit && pnlPercent >= CONFIG.TP1_RANGE[0]) {
      exits.push({
        symbol: pos.symbol,
        currency: pos.currency,
        amount: pos.originalAmount * CONFIG.TP1_SIZE,
        price: currentPrice,
        reason: 'tp1',
        pnlPercent,
      });
    }
    
    // TP2: Take 25% at +8% to +11%
    if (!pos.tp2Hit && pos.tp1Hit && pnlPercent >= CONFIG.TP2_RANGE[0]) {
      exits.push({
        symbol: pos.symbol,
        currency: pos.currency,
        amount: pos.originalAmount * CONFIG.TP2_SIZE,
        price: currentPrice,
        reason: 'tp2',
        pnlPercent,
      });
    }
    
    // Regime change exit (was trend, now distribution)
    if (pos.regime === 'TREND_CONTINUATION' && market?.regime === 'DISTRIBUTION_EXHAUSTION' && pnlPercent > 0.02) {
      exits.push({
        symbol: pos.symbol,
        currency: pos.currency,
        amount: pos.amount * 0.5, // Exit half
        price: currentPrice,
        reason: 'regime_exit',
        pnlPercent,
      });
    }
  }
  
  return exits;
}

// ===================== LAYER 8B: WINNER SCALING =====================
interface AddOnAction {
  symbol: string;
  amount: number;
  price: number;
}

function determineAddOns(positions: Position[], markets: Map<string, MarketData>, state: SystemState): AddOnAction[] {
  const addOns: AddOnAction[] = [];
  
  if (state.mode === 'defense' || state.mode === 'halted') return addOns;
  
  for (const pos of positions) {
    if (pos.addOnExecuted) continue;
    
    const market = markets.get(pos.symbol);
    if (!market) continue;
    
    const pnlPercent = (market.last - pos.entryPrice) / pos.entryPrice;
    
    // Add-on at +6% in TREND_CONTINUATION
    if (pnlPercent >= CONFIG.ADDON_THRESHOLD && market.regime === 'TREND_CONTINUATION') {
      const addOnSize = pos.originalAmount * CONFIG.ADDON_SIZE * pos.entryPrice;
      
      // Check exposure limits
      const newExposure = state.totalExposure + addOnSize;
      const maxExposure = state.currentBalance * CONFIG.MAX_EXPOSURE;
      
      if (newExposure <= maxExposure) {
        addOns.push({
          symbol: pos.symbol,
          amount: addOnSize / market.last,
          price: market.last,
        });
      }
    }
  }
  
  return addOns;
}

// ===================== LAYER 10: LOSS ADAPTATION =====================
function evaluateSystemMode(state: SystemState): SystemState['mode'] {
  // HARD HALT
  if (state.dailyPnLPercent <= -CONFIG.DAILY_DRAWDOWN_HALT) {
    return 'halted';
  }
  
  // Defense Mode triggers
  if (state.dailyPnLPercent <= -CONFIG.DAILY_DRAWDOWN_DEFENSE) {
    return 'defense';
  }
  if (state.consecutiveLosses >= CONFIG.CONSECUTIVE_LOSS_THRESHOLD) {
    return 'defense';
  }
  if (state.totalTrades >= 10 && state.winRate < 0.35) {
    return 'defense';
  }
  
  // Aggressive mode
  if (state.winRate > 0.55 && state.dailyPnLPercent > 0.01 && state.consecutiveLosses === 0) {
    return 'aggressive';
  }
  
  return 'normal';
}

// ===================== LAYER 11: ERROR CLASSIFICATION =====================
function classifyLoss(trade: any, market?: MarketData): LossReason {
  const expectedEdge = trade.expected_edge || 0;
  const actualPnL = trade.actual_pnl || 0;
  
  // Slippage if actual much worse than expected
  if (actualPnL < expectedEdge * -0.5) {
    return 'SLIPPAGE';
  }
  
  // Stop hunt if hit stop and recovered
  if (trade.type === 'stop_loss' && market && market.last > trade.price * 1.02) {
    return 'STOP_HUNT';
  }
  
  // Regime change
  if (market?.regime === 'PANIC_LIQUIDITY_EVENT') {
    return 'REGIME_CHANGE';
  }
  
  // Overextended entry
  if (market && market.change24h > 15) {
    return 'OVEREXTENDED_ENTRY';
  }
  
  // Volume fake (low volume on entry)
  if (market && market.volume < CONFIG.MIN_VOLUME * 0.5) {
    return 'VOLUME_FAKE';
  }
  
  return 'UNKNOWN';
}

// ===================== EXECUTION =====================
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

// ===================== PERFORMANCE METRICS =====================
async function getPerformanceMetrics(): Promise<{
  winRate: number;
  profitFactor: number;
  totalTrades: number;
  consecutiveLosses: number;
  lastLossTime?: number;
}> {
  const { data: trades } = await supabase
    .from('trade_history')
    .select('*')
    .gte('executed_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('executed_at', { ascending: false });
  
  if (!trades || trades.length === 0) {
    return { winRate: 0.5, profitFactor: 1, totalTrades: 0, consecutiveLosses: 0 };
  }
  
  const wins = trades.filter(t => (t.actual_pnl || 0) > 0);
  const losses = trades.filter(t => (t.actual_pnl || 0) < 0);
  
  // Count consecutive losses from most recent
  let consecutiveLosses = 0;
  let lastLossTime: number | undefined;
  for (const trade of trades) {
    if ((trade.actual_pnl || 0) < 0) {
      consecutiveLosses++;
      if (!lastLossTime) lastLossTime = new Date(trade.executed_at).getTime();
    } else {
      break;
    }
  }
  
  const totalWins = wins.reduce((sum, t) => sum + (t.actual_pnl || 0), 0);
  const totalLosses = Math.abs(losses.reduce((sum, t) => sum + (t.actual_pnl || 0), 0));
  
  return {
    winRate: trades.length > 0 ? wins.length / trades.length : 0.5,
    profitFactor: totalLosses > 0 ? totalWins / totalLosses : (totalWins > 0 ? 10 : 1),
    totalTrades: trades.length,
    consecutiveLosses,
    lastLossTime,
  };
}

// ===================== MAIN CYCLE =====================
async function runTradingCycle(): Promise<{
  scanned: number;
  signals: number;
  entries: number;
  exits: number;
  addOns: number;
  pnl: number;
  balance: number;
  mode: string;
  regime: string;
  session: string;
}> {
  const cycleStart = Date.now();
  
  // Get balances
  const balances = await gateRequest('/spot/accounts');
  const usdtBalance = balances.find((b: { currency: string }) => b.currency === 'USDT');
  const currentUSDT = usdtBalance ? parseFloat(usdtBalance.available) : 0;
  
  const dbState = await getDBState();
  const startingBalance = dbState?.current_balance || currentUSDT;
  const metrics = await getPerformanceMetrics();
  
  // Get all tickers for whitelist and scanning
  const allTickers = await gateRequest('/spot/tickers');
  
  // Detect high volatility regime
  const avgVolatility = allTickers.reduce((sum: number, t: any) => {
    const high = parseFloat(t.high_24h);
    const low = parseFloat(t.low_24h);
    const last = parseFloat(t.last);
    return sum + ((high - low) / last) * 100;
  }, 0) / allTickers.length;
  const highVolatility = avgVolatility > 5;
  
  // Build whitelist (Layer 2)
  const whitelist = await buildWhitelist(allTickers, highVolatility);
  
  // Scan markets (Layer 3)
  const markets = await scanMarkets(whitelist, highVolatility);
  const marketMap = new Map(markets.map(m => [m.pair, m]));
  
  // Determine dominant regime
  const regimeCounts: Record<MarketRegime, number> = {
    'TREND_CONTINUATION': 0,
    'BREAKOUT_EXPANSION': 0,
    'RANGE_MEAN_REVERSION': 0,
    'DISTRIBUTION_EXHAUSTION': 0,
    'PANIC_LIQUIDITY_EVENT': 0,
  };
  markets.forEach(m => regimeCounts[m.regime]++);
  const dominantRegime = Object.entries(regimeCounts)
    .sort((a, b) => b[1] - a[1])[0][0] as MarketRegime;
  
  // Build positions
  const positions: Position[] = [];
  let totalExposure = 0;
  
  for (const balance of balances) {
    if (balance.currency === 'USDT' || parseFloat(balance.available) <= 0) continue;
    
    const pair = `${balance.currency}_USDT`;
    const market = marketMap.get(pair);
    if (!market) continue;
    
    const amount = parseFloat(balance.available);
    const value = amount * market.last;
    if (value < 3) continue;
    
    const { data: entryTrade } = await supabase
      .from('trade_history')
      .select('*')
      .eq('symbol', pair.replace('_', '/'))
      .eq('side', 'buy')
      .order('executed_at', { ascending: false })
      .limit(1);
    
    const entryPrice = entryTrade?.[0]?.price || market.last;
    const pnlPercent = (market.last - entryPrice) / entryPrice;
    const stopLoss = entryPrice * (1 - CONFIG.STOP_LOSS_MIN);
    const trailingActivated = pnlPercent >= CONFIG.TRAILING_ACTIVATION;
    
    positions.push({
      symbol: pair,
      currency: balance.currency,
      entryPrice,
      amount,
      originalAmount: amount,
      value,
      currentPrice: market.last,
      pnlPercent,
      stopLoss,
      trailingStop: trailingActivated ? calculateTrailingStop({ stopLoss, trailingActivated: false } as Position, market.last, market.volatility) : undefined,
      trailingActivated,
      tp1Hit: false,
      tp2Hit: false,
      addOnExecuted: false,
      entryTime: Date.now(),
      regime: market.regime,
    });
    
    totalExposure += value;
  }
  
  // Build system state
  const dailyPnL = currentUSDT + totalExposure - startingBalance;
  const dailyPnLPercent = startingBalance > 0 ? dailyPnL / startingBalance : 0;
  const isHighLiq = isHighLiquiditySession();
  
  const state: SystemState = {
    mode: 'normal',
    regime: dominantRegime,
    isHighLiquiditySession: isHighLiq,
    consecutiveLosses: metrics.consecutiveLosses,
    recentLossTime: metrics.lastLossTime,
    dailyPnL,
    dailyPnLPercent,
    startingBalance,
    currentBalance: currentUSDT,
    totalExposure,
    positions,
    riskMultiplier: 1.0,
    winRate: metrics.winRate,
    totalTrades: metrics.totalTrades,
    lastTradeTime: Date.now(),
    capitalIdleTime: 0,
    whitelistedPairs: whitelist,
  };
  
  state.mode = evaluateSystemMode(state);
  
  // HALTED
  if (state.mode === 'halted') {
    await log('error', 'ENGINE', `🛑 HALTED | Drawdown: ${(dailyPnLPercent * 100).toFixed(2)}%`);
    return { scanned: 0, signals: 0, entries: 0, exits: 0, addOns: 0, pnl: dailyPnL, balance: currentUSDT + totalExposure, mode: 'halted', regime: dominantRegime, session: isHighLiq ? 'HIGH' : 'LOW' };
  }
  
  await log('info', 'ENGINE', `${state.mode.toUpperCase()} | ${dominantRegime} | Session: ${isHighLiq ? 'HIGH' : 'LOW'} | Balance: $${currentUSDT.toFixed(2)} | Exposure: $${totalExposure.toFixed(2)}`);
  
  // EXITS (Layer 7, 8)
  const exitActions = determineExits(positions, marketMap);
  let totalExitPnL = 0;
  let exitCount = 0;
  
  for (const exit of exitActions) {
    const market = marketMap.get(exit.symbol);
    if (!market) continue;
    
    const result = await executeOrder(exit.symbol, 'sell', exit.amount, market.bid, false);
    
    if (result.success) {
      const pnlUSDT = exit.amount * exit.price * exit.pnlPercent;
      totalExitPnL += pnlUSDT;
      exitCount++;
      
      // Log loss classification
      if (pnlUSDT < 0) {
        const lossReason = classifyLoss({ type: exit.reason, price: exit.price, actual_pnl: pnlUSDT }, market);
        await log('warn', 'LOSS', `${lossReason}: ${exit.currency} | ${(exit.pnlPercent * 100).toFixed(2)}%`);
      }
      
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
      
      const emoji = exit.reason.includes('stop') ? '🔴' : exit.reason.startsWith('tp') ? '🟢' : '🟡';
      await log('info', 'EXIT', `${emoji} ${exit.reason.toUpperCase()}: ${exit.currency} | ${(exit.pnlPercent * 100).toFixed(2)}% | $${pnlUSDT.toFixed(2)}`);
    }
    
    await new Promise(r => setTimeout(r, 150));
  }
  
  // ADD-ONS (Layer 8)
  const addOnActions = determineAddOns(positions, marketMap, state);
  let addOnCount = 0;
  
  for (const addOn of addOnActions) {
    const market = marketMap.get(addOn.symbol);
    if (!market) continue;
    
    const result = await executeOrder(addOn.symbol, 'buy', addOn.amount, addOn.price, true);
    
    if (result.success) {
      addOnCount++;
      await recordTrade({
        orderId: result.orderId || 'unknown',
        symbol: addOn.symbol.replace('_', '/'),
        side: 'buy',
        type: 'add_on',
        amount: addOn.amount,
        price: addOn.price,
        expectedEdge: CONFIG.ADDON_THRESHOLD * 100,
        status: 'filled',
      });
      await log('info', 'ADD_ON', `📈 Added to winner: ${addOn.symbol}`);
    }
  }
  
  // ENTRIES (Layer 4, 5, 6)
  const signals = analyzeEntrySignals(markets, state);
  let entryCount = 0;
  
  // Limit entries based on session and mode
  let maxNewEntries = 2;
  if (!isHighLiq) maxNewEntries = 1;
  if (state.mode === 'defense') maxNewEntries = 1;
  
  for (const signal of signals.slice(0, maxNewEntries)) {
    const size = calculatePositionSize(signal, state);
    if (size < 5) continue;
    
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
      
      await log('info', 'ENTRY', `🔵 ${signal.reason.toUpperCase()} [${signal.regime}]: ${signal.currency} @ $${signal.price.toFixed(6)} | R:R ${signal.rewardRisk.toFixed(1)} | SL: $${signal.stopLoss.toFixed(6)}`);
    }
    
    await new Promise(r => setTimeout(r, 150));
  }
  
  // Update state
  const newBalance = currentUSDT + totalExposure + totalExitPnL;
  await updateDBState({
    current_balance: newBalance,
    total_pnl: (dbState?.total_pnl || 0) + totalExitPnL,
    total_trades: (dbState?.total_trades || 0) + entryCount + exitCount,
    successful_trades: (dbState?.successful_trades || 0) + (totalExitPnL > 0 ? 1 : 0),
    total_cycles: (dbState?.total_cycles || 0) + 1,
  });
  
  const cycleDuration = Date.now() - cycleStart;
  await log('info', 'ENGINE', `Cycle ${cycleDuration}ms | E:${entryCount} X:${exitCount} A:${addOnCount} | P&L: $${totalExitPnL.toFixed(2)}`);
  
  return {
    scanned: markets.length,
    signals: signals.length,
    entries: entryCount,
    exits: exitCount,
    addOns: addOnCount,
    pnl: totalExitPnL,
    balance: newBalance,
    mode: state.mode,
    regime: dominantRegime,
    session: isHighLiq ? 'HIGH_LIQUIDITY' : 'LOW_LIQUIDITY',
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
    
    if (command === 'stop') {
      await updateDBState({ is_active: false });
      await log('warn', 'ENGINE', '🛑 System STOPPED');
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
        session: isHighLiquiditySession() ? 'HIGH_LIQUIDITY' : 'LOW_LIQUIDITY',
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    if (!dbState?.is_active && command !== 'start') {
      return new Response(JSON.stringify({ success: false, error: 'System stopped. Send "start" to activate.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
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
