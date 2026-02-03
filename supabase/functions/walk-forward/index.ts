import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface WalkForwardConfig {
  symbol: string;
  strategy: 'spread' | 'momentum' | 'breakout' | 'mean_reversion';
  startDate: string;
  endDate: string;
  initialCapital: number;
  // Walk-forward settings
  windows: number; // Number of walk-forward windows (e.g., 6)
  inSampleRatio: number; // Ratio of in-sample to total window (e.g., 0.7 = 70% train, 30% test)
  // Optimization settings
  metric: 'return' | 'sharpe' | 'profit_factor' | 'win_rate';
}

interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface OptimizedParams {
  positionSize: number;
  stopLoss: number;
  takeProfit: number;
  period: number;
  threshold: number;
}

interface WindowResult {
  windowIndex: number;
  inSampleStart: string;
  inSampleEnd: string;
  outSampleStart: string;
  outSampleEnd: string;
  optimizedParams: OptimizedParams;
  inSampleReturn: number;
  outSampleReturn: number;
  outSampleWinRate: number;
  outSampleTrades: number;
  outSampleSharpe: number;
  outSampleMaxDrawdown: number;
  isProfit: boolean;
}

interface WalkForwardResult {
  symbol: string;
  strategy: string;
  windows: WindowResult[];
  aggregatedMetrics: {
    totalOutSampleReturn: number;
    averageOutSampleReturn: number;
    outSampleWinRate: number;
    profitableWindows: number;
    totalWindows: number;
    robustnessScore: number; // Ratio of out-sample vs in-sample performance
    stabilityScore: number; // Consistency of positive returns
    averageSharpe: number;
    maxDrawdown: number;
  };
  recommendation: 'strong' | 'moderate' | 'weak' | 'avoid';
  recommendationReason: string;
}

// Fetch historical candlestick data
async function fetchHistoricalData(
  symbol: string,
  startTime: number,
  endTime: number
): Promise<Candle[]> {
  const allCandles: Candle[] = [];
  let currentStart = startTime;
  const batchSize = 1000;
  
  while (currentStart < endTime) {
    const url = `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${symbol}&interval=1h&from=${currentStart}&to=${Math.min(currentStart + batchSize * 3600, endTime)}&limit=${batchSize}`;
    
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
    if (i < period - 1) result.push(NaN);
    else {
      const slice = data.slice(i - period + 1, i + 1);
      result.push(slice.reduce((a, b) => a + b, 0) / period);
    }
  }
  return result;
}

// Calculate StdDev
function stdDev(data: number[], period: number): number[] {
  const means = sma(data, period);
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) result.push(NaN);
    else {
      const slice = data.slice(i - period + 1, i + 1);
      const variance = slice.reduce((sum, val) => sum + Math.pow(val - means[i], 2), 0) / period;
      result.push(Math.sqrt(variance));
    }
  }
  return result;
}

// Generate trading signals
function generateSignals(
  candles: Candle[],
  strategy: string,
  params: OptimizedParams
): ('buy' | 'sell' | 'hold')[] {
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const signals: ('buy' | 'sell' | 'hold')[] = [];
  
  switch (strategy) {
    case 'spread': {
      const ma = sma(closes, params.period);
      for (let i = 0; i < candles.length; i++) {
        if (isNaN(ma[i])) signals.push('hold');
        else {
          const deviation = ((closes[i] - ma[i]) / ma[i]) * 100;
          if (deviation < -params.threshold) signals.push('buy');
          else if (deviation > params.threshold) signals.push('sell');
          else signals.push('hold');
        }
      }
      break;
    }
    case 'momentum': {
      for (let i = 0; i < candles.length; i++) {
        if (i < params.period) signals.push('hold');
        else {
          const recentHighs = highs.slice(i - params.period, i);
          const recentLows = lows.slice(i - params.period, i);
          if (closes[i] > Math.max(...recentHighs)) signals.push('buy');
          else if (closes[i] < Math.min(...recentLows)) signals.push('sell');
          else signals.push('hold');
        }
      }
      break;
    }
    case 'breakout': {
      const ma = sma(closes, params.period);
      const std = stdDev(closes, params.period);
      for (let i = 0; i < candles.length; i++) {
        if (isNaN(ma[i]) || isNaN(std[i])) signals.push('hold');
        else {
          const upper = ma[i] + params.threshold * std[i];
          const lower = ma[i] - params.threshold * std[i];
          if (closes[i] < lower) signals.push('buy');
          else if (closes[i] > upper) signals.push('sell');
          else signals.push('hold');
        }
      }
      break;
    }
    case 'mean_reversion': {
      const gains: number[] = [];
      const losses: number[] = [];
      for (let i = 1; i < candles.length; i++) {
        const change = closes[i] - closes[i - 1];
        gains.push(change > 0 ? change : 0);
        losses.push(change < 0 ? -change : 0);
      }
      const avgGains = sma(gains, params.period);
      const avgLosses = sma(losses, params.period);
      signals.push('hold');
      for (let i = 0; i < avgGains.length; i++) {
        if (isNaN(avgGains[i]) || isNaN(avgLosses[i]) || avgLosses[i] === 0) signals.push('hold');
        else {
          const rsi = 100 - (100 / (1 + avgGains[i] / avgLosses[i]));
          if (rsi < params.threshold) signals.push('buy');
          else if (rsi > (100 - params.threshold)) signals.push('sell');
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

// Fast backtest
function runBacktest(
  candles: Candle[],
  signals: ('buy' | 'sell' | 'hold')[],
  params: OptimizedParams,
  initialCapital: number
): { totalReturn: number; winRate: number; sharpe: number; maxDrawdown: number; trades: number } {
  let capital = initialCapital;
  let position: { side: 'buy' | 'sell'; entryPrice: number; size: number } | null = null;
  let wins = 0, losses = 0;
  let peakEquity = capital, maxDrawdown = 0;
  const returns: number[] = [];
  
  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    const signal = signals[i];
    
    let currentEquity = capital;
    if (position) {
      const unrealized = position.side === 'buy' 
        ? (candle.close - position.entryPrice) * position.size
        : (position.entryPrice - candle.close) * position.size;
      currentEquity = capital + unrealized;
    }
    
    if (currentEquity > peakEquity) peakEquity = currentEquity;
    const dd = (peakEquity - currentEquity) / peakEquity * 100;
    if (dd > maxDrawdown) maxDrawdown = dd;
    
    if (position) {
      const pnlPercent = position.side === 'buy'
        ? ((candle.close - position.entryPrice) / position.entryPrice) * 100
        : ((position.entryPrice - candle.close) / position.entryPrice) * 100;
      
      let shouldExit = pnlPercent <= -params.stopLoss || pnlPercent >= params.takeProfit ||
        (position.side === 'buy' && signal === 'sell') || (position.side === 'sell' && signal === 'buy');
      
      if (shouldExit) {
        const pnl = position.side === 'buy'
          ? (candle.close - position.entryPrice) * position.size
          : (position.entryPrice - candle.close) * position.size;
        if (pnl > 0) wins++; else losses++;
        returns.push(pnlPercent);
        capital += pnl;
        position = null;
      }
    }
    
    if (!position && signal !== 'hold') {
      const size = (capital * params.positionSize / 100) / candle.close;
      position = { side: signal, entryPrice: candle.close, size };
    }
  }
  
  // Close open position
  if (position && candles.length > 0) {
    const last = candles[candles.length - 1];
    const pnl = position.side === 'buy'
      ? (last.close - position.entryPrice) * position.size
      : (position.entryPrice - last.close) * position.size;
    if (pnl > 0) wins++; else losses++;
    capital += pnl;
  }
  
  const totalTrades = wins + losses;
  const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const std = returns.length > 1
    ? Math.sqrt(returns.reduce((s, r) => s + Math.pow(r - avgReturn, 2), 0) / returns.length)
    : 1;
  
  return {
    totalReturn: ((capital - initialCapital) / initialCapital) * 100,
    winRate: totalTrades > 0 ? (wins / totalTrades) * 100 : 0,
    sharpe: std > 0 ? (avgReturn / std) * Math.sqrt(252) : 0,
    maxDrawdown,
    trades: totalTrades,
  };
}

// Optimize parameters on a data slice
function optimizeParams(
  candles: Candle[],
  strategy: string,
  initialCapital: number,
  metric: string
): { params: OptimizedParams; score: number; returnPct: number } {
  let bestParams: OptimizedParams = { positionSize: 10, stopLoss: 2, takeProfit: 4, period: 14, threshold: 0.5 };
  let bestScore = -Infinity;
  let bestReturn = 0;
  
  // Grid search
  for (let ps = 5; ps <= 15; ps += 5) {
    for (let sl = 1; sl <= 4; sl += 1) {
      for (let tp = 3; tp <= 8; tp += 2) {
        if (tp / sl < 1.5) continue;
        for (let period = 10; period <= 25; period += 5) {
          for (let thresh = 0.3; thresh <= 1.2; thresh += 0.3) {
            const params: OptimizedParams = { positionSize: ps, stopLoss: sl, takeProfit: tp, period, threshold: thresh };
            const signals = generateSignals(candles, strategy, params);
            const result = runBacktest(candles, signals, params, initialCapital);
            
            if (result.trades < 3) continue;
            
            let score: number;
            switch (metric) {
              case 'return': score = result.totalReturn; break;
              case 'sharpe': score = result.sharpe; break;
              case 'profit_factor': score = result.winRate > 50 ? result.totalReturn / Math.max(1, 100 - result.winRate) : result.totalReturn * 0.5; break;
              case 'win_rate': score = result.winRate; break;
              default: score = result.totalReturn;
            }
            
            if (score > bestScore) {
              bestScore = score;
              bestParams = params;
              bestReturn = result.totalReturn;
            }
          }
        }
      }
    }
  }
  
  return { params: bestParams, score: bestScore, returnPct: bestReturn };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const config: WalkForwardConfig = await req.json();
    console.log(`Starting Walk-Forward Analysis for ${config.symbol} with ${config.windows} windows`);
    
    const startTime = Math.floor(new Date(config.startDate).getTime() / 1000);
    const endTime = Math.floor(new Date(config.endDate).getTime() / 1000);
    
    // Fetch all historical data
    console.log('Fetching historical data...');
    const allCandles = await fetchHistoricalData(config.symbol, startTime, endTime);
    
    if (allCandles.length < 200) {
      return new Response(
        JSON.stringify({ error: 'Insufficient data for walk-forward analysis (min 200 candles)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log(`Fetched ${allCandles.length} candles, running ${config.windows} walk-forward windows...`);
    
    const windowSize = Math.floor(allCandles.length / config.windows);
    const inSampleSize = Math.floor(windowSize * config.inSampleRatio);
    const outSampleSize = windowSize - inSampleSize;
    
    const windowResults: WindowResult[] = [];
    let totalOutSampleReturn = 0;
    let profitableWindows = 0;
    let totalSharpe = 0;
    let overallMaxDrawdown = 0;
    
    for (let w = 0; w < config.windows; w++) {
      const windowStart = w * windowSize;
      const inSampleCandles = allCandles.slice(windowStart, windowStart + inSampleSize);
      const outSampleCandles = allCandles.slice(windowStart + inSampleSize, windowStart + windowSize);
      
      if (inSampleCandles.length < 50 || outSampleCandles.length < 10) continue;
      
      console.log(`Window ${w + 1}: Optimizing on ${inSampleCandles.length} candles, testing on ${outSampleCandles.length}`);
      
      // Optimize on in-sample
      const optimized = optimizeParams(inSampleCandles, config.strategy, config.initialCapital, config.metric);
      
      // Test on out-of-sample
      const outSignals = generateSignals(outSampleCandles, config.strategy, optimized.params);
      const outResult = runBacktest(outSampleCandles, outSignals, optimized.params, config.initialCapital);
      
      const isProfit = outResult.totalReturn > 0;
      if (isProfit) profitableWindows++;
      totalOutSampleReturn += outResult.totalReturn;
      totalSharpe += outResult.sharpe;
      if (outResult.maxDrawdown > overallMaxDrawdown) overallMaxDrawdown = outResult.maxDrawdown;
      
      windowResults.push({
        windowIndex: w + 1,
        inSampleStart: new Date(inSampleCandles[0].timestamp * 1000).toISOString().split('T')[0],
        inSampleEnd: new Date(inSampleCandles[inSampleCandles.length - 1].timestamp * 1000).toISOString().split('T')[0],
        outSampleStart: new Date(outSampleCandles[0].timestamp * 1000).toISOString().split('T')[0],
        outSampleEnd: new Date(outSampleCandles[outSampleCandles.length - 1].timestamp * 1000).toISOString().split('T')[0],
        optimizedParams: optimized.params,
        inSampleReturn: optimized.returnPct,
        outSampleReturn: outResult.totalReturn,
        outSampleWinRate: outResult.winRate,
        outSampleTrades: outResult.trades,
        outSampleSharpe: outResult.sharpe,
        outSampleMaxDrawdown: outResult.maxDrawdown,
        isProfit,
      });
    }
    
    const avgOutReturn = windowResults.length > 0 ? totalOutSampleReturn / windowResults.length : 0;
    const avgInReturn = windowResults.length > 0 
      ? windowResults.reduce((s, w) => s + w.inSampleReturn, 0) / windowResults.length 
      : 0;
    const robustnessScore = avgInReturn > 0 ? (avgOutReturn / avgInReturn) * 100 : 0;
    const stabilityScore = windowResults.length > 0 ? (profitableWindows / windowResults.length) * 100 : 0;
    const avgWinRate = windowResults.length > 0 
      ? windowResults.reduce((s, w) => s + w.outSampleWinRate, 0) / windowResults.length 
      : 0;
    
    // Determine recommendation
    let recommendation: WalkForwardResult['recommendation'];
    let recommendationReason: string;
    
    if (stabilityScore >= 70 && robustnessScore >= 60 && avgOutReturn > 0) {
      recommendation = 'strong';
      recommendationReason = 'האסטרטגיה מציגה יציבות גבוהה ורווחיות עקבית במבחני out-of-sample';
    } else if (stabilityScore >= 50 && robustnessScore >= 40 && avgOutReturn > 0) {
      recommendation = 'moderate';
      recommendationReason = 'האסטרטגיה מציגה פוטנציאל אך דורשת ניטור צמוד';
    } else if (stabilityScore >= 30 || avgOutReturn > 0) {
      recommendation = 'weak';
      recommendationReason = 'האסטרטגיה מראה חוסר עקביות - מומלץ לשפר פרמטרים';
    } else {
      recommendation = 'avoid';
      recommendationReason = 'האסטרטגיה כושלת בבדיקות out-of-sample - יש חשד ל-Overfitting';
    }
    
    const result: WalkForwardResult = {
      symbol: config.symbol,
      strategy: config.strategy,
      windows: windowResults,
      aggregatedMetrics: {
        totalOutSampleReturn,
        averageOutSampleReturn: avgOutReturn,
        outSampleWinRate: avgWinRate,
        profitableWindows,
        totalWindows: windowResults.length,
        robustnessScore,
        stabilityScore,
        averageSharpe: windowResults.length > 0 ? totalSharpe / windowResults.length : 0,
        maxDrawdown: overallMaxDrawdown,
      },
      recommendation,
      recommendationReason,
    };
    
    console.log(`Walk-Forward complete: ${recommendation} recommendation (${stabilityScore.toFixed(0)}% stability, ${robustnessScore.toFixed(0)}% robustness)`);
    
    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('Walk-Forward error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
