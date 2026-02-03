import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface OptimizeConfig {
  symbol: string;
  strategy: 'spread' | 'momentum' | 'breakout' | 'mean_reversion';
  startDate: string;
  endDate: string;
  initialCapital: number;
  // Parameter ranges to optimize
  positionSizeRange: [number, number, number]; // [min, max, step]
  stopLossRange: [number, number, number];
  takeProfitRange: [number, number, number];
  // Strategy-specific ranges
  periodRange?: [number, number, number];
  thresholdRange?: [number, number, number];
  // Optimization settings
  metric: 'return' | 'sharpe' | 'profit_factor' | 'win_rate';
  maxIterations?: number;
}

interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface BacktestParams {
  positionSize: number;
  stopLoss: number;
  takeProfit: number;
  period?: number;
  threshold?: number;
}

interface OptimizationResult {
  bestParams: BacktestParams;
  bestScore: number;
  metric: string;
  results: {
    params: BacktestParams;
    score: number;
    totalReturn: number;
    winRate: number;
    sharpeRatio: number;
    profitFactor: number;
    maxDrawdown: number;
    trades: number;
  }[];
  totalIterations: number;
  candlesUsed: number;
}

// Fetch historical candlestick data from Gate.io
async function fetchHistoricalData(
  symbol: string,
  startTime: number,
  endTime: number,
  interval: string = '1h'
): Promise<Candle[]> {
  const allCandles: Candle[] = [];
  let currentStart = startTime;
  const batchSize = 1000;
  
  while (currentStart < endTime) {
    const url = `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${symbol}&interval=${interval}&from=${currentStart}&to=${Math.min(currentStart + batchSize * 3600, endTime)}&limit=${batchSize}`;
    
    const response = await fetch(url);
    if (!response.ok) break;
    
    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) break;
    
    for (const candle of data) {
      allCandles.push({
        timestamp: parseInt(candle[0]),
        volume: parseFloat(candle[1]),
        close: parseFloat(candle[2]),
        high: parseFloat(candle[3]),
        low: parseFloat(candle[4]),
        open: parseFloat(candle[5]),
      });
    }
    
    currentStart = allCandles[allCandles.length - 1].timestamp + 3600;
    await new Promise(r => setTimeout(r, 50));
  }
  
  return allCandles.sort((a, b) => a.timestamp - b.timestamp);
}

// Calculate SMA
function sma(data: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
    } else {
      const slice = data.slice(i - period + 1, i + 1);
      result.push(slice.reduce((a, b) => a + b, 0) / period);
    }
  }
  return result;
}

// Calculate Standard Deviation
function stdDev(data: number[], period: number): number[] {
  const means = sma(data, period);
  const result: number[] = [];
  
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
    } else {
      const slice = data.slice(i - period + 1, i + 1);
      const mean = means[i];
      const variance = slice.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period;
      result.push(Math.sqrt(variance));
    }
  }
  return result;
}

// Generate trading signals
function generateSignals(
  candles: Candle[],
  strategy: string,
  params: BacktestParams
): ('buy' | 'sell' | 'hold')[] {
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const signals: ('buy' | 'sell' | 'hold')[] = [];
  
  switch (strategy) {
    case 'spread': {
      const period = params.period || 20;
      const threshold = params.threshold || 0.5;
      const ma = sma(closes, period);
      
      for (let i = 0; i < candles.length; i++) {
        if (isNaN(ma[i])) {
          signals.push('hold');
        } else {
          const deviation = ((closes[i] - ma[i]) / ma[i]) * 100;
          if (deviation < -threshold) signals.push('buy');
          else if (deviation > threshold) signals.push('sell');
          else signals.push('hold');
        }
      }
      break;
    }
    
    case 'momentum': {
      const period = params.period || 14;
      
      for (let i = 0; i < candles.length; i++) {
        if (i < period) {
          signals.push('hold');
        } else {
          const recentHighs = highs.slice(i - period, i);
          const recentLows = lows.slice(i - period, i);
          const highestHigh = Math.max(...recentHighs);
          const lowestLow = Math.min(...recentLows);
          
          if (closes[i] > highestHigh) signals.push('buy');
          else if (closes[i] < lowestLow) signals.push('sell');
          else signals.push('hold');
        }
      }
      break;
    }
    
    case 'breakout': {
      const period = params.period || 20;
      const ma = sma(closes, period);
      const std = stdDev(closes, period);
      
      for (let i = 0; i < candles.length; i++) {
        if (isNaN(ma[i]) || isNaN(std[i])) {
          signals.push('hold');
        } else {
          const multiplier = params.threshold || 2;
          const upperBand = ma[i] + multiplier * std[i];
          const lowerBand = ma[i] - multiplier * std[i];
          
          if (closes[i] < lowerBand) signals.push('buy');
          else if (closes[i] > upperBand) signals.push('sell');
          else signals.push('hold');
        }
      }
      break;
    }
    
    case 'mean_reversion': {
      const period = params.period || 14;
      const gains: number[] = [];
      const losses: number[] = [];
      
      for (let i = 1; i < candles.length; i++) {
        const change = closes[i] - closes[i - 1];
        gains.push(change > 0 ? change : 0);
        losses.push(change < 0 ? -change : 0);
      }
      
      const avgGains = sma(gains, period);
      const avgLosses = sma(losses, period);
      
      signals.push('hold');
      const oversoldThreshold = params.threshold || 30;
      const overboughtThreshold = 100 - oversoldThreshold;
      
      for (let i = 0; i < avgGains.length; i++) {
        if (isNaN(avgGains[i]) || isNaN(avgLosses[i]) || avgLosses[i] === 0) {
          signals.push('hold');
        } else {
          const rs = avgGains[i] / avgLosses[i];
          const rsi = 100 - (100 / (1 + rs));
          
          if (rsi < oversoldThreshold) signals.push('buy');
          else if (rsi > overboughtThreshold) signals.push('sell');
          else signals.push('hold');
        }
      }
      break;
    }
    
    default:
      for (let i = 0; i < candles.length; i++) signals.push('hold');
  }
  
  return signals;
}

// Fast backtest without tracking full history
function runFastBacktest(
  candles: Candle[],
  signals: ('buy' | 'sell' | 'hold')[],
  params: BacktestParams,
  initialCapital: number
): {
  totalReturn: number;
  winRate: number;
  sharpeRatio: number;
  profitFactor: number;
  maxDrawdown: number;
  trades: number;
} {
  let capital = initialCapital;
  let position: { side: 'buy' | 'sell'; entryPrice: number; size: number } | null = null;
  let wins = 0;
  let losses = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let peakEquity = capital;
  let maxDrawdown = 0;
  const returns: number[] = [];
  
  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    const signal = signals[i];
    
    let currentEquity = capital;
    if (position) {
      const unrealizedPnl = position.side === 'buy' 
        ? (candle.close - position.entryPrice) * position.size
        : (position.entryPrice - candle.close) * position.size;
      currentEquity = capital + unrealizedPnl;
    }
    
    if (currentEquity > peakEquity) peakEquity = currentEquity;
    const drawdown = (peakEquity - currentEquity) / peakEquity * 100;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    
    if (position) {
      const pnlPercent = position.side === 'buy'
        ? ((candle.close - position.entryPrice) / position.entryPrice) * 100
        : ((position.entryPrice - candle.close) / position.entryPrice) * 100;
      
      let shouldExit = false;
      if (pnlPercent <= -params.stopLoss) shouldExit = true;
      else if (pnlPercent >= params.takeProfit) shouldExit = true;
      else if ((position.side === 'buy' && signal === 'sell') || 
               (position.side === 'sell' && signal === 'buy')) shouldExit = true;
      
      if (shouldExit) {
        const pnl = position.side === 'buy'
          ? (candle.close - position.entryPrice) * position.size
          : (position.entryPrice - candle.close) * position.size;
        
        if (pnl > 0) {
          wins++;
          grossProfit += pnl;
        } else {
          losses++;
          grossLoss += Math.abs(pnl);
        }
        
        returns.push(pnlPercent);
        capital += pnl;
        position = null;
      }
    }
    
    if (!position && signal !== 'hold') {
      const positionValue = capital * (params.positionSize / 100);
      const size = positionValue / candle.close;
      position = { side: signal, entryPrice: candle.close, size };
    }
  }
  
  // Close open position
  if (position && candles.length > 0) {
    const lastCandle = candles[candles.length - 1];
    const pnl = position.side === 'buy'
      ? (lastCandle.close - position.entryPrice) * position.size
      : (position.entryPrice - lastCandle.close) * position.size;
    
    if (pnl > 0) { wins++; grossProfit += pnl; }
    else { losses++; grossLoss += Math.abs(pnl); }
    
    capital += pnl;
  }
  
  const totalTrades = wins + losses;
  const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const returnStd = returns.length > 1
    ? Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length)
    : 1;
  
  return {
    totalReturn: ((capital - initialCapital) / initialCapital) * 100,
    winRate: totalTrades > 0 ? (wins / totalTrades) * 100 : 0,
    sharpeRatio: returnStd > 0 ? (avgReturn / returnStd) * Math.sqrt(252) : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0,
    maxDrawdown,
    trades: totalTrades,
  };
}

// Generate parameter combinations
function* generateParams(config: OptimizeConfig): Generator<BacktestParams> {
  const [psMin, psMax, psStep] = config.positionSizeRange;
  const [slMin, slMax, slStep] = config.stopLossRange;
  const [tpMin, tpMax, tpStep] = config.takeProfitRange;
  const [periodMin, periodMax, periodStep] = config.periodRange || [14, 14, 1];
  const [threshMin, threshMax, threshStep] = config.thresholdRange || [0.5, 0.5, 0.1];
  
  for (let ps = psMin; ps <= psMax; ps += psStep) {
    for (let sl = slMin; sl <= slMax; sl += slStep) {
      for (let tp = tpMin; tp <= tpMax; tp += tpStep) {
        // Skip if risk/reward is poor (less than 1:1.5)
        if (tp / sl < 1.5) continue;
        
        for (let period = periodMin; period <= periodMax; period += periodStep) {
          for (let thresh = threshMin; thresh <= threshMax; thresh += threshStep) {
            yield {
              positionSize: ps,
              stopLoss: sl,
              takeProfit: tp,
              period,
              threshold: thresh,
            };
          }
        }
      }
    }
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const config: OptimizeConfig = await req.json();
    console.log(`Starting optimization for ${config.symbol} with ${config.strategy} strategy`);
    
    const startTime = Math.floor(new Date(config.startDate).getTime() / 1000);
    const endTime = Math.floor(new Date(config.endDate).getTime() / 1000);
    
    // Fetch historical data once
    console.log('Fetching historical data...');
    const candles = await fetchHistoricalData(config.symbol, startTime, endTime);
    
    if (candles.length < 100) {
      return new Response(
        JSON.stringify({ error: 'Insufficient data for optimization (min 100 candles)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log(`Fetched ${candles.length} candles, starting optimization...`);
    
    const results: OptimizationResult['results'] = [];
    let bestScore = -Infinity;
    let bestParams: BacktestParams = { positionSize: 10, stopLoss: 2, takeProfit: 4 };
    const maxIterations = config.maxIterations || 500;
    let iterations = 0;
    
    for (const params of generateParams(config)) {
      if (iterations >= maxIterations) break;
      iterations++;
      
      const signals = generateSignals(candles, config.strategy, params);
      const result = runFastBacktest(candles, signals, params, config.initialCapital);
      
      // Skip if no trades or poor metrics
      if (result.trades < 5) continue;
      
      let score: number;
      switch (config.metric) {
        case 'return': score = result.totalReturn; break;
        case 'sharpe': score = result.sharpeRatio; break;
        case 'profit_factor': score = result.profitFactor; break;
        case 'win_rate': score = result.winRate; break;
        default: score = result.totalReturn;
      }
      
      results.push({ params, score, ...result });
      
      if (score > bestScore) {
        bestScore = score;
        bestParams = params;
      }
      
      // Log progress every 50 iterations
      if (iterations % 50 === 0) {
        console.log(`Iteration ${iterations}: best ${config.metric} = ${bestScore.toFixed(2)}`);
      }
    }
    
    // Sort results by score
    results.sort((a, b) => b.score - a.score);
    
    console.log(`Optimization complete: ${iterations} iterations, best ${config.metric} = ${bestScore.toFixed(2)}`);
    
    const response: OptimizationResult = {
      bestParams,
      bestScore,
      metric: config.metric,
      results: results.slice(0, 20), // Top 20 results
      totalIterations: iterations,
      candlesUsed: candles.length,
    };
    
    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('Optimization error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
