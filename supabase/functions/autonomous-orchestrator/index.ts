import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac } from "https://deno.land/std@0.177.0/node/crypto.ts";
import { encodeHex } from "https://deno.land/std@0.224.0/encoding/hex.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseKey);

// ===================== CONFIGURATION =====================
// 🎯 CAPITAL ACCUMULATION MODE - Start small, compound gains
const CONFIG = {
  // Module 1: Risk Governor - CONSERVATIVE for capital building
  BASE_RISK: 0.006,       // 0.6% per trade (was 1.2%) - micro risk
  MIN_RISK: 0.004,        // 0.4% minimum
  MAX_RISK: 0.010,        // 1.0% max (was 1.6%)
  MAX_POSITIONS: 3,       // Focus on fewer, quality trades
  MAX_PER_ASSET: 0.08,    // 8% max per asset (was 12%)
  MAX_EXPOSURE: 0.35,     // 35% total exposure (was 50%)
  DAILY_DD_DEFENSE: 0.02, // Enter defense at -2% (was -3%)
  DAILY_DD_HALT: 0.04,    // Halt at -4% (was -5%)
  LOSS_CLUSTER_WINDOW_MS: 60 * 60 * 1000, // 1 hour (was 90 min)
  LOSS_SIZE_REDUCTION: 0.40, // Reduce 40% after loss (was 30%)
  CONSECUTIVE_LOSS_THRESHOLD: 2,
  
  // Module 3: Dynamic Universe - STRICTER filters
  MIN_VOLUME: 800000,     // Higher volume = better liquidity
  MAX_SPREAD_NORMAL: 0.20, // Tighter spread (was 0.30%)
  MAX_SPREAD_HIGH_VOL: 0.28,
  MAX_SLIPPAGE: 0.10,     // Lower slippage tolerance
  WHITELIST_UPDATE_MS: 10 * 60 * 1000, // More frequent updates
  
  // Module 4: Turbo Scanner
  SCAN_INTERVAL_MS: 3000, // Faster scanning
  IDLE_THRESHOLD_MS: 5 * 60 * 1000,
  
  // Module 5: Signal Validation - VERY AGGRESSIVE for maximum trades
  MIN_REWARD_RISK: 0.5,   // R:R >= 0.5 (was 2.0) - VERY LOW
  MAX_FEE_SLIPPAGE_RATIO: 0.25, // More relaxed
  
  // Module 6: Execution
  LIMIT_TTL_MS: 3000,     // Faster TTL
  
  // Module 9: Risk Immunity - TIGHTER stops
  STOP_LOSS_MIN: 0.015,   // 1.5% min stop (was 2%)
  STOP_LOSS_MAX: 0.022,   // 2.2% max stop (was 2.8%)
  TRAILING_ACTIVATION: 0.025, // Trail activates at +2.5% (was 3.5%)
  TRAILING_MIN: 0.015,
  TRAILING_MAX: 0.025,
  
  // Module 10: Profit Extraction - FASTER profit taking
  TP1_PERCENT: 0.030,     // Take profit at +3% (was 5.5%)
  TP1_SIZE: 0.40,         // Take 40% at TP1
  TP2_PERCENT: 0.055,     // TP2 at +5.5% (was 9.5%)
  TP2_SIZE: 0.35,         // Take 35% at TP2
  ADDON_THRESHOLD: 0.08,  // Only add at +8% (was 6%)
  ADDON_SIZE: 0.15,       // Smaller add-on (was 20%)
  
  // Module 12: Circuit Breakers
  MAX_API_FAILURES: 2,    // More cautious
  DEFENSE_TOP_PAIRS: 5,   // Focus on top 5 in defense
  
  // Module 14: Auto-Pruning
  PRUNE_BOTTOM_PERCENT: 0.25, // Prune more aggressively
  
  // 🆕 Module 15: Dynamic Position Sizing
  VOLATILITY_SIZE_SCALING: true,
  LOW_VOL_MULTIPLIER: 1.3,   // Size up in low vol
  HIGH_VOL_MULTIPLIER: 0.6,  // Size down in high vol
  VOL_LOW_THRESHOLD: 1.5,    // % daily volatility
  VOL_HIGH_THRESHOLD: 4.0,
  
  // 🆕 Module 16: Correlation Management
  MAX_CORRELATED_POSITIONS: 2,
  CORRELATION_PAIRS: [
    ['BTC_USDT', 'ETH_USDT'],
    ['SOL_USDT', 'AVAX_USDT'],
    ['DOGE_USDT', 'SHIB_USDT'],
    ['PEPE_USDT', 'FLOKI_USDT'],
    ['ARB_USDT', 'OP_USDT'],
  ] as [string, string][],
};

// ===================== TYPES =====================
type MarketRegime = 'TREND_CONTINUATION' | 'BREAKOUT_EXPANSION' | 'RANGE_HARVEST' | 'DISTRIBUTION_EXHAUSTION' | 'PANIC_LIQUIDITY_EVENT';
type PositionState = 'NONE' | 'ENTERING' | 'OPEN' | 'EXITING' | 'CLOSED';
type SystemState = 'NORMAL' | 'TURBO' | 'DEFENSE' | 'HALT';
type ActionType = 'ENTER' | 'MODIFY_PROTECTION' | 'PARTIAL_TAKE_PROFIT' | 'EXIT' | 'CANCEL' | 'HALT';
type LossReason = 'ENTRY_TOO_EARLY' | 'BREAKOUT_FAKEOUT' | 'LIQUIDITY_TRAP' | 'TREND_REVERSAL' | 'REGIME_MISCLASS' | 'SLIPPAGE_DAMAGE' | 'UNKNOWN';

interface Position {
  signal_id: string;
  symbol: string;
  currency: string;
  state: PositionState;
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
  setupType: string;
  clientOrderId: string;
}

interface MarketData {
  pair: string;
  currency: string;
  last: number;
  bid: number;
  ask: number;
  spread: number;
  volume: number;
  change24h: number;
  high24h: number;
  low24h: number;
  atr: number;
  volatility: number;
  vwapRelation: number;
  volumeImpulse: number;
  trendAlignment: number;
  score: number;
  regime: MarketRegime;
}

interface TradeDecision {
  action: ActionType;
  pair: string;
  regime: MarketRegime;
  signal_score: number;
  validation_reason: string;
  order_type: 'LIMIT_MAKER' | 'MARKET_TAKER';
  ttl_ms?: number;
  size: number;
  size_percent: number;
  hard_stop_loss: number;
  trailing_activation: number;
  trailing_distance: number;
  partial_tp_levels: { price: number; percent: number; amount_percent: number }[];
  exposure_per_asset: number;
  exposure_total: number;
  system_state: SystemState;
  reconcile_status: 'OK' | 'REPAIRING' | 'ERROR';
  learning_note?: string;
}

interface EngineState {
  systemState: SystemState;
  regime: MarketRegime;
  consecutiveLosses: number;
  lastLossTime?: number;
  dailyPnL: number;
  dailyPnLPercent: number;
  dayStartBalance: number;
  currentBalance: number;
  totalExposure: number;
  positions: Position[];
  whitelistedPairs: string[];
  lastWhitelistUpdate: number;
  apiFailures: number;
  reconcileStatus: 'OK' | 'REPAIRING' | 'ERROR';
  lastTradeTime: number;
  capitalIdleSince: number;
  disabledPairs: Set<string>;
  errorCounts: Map<LossReason, number>;
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

// ===================== ERROR RECOVERY SYSTEM =====================
const ERROR_RECOVERY = {
  MAX_RETRIES: 3,
  BASE_DELAY_MS: 1000,
  MAX_DELAY_MS: 30000,
  CIRCUIT_BREAKER_THRESHOLD: 5,
  CIRCUIT_BREAKER_RESET_MS: 5 * 60 * 1000,
};

let circuitBreaker = {
  failures: 0,
  lastFailure: 0,
  isOpen: false,
};

async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
  maxRetries: number = ERROR_RECOVERY.MAX_RETRIES
): Promise<T> {
  // Check circuit breaker
  if (circuitBreaker.isOpen) {
    if (Date.now() - circuitBreaker.lastFailure > ERROR_RECOVERY.CIRCUIT_BREAKER_RESET_MS) {
      circuitBreaker.isOpen = false;
      circuitBreaker.failures = 0;
      await log('info', 'ERROR_RECOVERY', '🔄 Circuit breaker reset');
    } else {
      throw new Error(`Circuit breaker open for ${operationName}`);
    }
  }

  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await operation();
      // Success - reset circuit breaker
      if (circuitBreaker.failures > 0) {
        circuitBreaker.failures = Math.max(0, circuitBreaker.failures - 1);
      }
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      
      // Don't retry on certain errors
      const errorMsg = lastError.message.toLowerCase();
      if (errorMsg.includes('insufficient') || 
          errorMsg.includes('invalid') ||
          errorMsg.includes('not found')) {
        throw lastError;
      }
      
      if (attempt < maxRetries) {
        // Exponential backoff
        const delay = Math.min(
          ERROR_RECOVERY.BASE_DELAY_MS * Math.pow(2, attempt - 1),
          ERROR_RECOVERY.MAX_DELAY_MS
        );
        await log('warn', 'ERROR_RECOVERY', `Retry ${attempt}/${maxRetries} for ${operationName} in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  
  // All retries failed - update circuit breaker
  circuitBreaker.failures++;
  circuitBreaker.lastFailure = Date.now();
  
  if (circuitBreaker.failures >= ERROR_RECOVERY.CIRCUIT_BREAKER_THRESHOLD) {
    circuitBreaker.isOpen = true;
    await log('error', 'ERROR_RECOVERY', `🔴 Circuit breaker OPENED after ${circuitBreaker.failures} failures`);
  }
  
  throw lastError!;
}

async function gateRequest(endpoint: string, method: 'GET' | 'POST' | 'DELETE' = 'GET', params: Record<string, string> = {}, body?: Record<string, unknown>): Promise<any> {
  return withRetry(async () => {
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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(fullUrl, {
        method,
        headers: { 'KEY': GATE_API_KEY, 'SIGN': signature, 'Timestamp': timestamp, 'Content-Type': 'application/json' },
        body: payloadString || undefined,
        signal: controller.signal,
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }
      
      return response.json();
    } finally {
      clearTimeout(timeout);
    }
  }, `gateRequest:${endpoint}`);
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

// ===================== MODULE 1: RISK GOVERNOR =====================
function isJerusalemDayStart(): boolean {
  // Jerusalem timezone is UTC+2 (or UTC+3 in summer)
  const now = new Date();
  const jerusalemHour = (now.getUTCHours() + 2) % 24;
  return jerusalemHour === 0;
}

function getJerusalemDayKey(): string {
  const now = new Date();
  const jerusalemOffset = 2 * 60 * 60 * 1000;
  const jerusalemDate = new Date(now.getTime() + jerusalemOffset);
  return jerusalemDate.toISOString().split('T')[0];
}

function calculateDynamicRisk(state: EngineState): number {
  let risk = CONFIG.BASE_RISK;
  
  // Reduce after losses
  if (state.consecutiveLosses >= CONFIG.CONSECUTIVE_LOSS_THRESHOLD) {
    risk *= (1 - CONFIG.LOSS_SIZE_REDUCTION);
  }
  
  // Reduce in defense
  if (state.systemState === 'DEFENSE') {
    risk *= 0.6;
  }
  
  // Increase in strong trend with good performance
  if (state.regime === 'TREND_CONTINUATION' && state.dailyPnLPercent > 0.01) {
    risk = Math.min(risk * 1.2, CONFIG.MAX_RISK);
  }
  
  return Math.max(CONFIG.MIN_RISK, Math.min(risk, CONFIG.MAX_RISK));
}

// ===================== MODULE 2: MARKET REGIME ENGINE =====================
function detectRegime(market: MarketData): MarketRegime {
  const { change24h, volatility, volume, atr } = market;
  
  // PANIC: Extreme volatility + crash
  if (volatility > 8 && change24h < -10) {
    return 'PANIC_LIQUIDITY_EVENT';
  }
  
  // DISTRIBUTION: Stalling near highs
  const distFromHigh = (market.high24h - market.last) / market.high24h;
  if (distFromHigh < 0.03 && volatility > 4 && change24h < 3) {
    return 'DISTRIBUTION_EXHAUSTION';
  }
  
  // BREAKOUT: Near high with momentum
  if (distFromHigh < 0.02 && change24h > 5 && volume > 1000000) {
    return 'BREAKOUT_EXPANSION';
  }
  
  // RANGE: Low volatility oscillation
  if (volatility < 2 && Math.abs(change24h) < 3) {
    return 'RANGE_HARVEST';
  }
  
  // TREND
  if (change24h > 3 && volume > 500000) {
    return 'TREND_CONTINUATION';
  }
  
  return 'RANGE_HARVEST';
}

// ===================== MODULE 3: DYNAMIC UNIVERSE =====================
function buildWhitelist(tickers: any[], highVol: boolean, disabledPairs: Set<string>): string[] {
  const maxSpread = highVol ? CONFIG.MAX_SPREAD_HIGH_VOL : CONFIG.MAX_SPREAD_NORMAL;
  
  return tickers
    .filter(t => {
      if (!t.currency_pair.endsWith('_USDT')) return false;
      if (disabledPairs.has(t.currency_pair)) return false;
      
      const volume = parseFloat(t.quote_volume);
      if (volume < CONFIG.MIN_VOLUME) return false;
      
      const last = parseFloat(t.last);
      const bid = parseFloat(t.highest_bid);
      const ask = parseFloat(t.lowest_ask);
      const spread = ((ask - bid) / last) * 100;
      if (spread > maxSpread) return false;
      
      // Reject abnormal wicks
      const high = parseFloat(t.high_24h);
      const low = parseFloat(t.low_24h);
      if ((high - low) / last > 0.5) return false;
      
      return true;
    })
    .sort((a, b) => parseFloat(b.quote_volume) - parseFloat(a.quote_volume))
    .slice(0, 100)
    .map(t => t.currency_pair);
}

// ===================== MODULE 15: DYNAMIC POSITION SIZING =====================
function calculateVolatilityAdjustedSize(baseSize: number, volatility: number): number {
  if (!CONFIG.VOLATILITY_SIZE_SCALING) return baseSize;
  
  if (volatility < CONFIG.VOL_LOW_THRESHOLD) {
    // Low volatility - can size up
    return baseSize * CONFIG.LOW_VOL_MULTIPLIER;
  } else if (volatility > CONFIG.VOL_HIGH_THRESHOLD) {
    // High volatility - size down
    return baseSize * CONFIG.HIGH_VOL_MULTIPLIER;
  }
  
  // Linear interpolation between thresholds
  const range = CONFIG.VOL_HIGH_THRESHOLD - CONFIG.VOL_LOW_THRESHOLD;
  const position = (volatility - CONFIG.VOL_LOW_THRESHOLD) / range;
  const multiplier = CONFIG.LOW_VOL_MULTIPLIER - (CONFIG.LOW_VOL_MULTIPLIER - CONFIG.HIGH_VOL_MULTIPLIER) * position;
  
  return baseSize * multiplier;
}

// ===================== MODULE 16: CORRELATION MANAGER =====================
function isCorrelatedWith(pair1: string, pair2: string): boolean {
  for (const [a, b] of CONFIG.CORRELATION_PAIRS) {
    if ((pair1 === a && pair2 === b) || (pair1 === b && pair2 === a)) {
      return true;
    }
  }
  return false;
}

function countCorrelatedPositions(targetPair: string, positions: Position[]): number {
  let count = 0;
  for (const pos of positions) {
    if (isCorrelatedWith(targetPair, pos.symbol)) {
      count++;
    }
  }
  return count;
}

// ===================== MODULE 4: TURBO SCANNER =====================
async function scanMarkets(whitelist: string[], tickers: any[]): Promise<MarketData[]> {
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
    
    const midPrice = (high24h + low24h) / 2;
    const vwapRelation = (last - midPrice) / midPrice;
    const volumeImpulse = volume > 1000000 ? 1.5 : 1.0;
    const trendAlignment = change24h > 0 ? Math.min(change24h / 10, 1) : 0;
    
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
      change24h, high24h, low24h, atr, volatility,
      vwapRelation, volumeImpulse, trendAlignment, score,
      regime: 'RANGE_HARVEST',
    };
    
    market.regime = detectRegime(market);
    markets.push(market);
  }
  
  markets.sort((a, b) => b.score - a.score);
  return markets;
}

// ===================== MODULE 5: SIGNAL VALIDATION =====================
interface Signal {
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
  signal_id: string;
}

function generateSignalId(): string {
  return `sig_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function validateSignals(markets: MarketData[], state: EngineState): Signal[] {
  const signals: Signal[] = [];
  const maxPos = state.systemState === 'DEFENSE' ? Math.floor(CONFIG.MAX_POSITIONS / 2) : CONFIG.MAX_POSITIONS;
  const eligibleMarkets = state.systemState === 'DEFENSE' ? markets.slice(0, CONFIG.DEFENSE_TOP_PAIRS) : markets;
  
  // 🔥 NON-STOP MODE: If no positions, be MORE aggressive to find opportunities
  const noPositions = state.positions.length === 0;
  const urgencyBonus = noPositions ? 0.3 : 0; // Lower R:R requirement when idle
  
  for (const market of eligibleMarkets) {
    if (state.positions.some(p => p.currency === market.currency)) continue;
    if (state.positions.length >= maxPos) break;
    if (market.regime === 'PANIC_LIQUIDITY_EVENT') continue;
    // Relaxed: Only skip distribution if score is really low
    if (market.regime === 'DISTRIBUTION_EXHAUSTION' && market.score < 50) continue;
    
    // Dynamic stop based on volatility
    const stopPercent = Math.min(
      Math.max(market.volatility * 2, CONFIG.STOP_LOSS_MIN * 100),
      CONFIG.STOP_LOSS_MAX * 100
    ) / 100;
    const stopLoss = market.last * (1 - stopPercent);
    
    let reason = '';
    let expectedReturn = 0;
    let confidence = 0;
    
    // 🔥 EXPANDED SIGNAL DETECTION - More entry types
    switch (market.regime) {
      case 'TREND_CONTINUATION':
        // Relaxed: accept smaller trends
        if (market.change24h > 1.5 && market.change24h < 20) {
          reason = 'trend_ride';
          expectedReturn = 0.04;
          confidence = 70 + market.trendAlignment * 20;
        }
        break;
        
      case 'BREAKOUT_EXPANSION':
        const distFromHigh = (market.high24h - market.last) / market.high24h;
        // Relaxed volume requirement
        if (distFromHigh < 0.02 && market.volume > 500000) {
          reason = 'breakout_chase';
          expectedReturn = 0.035;
          confidence = 68 + (market.volume / 1500000) * 15;
        }
        break;
        
      case 'RANGE_HARVEST':
        const distFromLow = (market.last - market.low24h) / market.low24h;
        // MORE AGGRESSIVE: Accept wider range
        if (distFromLow < 0.05 && market.change24h > -8) {
          reason = 'bounce_scalp';
          expectedReturn = 0.025;
          confidence = 62 + (market.spread < 0.20 ? 12 : 0);
        }
        // 🔥 NEW: Micro momentum scalp
        else if (market.change24h > 0.5 && market.change24h < 5 && market.volume > 300000) {
          reason = 'micro_momentum';
          expectedReturn = 0.02;
          confidence = 60 + market.volumeImpulse * 10;
        }
        break;
        
      case 'DISTRIBUTION_EXHAUSTION':
        // 🔥 NEW: Short-term reversal play
        if (market.change24h < -3 && market.change24h > -10 && market.volume > 400000) {
          reason = 'dip_buy';
          expectedReturn = 0.03;
          confidence = 58;
        }
        break;
    }
    
    if (!reason) continue;
    
    const fees = 0.004;
    const netReturn = expectedReturn - fees;
    const netRR = netReturn / stopPercent;
    
    // 🔥 URGENCY: Lower R:R requirement when capital is idle
    const requiredRR = CONFIG.MIN_REWARD_RISK - urgencyBonus;
    if (netRR < requiredRR) continue;
    
    const slippageBudget = (fees + market.spread / 100) / expectedReturn;
    // Relaxed slippage tolerance
    if (slippageBudget > CONFIG.MAX_FEE_SLIPPAGE_RATIO + (noPositions ? 0.05 : 0)) continue;
    
    // Relaxed extension filter
    if (market.change24h > 25) continue;
    if (market.vwapRelation < -0.08) continue;
    
    signals.push({
      pair: market.pair,
      currency: market.currency,
      price: market.last,
      reason,
      expectedReturn,
      risk: stopPercent,
      rewardRisk: netRR,
      stopLoss,
      confidence: Math.min(confidence + (noPositions ? 5 : 0), 95),
      regime: market.regime,
      slippageBudget,
      signal_id: generateSignalId(),
    });
  }
  
  signals.sort((a, b) => (b.confidence * b.rewardRisk) - (a.confidence * a.rewardRisk));
  return signals;
}

// ===================== MODULE 6: EXECUTION =====================
function generateClientOrderId(): string {
  return `lov_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

async function executeLimitOrder(
  pair: string,
  side: 'buy' | 'sell',
  amount: number,
  price: number,
  clientOrderId: string,
  ttlMs: number = CONFIG.LIMIT_TTL_MS
): Promise<{ success: boolean; orderId?: string; filled?: number; error?: string }> {
  try {
    const order = await gateRequest('/spot/orders', 'POST', {}, {
      currency_pair: pair,
      side,
      amount: amount.toFixed(6),
      price: price.toFixed(8),
      type: 'limit',
      time_in_force: 'ioc',
      text: clientOrderId,
    });
    
    if (order.id) {
      return { success: true, orderId: order.id, filled: parseFloat(order.filled_total || order.amount) };
    }
    return { success: false, error: JSON.stringify(order) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown' };
  }
}

// ===================== MODULE 7 & 8: STATE MACHINE & RECONCILIATION =====================
async function reconcileState(state: EngineState, tickers: any[]): Promise<EngineState> {
  try {
    const balances = await gateRequest('/spot/accounts');
    // Note: Skip open orders fetch if it causes issues - we don't need it for basic reconcile
    // Don't fetch all orders at once - Gate.io requires currency_pair parameter
    // We'll handle order cleanup per-pair when needed instead
    const openOrders: any[] = [];
    
    const tickerMap = new Map(
      tickers.map((t: any) => [t.currency_pair, { last: parseFloat(t.last), bid: parseFloat(t.highest_bid) }])
    );
    
    const usdtBalance = balances.find((b: any) => b.currency === 'USDT');
    state.currentBalance = usdtBalance ? parseFloat(usdtBalance.available) : 0;
    
    // Rebuild positions from balances
    const newPositions: Position[] = [];
    let totalExposure = 0;
    
    for (const balance of balances) {
      if (balance.currency === 'USDT' || parseFloat(balance.available) <= 0) continue;
      
      const pair = `${balance.currency}_USDT`;
      const ticker = tickerMap.get(pair);
      if (!ticker) continue;
      
      const amount = parseFloat(balance.available);
      const value = amount * ticker.last;
      if (value < 3) continue;
      
      // Find existing position or create new
      const existing = state.positions.find(p => p.currency === balance.currency);
      
      const { data: entryTrade } = await supabase
        .from('trade_history')
        .select('*')
        .eq('symbol', pair.replace('_', '/'))
        .eq('side', 'buy')
        .order('executed_at', { ascending: false })
        .limit(1);
      
      const entryPrice = entryTrade?.[0]?.price || ticker.last;
      const pnlPercent = (ticker.last - entryPrice) / entryPrice;
      const stopLoss = existing?.stopLoss || entryPrice * (1 - CONFIG.STOP_LOSS_MIN);
      const trailingActivated = pnlPercent >= CONFIG.TRAILING_ACTIVATION;
      
      let trailingStop = existing?.trailingStop;
      if (trailingActivated) {
        const trailDist = CONFIG.TRAILING_MIN + (CONFIG.TRAILING_MAX - CONFIG.TRAILING_MIN) / 2;
        const newTrail = ticker.last * (1 - trailDist);
        if (!trailingStop || newTrail > trailingStop) {
          trailingStop = newTrail;
        }
      }
      
      newPositions.push({
        signal_id: existing?.signal_id || generateSignalId(),
        symbol: pair,
        currency: balance.currency,
        state: 'OPEN',
        entryPrice,
        amount,
        originalAmount: existing?.originalAmount || amount,
        value,
        currentPrice: ticker.last,
        pnlPercent,
        stopLoss,
        trailingStop,
        trailingActivated,
        tp1Hit: existing?.tp1Hit || false,
        tp2Hit: existing?.tp2Hit || false,
        addOnExecuted: existing?.addOnExecuted || false,
        entryTime: existing?.entryTime || Date.now(),
        regime: existing?.regime || 'RANGE_HARVEST',
        setupType: existing?.setupType || 'unknown',
        clientOrderId: existing?.clientOrderId || generateClientOrderId(),
      });
      
      totalExposure += value;
    }
    
    state.positions = newPositions;
    state.totalExposure = totalExposure;
    state.reconcileStatus = 'OK';
    state.apiFailures = 0;
    
    // Cancel stale orders
    if (Array.isArray(openOrders)) {
      for (const order of openOrders) {
        const orderAge = Date.now() - new Date(order.create_time_ms || order.create_time * 1000).getTime();
        if (orderAge > 60000) {
          await gateRequest('/spot/orders/' + order.id, 'DELETE', { currency_pair: order.currency_pair });
          await log('info', 'RECONCILE', `Cancelled stale order: ${order.id}`);
        }
      }
    }
    
    return state;
  } catch (err) {
    state.apiFailures++;
    state.reconcileStatus = state.apiFailures >= CONFIG.MAX_API_FAILURES ? 'ERROR' : 'REPAIRING';
    await log('error', 'RECONCILE', `Failed: ${err instanceof Error ? err.message : 'Unknown'}`);
    return state;
  }
}

// ===================== MODULE 10: PROFIT EXTRACTION =====================
interface ExitAction {
  symbol: string;
  currency: string;
  amount: number;
  price: number;
  reason: string;
  pnlPercent: number;
  clientOrderId: string;
}

function determineExits(positions: Position[], markets: Map<string, MarketData>): ExitAction[] {
  const exits: ExitAction[] = [];
  
  for (const pos of positions) {
    if (pos.state !== 'OPEN') continue;
    
    const market = markets.get(pos.symbol);
    const currentPrice = market?.last || pos.currentPrice;
    const pnlPercent = (currentPrice - pos.entryPrice) / pos.entryPrice;
    
    // PANIC exit
    if (market?.regime === 'PANIC_LIQUIDITY_EVENT') {
      exits.push({
        symbol: pos.symbol,
        currency: pos.currency,
        amount: pos.amount,
        price: currentPrice,
        reason: 'PANIC_EXIT',
        pnlPercent,
        clientOrderId: generateClientOrderId(),
      });
      continue;
    }
    
    // Hard stop
    if (currentPrice <= pos.stopLoss) {
      exits.push({
        symbol: pos.symbol,
        currency: pos.currency,
        amount: pos.amount,
        price: currentPrice,
        reason: 'STOP_LOSS',
        pnlPercent,
        clientOrderId: generateClientOrderId(),
      });
      continue;
    }
    
    // Trailing stop
    if (pos.trailingActivated && pos.trailingStop && currentPrice <= pos.trailingStop) {
      exits.push({
        symbol: pos.symbol,
        currency: pos.currency,
        amount: pos.amount,
        price: currentPrice,
        reason: 'TRAILING_STOP',
        pnlPercent,
        clientOrderId: generateClientOrderId(),
      });
      continue;
    }
    
    // TP1
    if (!pos.tp1Hit && pnlPercent >= CONFIG.TP1_PERCENT) {
      exits.push({
        symbol: pos.symbol,
        currency: pos.currency,
        amount: pos.originalAmount * CONFIG.TP1_SIZE,
        price: currentPrice,
        reason: 'TP1',
        pnlPercent,
        clientOrderId: generateClientOrderId(),
      });
    }
    
    // TP2
    if (!pos.tp2Hit && pos.tp1Hit && pnlPercent >= CONFIG.TP2_PERCENT) {
      exits.push({
        symbol: pos.symbol,
        currency: pos.currency,
        amount: pos.originalAmount * CONFIG.TP2_SIZE,
        price: currentPrice,
        reason: 'TP2',
        pnlPercent,
        clientOrderId: generateClientOrderId(),
      });
    }
  }
  
  return exits;
}

// ===================== MODULE 13: ERROR CLASSIFICATION =====================
function classifyLoss(exit: ExitAction, market?: MarketData): LossReason {
  if (exit.reason === 'STOP_LOSS') {
    if (market && market.last > exit.price * 1.02) return 'LIQUIDITY_TRAP';
    if (market?.regime === 'PANIC_LIQUIDITY_EVENT') return 'TREND_REVERSAL';
  }
  if (market && market.change24h > 15) return 'ENTRY_TOO_EARLY';
  if (exit.reason.includes('BREAKOUT') && exit.pnlPercent < -0.01) return 'BREAKOUT_FAKEOUT';
  return 'UNKNOWN';
}

// ===================== MODULE 14: AUTO-PRUNING =====================
async function getPerformanceByPair(): Promise<Map<string, { pnl: number; trades: number }>> {
  const { data: trades } = await supabase
    .from('trade_history')
    .select('*')
    .gte('executed_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
  
  const perfMap = new Map<string, { pnl: number; trades: number }>();
  
  if (trades) {
    for (const trade of trades) {
      const pair = trade.symbol.replace('/', '_');
      const existing = perfMap.get(pair) || { pnl: 0, trades: 0 };
      existing.pnl += trade.actual_pnl || 0;
      existing.trades++;
      perfMap.set(pair, existing);
    }
  }
  
  return perfMap;
}

function identifyPairsToDisable(perfMap: Map<string, { pnl: number; trades: number }>): Set<string> {
  const pairs = Array.from(perfMap.entries())
    .filter(([_, data]) => data.trades >= 3)
    .sort((a, b) => a[1].pnl - b[1].pnl);
  
  const disableCount = Math.floor(pairs.length * CONFIG.PRUNE_BOTTOM_PERCENT);
  const disabled = new Set<string>();
  
  for (let i = 0; i < disableCount; i++) {
    if (pairs[i] && pairs[i][1].pnl < 0) {
      disabled.add(pairs[i][0]);
    }
  }
  
  return disabled;
}

// ===================== MAIN CYCLE =====================
async function runEliteCycle(): Promise<{
  decisions: TradeDecision[];
  scanned: number;
  entries: number;
  exits: number;
  pnl: number;
  balance: number;
  systemState: SystemState;
  regime: MarketRegime;
  reconcileStatus: string;
}> {
  const cycleStart = Date.now();
  const decisions: TradeDecision[] = [];
  
  // Get tickers
  const tickers = await gateRequest('/spot/tickers');
  
  // Initialize state
  const dbState = await getDBState();
  const perfMap = await getPerformanceByPair();
  const disabledPairs = identifyPairsToDisable(perfMap);
  
  // Detect high volatility
  const avgVol = tickers.reduce((s: number, t: any) => {
    const h = parseFloat(t.high_24h), l = parseFloat(t.low_24h), last = parseFloat(t.last);
    return s + ((h - l) / last) * 100;
  }, 0) / tickers.length;
  const highVol = avgVol > 5;
  
  // Build whitelist
  const whitelist = buildWhitelist(tickers, highVol, disabledPairs);
  
  // Scan markets
  const markets = await scanMarkets(whitelist, tickers);
  const marketMap = new Map(markets.map(m => [m.pair, m]));
  
  // Determine dominant regime
  const regimeCounts: Record<MarketRegime, number> = {
    'TREND_CONTINUATION': 0, 'BREAKOUT_EXPANSION': 0, 'RANGE_HARVEST': 0,
    'DISTRIBUTION_EXHAUSTION': 0, 'PANIC_LIQUIDITY_EVENT': 0,
  };
  markets.forEach(m => regimeCounts[m.regime]++);
  const dominantRegime = Object.entries(regimeCounts).sort((a, b) => b[1] - a[1])[0][0] as MarketRegime;
  
  // Get day key for daily P&L
  const dayKey = getJerusalemDayKey();
  
  // Build engine state
  let state: EngineState = {
    systemState: 'NORMAL',
    regime: dominantRegime,
    consecutiveLosses: 0,
    dailyPnL: 0,
    dailyPnLPercent: 0,
    dayStartBalance: dbState?.current_balance || 0,
    currentBalance: 0,
    totalExposure: 0,
    positions: [],
    whitelistedPairs: whitelist,
    lastWhitelistUpdate: Date.now(),
    apiFailures: 0,
    reconcileStatus: 'OK',
    lastTradeTime: Date.now(),
    capitalIdleSince: Date.now(),
    disabledPairs,
    errorCounts: new Map(),
  };
  
  // Reconcile with Gate.io
  state = await reconcileState(state, tickers);
  
  // Calculate daily P&L
  const totalValue = state.currentBalance + state.totalExposure;
  state.dailyPnL = totalValue - state.dayStartBalance;
  state.dailyPnLPercent = state.dayStartBalance > 0 ? state.dailyPnL / state.dayStartBalance : 0;
  
  // Determine system state
  if (state.reconcileStatus === 'ERROR') {
    state.systemState = 'HALT';
  } else if (state.dailyPnLPercent <= -CONFIG.DAILY_DD_HALT) {
    state.systemState = 'HALT';
  } else if (state.dailyPnLPercent <= -CONFIG.DAILY_DD_DEFENSE || state.consecutiveLosses >= CONFIG.CONSECUTIVE_LOSS_THRESHOLD) {
    state.systemState = 'DEFENSE';
  } else if (dominantRegime === 'PANIC_LIQUIDITY_EVENT') {
    state.systemState = 'DEFENSE';
  } else if (state.dailyPnLPercent > 0.02 && dominantRegime === 'TREND_CONTINUATION') {
    state.systemState = 'TURBO';
  }
  
  await log('info', 'ENGINE', `${state.systemState} | ${dominantRegime} | Balance: $${state.currentBalance.toFixed(2)} | Exposure: $${state.totalExposure.toFixed(2)} | Daily: ${(state.dailyPnLPercent * 100).toFixed(2)}%`);
  
  // HALT - no trading
  if (state.systemState === 'HALT') {
    await log('error', 'ENGINE', '🛑 HALTED');
    return {
      decisions: [{ action: 'HALT', pair: '', regime: dominantRegime, signal_score: 0, validation_reason: 'System halted', order_type: 'LIMIT_MAKER', size: 0, size_percent: 0, hard_stop_loss: 0, trailing_activation: 0, trailing_distance: 0, partial_tp_levels: [], exposure_per_asset: 0, exposure_total: state.totalExposure, system_state: 'HALT', reconcile_status: state.reconcileStatus }],
      scanned: markets.length, entries: 0, exits: 0, pnl: 0, balance: totalValue, systemState: 'HALT', regime: dominantRegime, reconcileStatus: state.reconcileStatus,
    };
  }
  
  // EXITS
  const exitActions = determineExits(state.positions, marketMap);
  let totalExitPnL = 0;
  let exitCount = 0;
  
  for (const exit of exitActions) {
    const market = marketMap.get(exit.symbol);
    const result = await executeLimitOrder(exit.symbol, 'sell', exit.amount, market?.bid || exit.price, exit.clientOrderId);
    
    if (result.success) {
      const pnlUSDT = exit.amount * exit.price * exit.pnlPercent;
      totalExitPnL += pnlUSDT;
      exitCount++;
      
      // Classify loss
      if (pnlUSDT < 0) {
        const lossReason = classifyLoss(exit, market);
        const count = (state.errorCounts.get(lossReason) || 0) + 1;
        state.errorCounts.set(lossReason, count);
        
        await log('warn', 'LOSS', `${lossReason}: ${exit.currency} | ${(exit.pnlPercent * 100).toFixed(2)}%`);
        
        decisions.push({
          action: 'EXIT',
          pair: exit.symbol,
          regime: market?.regime || dominantRegime,
          signal_score: 0,
          validation_reason: exit.reason,
          order_type: 'LIMIT_MAKER',
          size: exit.amount,
          size_percent: 0,
          hard_stop_loss: 0,
          trailing_activation: 0,
          trailing_distance: 0,
          partial_tp_levels: [],
          exposure_per_asset: 0,
          exposure_total: state.totalExposure,
          system_state: state.systemState,
          reconcile_status: state.reconcileStatus,
          learning_note: `Loss classified as ${lossReason}. Count: ${count}`,
        });
      }
      
      await supabase.from('trade_history').insert({
        order_id: result.orderId,
        symbol: exit.symbol.replace('_', '/'),
        side: 'sell',
        type: exit.reason,
        amount: exit.amount,
        price: exit.price,
        expected_edge: exit.pnlPercent * 100,
        actual_pnl: pnlUSDT,
        status: 'filled',
        executed_at: new Date().toISOString(),
      });
      
      const emoji = exit.reason.includes('STOP') ? '🔴' : exit.reason.startsWith('TP') ? '🟢' : '🟡';
      await log('info', 'EXIT', `${emoji} ${exit.reason}: ${exit.currency} | ${(exit.pnlPercent * 100).toFixed(2)}% | $${pnlUSDT.toFixed(2)}`);
    }
    
    await new Promise(r => setTimeout(r, 100));
  }
  
  // ENTRIES
  const signals = validateSignals(markets, state);
  let entryCount = 0;
  
  const maxEntries = state.systemState === 'DEFENSE' ? 1 : (state.systemState === 'TURBO' ? 3 : 2);
  
  for (const signal of signals.slice(0, maxEntries)) {
    // 🆕 Check correlation with existing positions
    const correlatedCount = countCorrelatedPositions(signal.pair, state.positions);
    if (correlatedCount >= CONFIG.MAX_CORRELATED_POSITIONS) {
      await log('info', 'ENGINE', `⏭️ Skipping ${signal.currency} - ${correlatedCount} correlated positions`);
      continue;
    }
    
    // Calculate base risk
    const risk = calculateDynamicRisk(state);
    const riskAmount = state.currentBalance * risk;
    let size = Math.min(riskAmount / signal.risk, state.currentBalance * CONFIG.MAX_PER_ASSET);
    
    // 🆕 Apply volatility-adjusted sizing
    const market = marketMap.get(signal.pair);
    if (market) {
      size = calculateVolatilityAdjustedSize(size, market.volatility);
    }
    
    if (size < 5) continue;
    
    const amount = size / signal.price;
    const clientOrderId = generateClientOrderId();
    
    const result = await executeLimitOrder(signal.pair, 'buy', amount, signal.price, clientOrderId);
    
    if (result.success) {
      entryCount++;
      
      await supabase.from('trade_history').insert({
        order_id: result.orderId,
        symbol: signal.pair.replace('_', '/'),
        side: 'buy',
        type: signal.reason,
        amount,
        price: signal.price,
        expected_edge: signal.expectedReturn * 100,
        status: 'filled',
        executed_at: new Date().toISOString(),
      });
      
      decisions.push({
        action: 'ENTER',
        pair: signal.pair,
        regime: signal.regime,
        signal_score: signal.confidence,
        validation_reason: `${signal.reason} | R:R ${signal.rewardRisk.toFixed(1)} | Slippage budget: ${(signal.slippageBudget * 100).toFixed(1)}%`,
        order_type: 'LIMIT_MAKER',
        ttl_ms: CONFIG.LIMIT_TTL_MS,
        size: amount,
        size_percent: risk * 100,
        hard_stop_loss: signal.stopLoss,
        trailing_activation: CONFIG.TRAILING_ACTIVATION,
        trailing_distance: CONFIG.TRAILING_MIN,
        partial_tp_levels: [
          { price: signal.price * (1 + CONFIG.TP1_PERCENT), percent: CONFIG.TP1_PERCENT * 100, amount_percent: CONFIG.TP1_SIZE * 100 },
          { price: signal.price * (1 + CONFIG.TP2_PERCENT), percent: CONFIG.TP2_PERCENT * 100, amount_percent: CONFIG.TP2_SIZE * 100 },
        ],
        exposure_per_asset: size,
        exposure_total: state.totalExposure + size,
        system_state: state.systemState,
        reconcile_status: state.reconcileStatus,
      });
      
      await log('info', 'ENTRY', `🔵 ${signal.reason.toUpperCase()} [${signal.regime}]: ${signal.currency} @ $${signal.price.toFixed(6)} | R:R ${signal.rewardRisk.toFixed(1)} | SL: $${signal.stopLoss.toFixed(6)}`);
    }
    
    await new Promise(r => setTimeout(r, 100));
  }
  
  // Update DB
  const newBalance = state.currentBalance + state.totalExposure + totalExitPnL;
  await updateDBState({
    current_balance: newBalance,
    total_pnl: (dbState?.total_pnl || 0) + totalExitPnL,
    total_trades: (dbState?.total_trades || 0) + entryCount + exitCount,
    successful_trades: (dbState?.successful_trades || 0) + (totalExitPnL > 0 ? 1 : 0),
    total_cycles: (dbState?.total_cycles || 0) + 1,
  });
  
  const cycleDuration = Date.now() - cycleStart;
  await log('info', 'ENGINE', `Cycle ${cycleDuration}ms | E:${entryCount} X:${exitCount} | P&L: $${totalExitPnL.toFixed(2)} | Disabled: ${disabledPairs.size} pairs`);
  
  return {
    decisions,
    scanned: markets.length,
    entries: entryCount,
    exits: exitCount,
    pnl: totalExitPnL,
    balance: newBalance,
    systemState: state.systemState,
    regime: dominantRegime,
    reconcileStatus: state.reconcileStatus,
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
      await log('warn', 'ENGINE', '🛑 STOPPED');
      return new Response(JSON.stringify({ success: true, message: 'Stopped' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    if (command === 'start') {
      await updateDBState({ is_active: true, started_at: new Date().toISOString() });
      await log('info', 'ENGINE', '🚀 STARTED');
    }
    
    if (command === 'status') {
      const perfMap = await getPerformanceByPair();
      const disabled = identifyPairsToDisable(perfMap);
      
      return new Response(JSON.stringify({
        success: true,
        state: dbState,
        disabled_pairs: Array.from(disabled),
        performance: Object.fromEntries(perfMap),
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    if (!dbState?.is_active && command !== 'start') {
      return new Response(JSON.stringify({ success: false, error: 'System stopped' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    const result = await runEliteCycle();
    
    return new Response(JSON.stringify({
      success: true,
      ...result,
      timestamp: Date.now(),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
    
  } catch (error) {
    console.error('[ENGINE] Error:', error);
    await log('error', 'ENGINE', 'Failed', { error: error instanceof Error ? error.message : 'Unknown' });
    
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
