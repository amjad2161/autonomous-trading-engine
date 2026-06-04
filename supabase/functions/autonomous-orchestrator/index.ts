import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { gateSign } from "../_shared/gate-sign.ts";
import { guardSpotOrder, getRiskCaps, getCanaryFraction } from "../_shared/safety.ts";
import { resolveConfig, type MarketRegime as AdaptiveRegime } from "../_shared/profiles.ts";
import { evaluateInvariants, invariantReason } from "../_shared/invariants.ts";
import { riskPosture, postureBlocksEntries } from "../_shared/health.ts";
import { computeKpis, alertDecisions } from "../_shared/metrics.ts";
import { normalizeAmount, normalizePrice } from "../_shared/market-data.ts";
import { fetchSpotPairRules, meetsMinimums, type SpotPair } from "../_shared/gate-rules.ts";
import { prioritizeBy, stagedExitPlan, type ActionKind } from "../_shared/execution.ts";
import { feeBufferOk } from "../_shared/treasury.ts";
import { correlationGate } from "../_shared/correlation.ts";
import { varGate } from "../_shared/portfolio-risk.ts";
import { evaluateEntryGate } from "../_shared/entry-gate.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  // Module 1: Risk Governor - ULTRA AGGRESSIVE for more trades
  BASE_RISK: 0.025,       // 2.5% per trade (INCREASED)
  MIN_RISK: 0.015,        // 1.5% minimum
  MAX_RISK: 0.040,        // 4% max
  MAX_POSITIONS: 5,       // More positions allowed
  MAX_PER_ASSET: 0.15,    // 15% max per asset
  MAX_EXPOSURE: 0.60,     // 60% total exposure
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
  // SAFETY GATE: honour DRY_RUN / kill switch / risk caps for live order POSTs.
  if (method === 'POST' && endpoint.includes('/spot/orders') && body) {
    const __sim = guardSpotOrder('autonomous-orchestrator', body as Record<string, unknown>);
    if (__sim) return __sim;
  }
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
    const signature = await gateSign(method, url, queryString, payloadString, timestamp, GATE_API_SECRET);

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
    // MERGE the `settings` JSON onto the freshly-read row instead of overwriting
    // it. Callers pass only the keys they intend to change; a blind overwrite from
    // a stale in-memory snapshot would clobber keys another writer set in between
    // (e.g. lastWsTickMs) and could even drop dayStartBalance — silently resetting
    // the daily-loss breaker (INV-02). This is a read-merge-write, not atomic, but
    // it stops the snapshot from reverting concurrent settings keys.
    const merged: Record<string, unknown> = { ...updates };
    if (updates.settings && typeof updates.settings === 'object') {
      merged.settings = {
        ...((data.settings ?? {}) as Record<string, unknown>),
        ...(updates.settings as Record<string, unknown>),
      };
    }
    await supabase.from('trading_system_state').update({
      ...merged,
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
    
    // 🔥 ULTRA AGGRESSIVE SIGNAL DETECTION
    switch (market.regime) {
      case 'TREND_CONTINUATION':
        if (market.change24h > 0.5 && market.change24h < 30) {
          reason = 'trend_ride';
          expectedReturn = 0.03;
          confidence = 65 + market.trendAlignment * 20;
        }
        break;
        
      case 'BREAKOUT_EXPANSION':
        const distFromHigh = (market.high24h - market.last) / market.high24h;
        if (distFromHigh < 0.05 && market.volume > 200000) {
          reason = 'breakout_chase';
          expectedReturn = 0.03;
          confidence = 65 + (market.volume / 1500000) * 15;
        }
        break;
        
      case 'RANGE_HARVEST':
        const distFromLow = (market.last - market.low24h) / market.low24h;
        // ULTRA AGGRESSIVE: Almost any range setup
        if (distFromLow < 0.10 && market.change24h > -15) {
          reason = 'bounce_scalp';
          expectedReturn = 0.02;
          confidence = 60 + (market.spread < 0.30 ? 10 : 0);
        }
        // Micro momentum - very low bar
        else if (market.change24h > 0 && market.volume > 100000) {
          reason = 'micro_momentum';
          expectedReturn = 0.018;
          confidence = 58 + market.volumeImpulse * 10;
        }
        // 🔥 NEW: Any positive momentum
        else if (market.volume > 50000 && market.score > 40) {
          reason = 'volume_play';
          expectedReturn = 0.015;
          confidence = 55;
        }
        break;
        
      case 'DISTRIBUTION_EXHAUSTION':
        if (market.change24h < 0 && market.change24h > -15 && market.volume > 200000) {
          reason = 'dip_buy';
          expectedReturn = 0.025;
          confidence = 55;
        }
        break;
    }
    
    if (!reason) continue;
    
    const fees = 0.004;
    const netReturn = expectedReturn - fees;
    const netRR = netReturn / stopPercent;
    
    // 🔥 ULTRA AGGRESSIVE: Almost no R:R check - just need positive net return
    if (netReturn < 0.005) continue; // Minimum 0.5% expected profit
    
    // 🔥 ULTRA AGGRESSIVE: No slippage filter
    // const slippageBudget = (fees + market.spread / 100) / expectedReturn;
    // if (slippageBudget > 0.35) continue;
    
    // 🔥 ULTRA AGGRESSIVE: Only skip extreme pumps
    if (market.change24h > 50) continue;
    
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
      slippageBudget: 0,
      signal_id: generateSignalId(),
    });
  }
  
  signals.sort((a, b) => (b.confidence * b.rewardRisk) - (a.confidence * a.rewardRisk));
  
  // 🔥 DEBUG: Log signal count
  console.log(`[SIGNALS] Generated ${signals.length} signals from ${eligibleMarkets.length} markets`);
  if (signals.length > 0) {
    console.log(`[SIGNALS] Top: ${signals[0].pair} (${signals[0].reason}) conf:${signals[0].confidence.toFixed(0)}`);
  }
  
  return signals;
}

// ===================== MODULE 6: EXECUTION =====================
function generateClientOrderId(): string {
  return `t-lov_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

// Per-symbol trading rules (precision/minimums) cached from Gate.io, refreshed
// hourly. Prevents orders being rejected on amount/price format or below-minimum.
let __symbolRules: Record<string, SpotPair> | null = null;
let __symbolRulesAt = 0;
async function getSymbolRules(): Promise<Record<string, SpotPair>> {
  if (__symbolRules && Date.now() - __symbolRulesAt < 3_600_000) return __symbolRules;
  try {
    __symbolRules = await fetchSpotPairRules();
    __symbolRulesAt = Date.now();
  } catch (_e) {
    __symbolRules = __symbolRules ?? {};
  }
  return __symbolRules;
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
    // Maker-first entries (spec #57): opt-in via MAKER_FIRST_ENTRIES=1 -> post-only
    // (poc) for lower fees; may not fill. Default stays IOC (behaviour unchanged).
    const tif = (side === 'buy' && Deno.env.get('MAKER_FIRST_ENTRIES') === '1') ? 'poc' : 'ioc';

    // Per-symbol precision + minimum check (spec #21/#45). Falls back to fixed
    // formatting if exchange rules are unavailable. Avoids order rejections.
    let amountStr = amount.toFixed(6);
    let priceStr = price.toFixed(8);
    try {
      const r = (await getSymbolRules())[pair];
      if (r) {
        const nAmt = normalizeAmount(amount, r.amountPrecision);
        const nPrice = normalizePrice(price, r.pricePrecision);
        if (!meetsMinimums(nAmt * nPrice, nAmt, r)) {
          return { success: false, error: `below exchange minimum for ${pair}` };
        }
        amountStr = String(nAmt);
        priceStr = String(nPrice);
      }
    } catch (_e) { /* fall back to fixed format */ }

    const order = await gateRequest('/spot/orders', 'POST', {}, {
      currency_pair: pair,
      side,
      amount: amountStr,
      price: priceStr,
      type: 'limit',
      time_in_force: tif,
      text: clientOrderId,
    });

    // Event sourcing for deterministic replay (best-effort; never breaks the order).
    try {
      await supabase.from('event_log').insert({
        type: 'order_sent',
        symbol: pair,
        payload: { side, amount, price, tif, clientOrderId, orderId: order?.id ?? null, dryRun: order?.dryRun ?? false },
      });
    } catch (_e) { /* replay logging is best-effort */ }

    if (order.id) {
      return { success: true, orderId: order.id, filled: parseFloat(order.filled_total || order.amount) };
    }
    return { success: false, error: JSON.stringify(order) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown' };
  }
}

// Market-sell fallback for urgent exits whose limit didn't fill (#59/#60).
// Still safety-gated (DRY_RUN simulates). Normalizes amount to symbol precision.
async function executeMarketSell(
  pair: string,
  amount: number,
  clientOrderId: string,
): Promise<{ success: boolean; orderId?: string; filled?: number; error?: string }> {
  try {
    let amountStr = amount.toFixed(6);
    try {
      const r = (await getSymbolRules())[pair];
      if (r) amountStr = String(normalizeAmount(amount, r.amountPrecision));
    } catch (_e) { /* fall back to fixed format */ }
    const order = await gateRequest('/spot/orders', 'POST', {}, {
      currency_pair: pair,
      side: 'sell',
      amount: amountStr,
      type: 'market',
      time_in_force: 'ioc',
      text: clientOrderId,
    });
    try {
      await supabase.from('event_log').insert({
        type: 'order_sent',
        symbol: pair,
        payload: { side: 'sell', amount, type: 'market', orderId: order?.id ?? null, dryRun: order?.dryRun ?? false },
      });
    } catch (_e) { /* best-effort */ }
    if (order.id) {
      return { success: true, orderId: order.id, filled: parseFloat(order.filled_total || order.amount || '0') };
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
  // Persisted day-start anchor (resets only at the Jerusalem day boundary).
  // Using dbState.current_balance was WRONG — it's overwritten every cycle, so
  // "daily" P&L collapsed to an inter-cycle delta (~0) and the daily-loss
  // circuit breaker / INV-02 never fired. We anchor to the day's first equity.
  const __settings = (dbState?.settings ?? {}) as Record<string, unknown>;
  const __storedAnchor = Number(__settings.dayStartBalance);
  const __sameDayAnchor = __settings.dayKey === dayKey && Number.isFinite(__storedAnchor) && __storedAnchor > 0;

  // Build engine state
  let state: EngineState = {
    systemState: 'NORMAL',
    regime: dominantRegime,
    consecutiveLosses: 0,
    dailyPnL: 0,
    dailyPnLPercent: 0,
    dayStartBalance: __sameDayAnchor ? __storedAnchor : 0, // 0 = (re)anchor after reconcile
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
  
  // Calculate daily P&L against the day's start anchor.
  const totalValue = state.currentBalance + state.totalExposure;
  if (!(state.dayStartBalance > 0)) {
    // First cycle of the (Jerusalem) day: anchor to current equity and persist
    // it so every later cycle measures real intra-day P&L against the same base.
    state.dayStartBalance = totalValue;
    // Pass only the keys we own; updateDBState merges them onto the fresh row.
    await updateDBState({ settings: { dayKey, dayStartBalance: totalValue } });
  }
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
  
  // EXITS — ordered worst-first (panic/stop before take-profit) via the shared
  // priority queue, so protective exits always execute ahead of profit-taking.
  const exitActions = prioritizeBy(
    determineExits(state.positions, marketMap),
    (e) => {
      const r = String((e as { reason?: string }).reason || '').toUpperCase();
      return (r.includes('PANIC') ? 'PANIC' : r.includes('STOP') ? 'STOP_LOSS' : 'TAKE_PROFIT') as ActionKind;
    },
    (e) => Math.abs((e as { pnlPercent?: number }).pnlPercent || 0),
  );
  let totalExitPnL = 0;
  let exitCount = 0;
  
  for (const exit of exitActions) {
    const market = marketMap.get(exit.symbol);
    let result = await executeLimitOrder(exit.symbol, 'sell', exit.amount, market?.bid || exit.price, exit.clientOrderId);

    // Staged exit: a protective (stop/panic) exit that didn't fill on IOC falls
    // back to a MARKET sell so we never get stuck in a losing position (#59/#60).
    const __exitReason = String((exit as { reason?: string }).reason || '').toUpperCase();
    const __urgent = __exitReason.includes('STOP') || __exitReason.includes('PANIC');
    if (__urgent && (!result.success || !((result.filled ?? 0) > 0))) {
      const __plan = stagedExitPlan(__exitReason.includes('PANIC') ? 'panic' : 'elevated');
      if (__plan.some((s) => s.type === 'MARKET')) {
        await log('warn', 'EXIT', `staged exit → MARKET fallback: ${exit.symbol} (${__exitReason})`);
        const __mkt = await executeMarketSell(exit.symbol, exit.amount, generateClientOrderId());
        if (__mkt.success) result = __mkt;
      }
    }

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

  // ===== AUTOPILOT MODE: resolve the active trading profile (the aggression knob) =====
  // Controls aggression only; the hard safety floor (caps/kill/DRY_RUN) is enforced
  // separately at the order site. Default autopilot=false → no new entries until the
  // user turns Autopilot ON in the dashboard (two-level control with is_active).
  const __cfgState = await getDBState();
  const __regime: AdaptiveRegime = {
    // Real aggregates from this cycle (not hardcoded) so AUTO truly adapts.
    volatilityPct: Number.isFinite(avgVol) ? avgVol : 2,
    trendStrength: dominantRegime === 'TREND_CONTINUATION' ? 0.6
      : dominantRegime === 'BREAKOUT_EXPANSION' ? 0.4
      : dominantRegime === 'PANIC_LIQUIDITY_EVENT' ? -0.7
      : dominantRegime === 'DISTRIBUTION_EXHAUSTION' ? -0.3
      : 0,
    balanceUsdt: state.currentBalance,
    drawdownPct: state.dailyPnLPercent < 0 ? -state.dailyPnLPercent * 100 : 0,
  };
  const cfg = resolveConfig((__cfgState?.settings ?? {}) as Record<string, unknown>, __regime);
  if (!cfg.autopilot) {
    await log('info', 'ENGINE', `⏸️ Autopilot OFF (mode ${cfg.profile}) — skipping new entries`);
  } else {
    await log('info', 'ENGINE', `🎚️ Mode ${cfg.profile}: maxTrade $${cfg.maxTradeUsdt}, edge≥${cfg.minEdgePct}% — ${cfg.rationale}`);
  }

  // ===== Spec v1.1 Layers 2&3: formal invariants + real-time risk posture =====
  // Pure governance gate. Exits always allowed; only NEW entries are blocked.
  const __caps = getRiskCaps();
  const __openPos = Array.isArray((state as unknown as { positions?: unknown[] }).positions)
    ? (state as unknown as { positions: unknown[] }).positions.length
    : undefined;
  // INV-01 input: market-data freshness from the local WS telemetry heartbeat.
  // Undefined (not monitored) when no heartbeat has arrived yet, so it can't fire.
  const __lastWsTick = Number((__cfgState?.settings as Record<string, unknown> | undefined)?.lastWsTickMs ?? 0);
  const __wsStaleMs = Number(Deno.env.get('WS_STALE_MS') ?? 5000);
  const __wsStale = __lastWsTick > 0 ? (Date.now() - __lastWsTick > __wsStaleMs) : undefined;
  const __inv = evaluateInvariants({
    wsStale: __wsStale,
    // True daily P&L in USDT (includes open-position value) — not balance*pct,
    // which excludes deployed capital and could miss a real loss past the cap.
    dailyPnlUsdt: state.dailyPnL,
    dailyLossCapUsdt: __caps.maxDailyLossUsdt,
    openPositions: __openPos,
    // The HARD env cap floors the profile's looser value — an aggressive mode
    // may not relax what is documented as a hard invariant.
    maxOpenPositions: Math.min(cfg.maxOpenPositions, __caps.maxOpenPositions),
  });
  const __posture = riskPosture({
    dailyDrawdownPct: __regime.drawdownPct,
    errorRatePerMin: (state as unknown as { apiFailures?: number }).apiFailures,
  });
  if (__inv.blockEntries) {
    await log('warn', 'RISK', `🛑 Invariant breach — entries blocked: ${invariantReason(__inv)}`);
  }
  if (postureBlocksEntries(__posture.posture)) {
    await log('warn', 'RISK', `🛑 Risk posture ${__posture.posture} — entries blocked: ${__posture.reasons.join(', ')}`);
  }
  // Fee-buffer gate (#4): keep enough USDT for fees; block new entries if breached.
  const __feeBufferUsdt = Number(Deno.env.get('FEE_BUFFER_USDT') ?? 5);
  const __belowFeeBuffer = !feeBufferOk(state.currentBalance, __feeBufferUsdt);
  if (__belowFeeBuffer) {
    await log('warn', 'RISK', `🛑 USDT $${state.currentBalance.toFixed(2)} below fee buffer $${__feeBufferUsdt} — entries blocked`);
  }
  // Consolidated, unit-tested entry decision (behaviour-preserving).
  const __gate = evaluateEntryGate({
    autopilot: cfg.autopilot,
    invariantsBlocked: __inv.blockEntries,
    postureBlocks: postureBlocksEntries(__posture.posture),
    belowFeeBuffer: __belowFeeBuffer,
  });
  const __entriesBlocked = !__gate.allowed;

  const maxEntries = state.systemState === 'DEFENSE' ? 1 : (state.systemState === 'TURBO' ? 3 : 2);

  for (const signal of signals.slice(0, maxEntries)) {
    // AUTOPILOT + governance gate: no new entries when blocked (exits still run).
    if (__entriesBlocked) break;

    // 🔥 ULTRA AGGRESSIVE: Disabled correlation check to allow more entries
    // const correlatedCount = countCorrelatedPositions(signal.pair, state.positions);
    // if (correlatedCount >= CONFIG.MAX_CORRELATED_POSITIONS) continue;

    // Calculate base risk. Reserve Vault (#5): hold RESERVE_PCT of equity out of
    // trading (default 0 = unchanged) — size off the tradable balance only.
    const risk = calculateDynamicRisk(state);
    const __reservePct = Math.min(90, Math.max(0, Number(Deno.env.get('RESERVE_PCT') ?? 0)));
    // Profit-Lock Vault (#6): hold back PROFIT_LOCK_PCT of the day's profit from
    // trading so gains are protected (default 0 = off).
    const __profitLockPct = Math.min(100, Math.max(0, Number(Deno.env.get('PROFIT_LOCK_PCT') ?? 0)));
    const __dailyProfit = Math.max(0, (state.currentBalance + state.totalExposure) - state.dayStartBalance);
    const __locked = __dailyProfit * (__profitLockPct / 100);
    const __tradable = Math.max(0, state.currentBalance - __locked) * (1 - __reservePct / 100);
    const riskAmount = __tradable * risk;
    let size = Math.min(riskAmount / signal.risk, __tradable * CONFIG.MAX_PER_ASSET);

    // 🆕 Apply volatility-adjusted sizing
    const market = marketMap.get(signal.pair);
    if (market) {
      size = calculateVolatilityAdjustedSize(size, market.volatility);
    }

    // AUTOPILOT profile: cap order notional by the selected mode's maxTradeUsdt.
    size = Math.min(size, cfg.maxTradeUsdt);

    // CANARY: during the Paper→Live transition, cap to a fraction of equity.
    size = Math.min(size, state.currentBalance * getCanaryFraction());
    
    console.log(`[ENTRY] ${signal.pair} | Balance: $${state.currentBalance.toFixed(2)} | Risk: ${(risk*100).toFixed(1)}% | Size: $${size.toFixed(2)}`);
    
    // Reject non-finite (NaN from a malformed ticker field) AND too-small sizes.
    // NOTE: `size < 3` alone does NOT catch NaN (NaN < 3 is false), which would
    // otherwise send amount "NaN" to the exchange. `!(size >= 3)` catches both.
    if (!(size >= 3)) { // min $3; also blocks NaN / non-finite
      await log('info', 'ENGINE', `⚠️ Size invalid/too small: ${signal.pair} $${Number(size).toFixed(2)} (< $3 or NaN)`);
      continue;
    }
    
    // Correlation cap (#8/#53): don't stack the same risk — block if this entry
    // would push the correlated group's exposure past its cap.
    const __grpCap = Number(Deno.env.get('MAX_GROUP_EXPOSURE_USDT') ?? cfg.maxTradeUsdt * 3);
    const __corr = correlationGate(
      state.positions.map((p) => ({ symbol: p.symbol, notionalUsdt: p.value })),
      signal.pair, size, __grpCap,
    );
    if (!__corr.ok) {
      await log('info', 'RISK', `correlation cap: ${signal.pair} (${__corr.group}) $${__corr.current.toFixed(2)}+$${size.toFixed(2)} > $${__corr.cap} — skip`);
      continue;
    }

    // Portfolio VaR guard (#69): block if aggregate worst-case risk would exceed
    // MAX_PORTFOLIO_VAR_USDT (default unset = off).
    const __varCap = Number(Deno.env.get('MAX_PORTFOLIO_VAR_USDT') ?? Infinity);
    if (Number.isFinite(__varCap)) {
      const __vg = varGate(
        state.positions.map((p) => ({ notionalUsdt: p.value, volatilityPct: marketMap.get(p.symbol)?.volatility ?? 2 })),
        { notionalUsdt: size, volatilityPct: market?.volatility ?? 2 },
        __varCap,
      );
      if (!__vg.ok) {
        await log('info', 'RISK', `portfolio VaR $${__vg.varUsdt.toFixed(2)} > cap $${__vg.cap} — skip ${signal.pair}`);
        continue;
      }
    }

    // Liquidity-vacuum / spread guard (#74): skip entries when the market's
    // spread is wider than MAX_ENTRY_SPREAD (same unit as market.spread; default
    // off). Thin/illiquid books -> avoid.
    const __maxSpread = Number(Deno.env.get('MAX_ENTRY_SPREAD') ?? Infinity);
    if (Number.isFinite(__maxSpread) && market && market.spread > __maxSpread) {
      await log('info', 'RISK', `spread/liquidity guard: ${signal.pair} spread ${market.spread} > ${__maxSpread} — skip`);
      continue;
    }

    const amount = size / signal.price;
    const clientOrderId = generateClientOrderId();
    
    await log('info', 'ENGINE', `🎯 Executing: ${signal.pair} | $${size.toFixed(2)} | ${signal.reason}`);
    const result = await executeLimitOrder(signal.pair, 'buy', amount, signal.price, clientOrderId);
    
    console.log(`[EXECUTE_RESULT] ${signal.pair} | success: ${result.success} | orderId: ${result.orderId || 'N/A'} | error: ${result.error || 'N/A'}`);
    
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

      // Observability (read-only): KPIs + alerts from recent trade history.
      const { data: recent } = await supabase
        .from('trade_history')
        .select('actual_pnl,status')
        .order('executed_at', { ascending: false })
        .limit(200);
      // Only CLOSED trades carry a realized P&L. Entry rows have a null
      // actual_pnl; counting them as 0-P&L trades skews win rate / expectancy.
      const rows = (recent ?? [])
        .filter((t: { actual_pnl: number | null }) => t.actual_pnl !== null && t.actual_pnl !== undefined)
        .map((t: { actual_pnl: number | null; status: string | null }) => ({
          pnlUsdt: Number(t.actual_pnl),
          filled: t.status !== 'failed' && t.status !== 'rejected',
        }));
      const kpis = computeKpis(rows);
      const alerts = alertDecisions(kpis);

      return new Response(JSON.stringify({
        success: true,
        state: dbState,
        disabled_pairs: Array.from(disabled),
        performance: Object.fromEntries(perfMap),
        kpis,
        alerts,
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
