import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BacktestConfig {
  symbol: string;
  strategy: 'spread' | 'momentum' | 'breakout' | 'mean_reversion';
  startDate: string;
  endDate: string;
  initialCapital: number;
  positionSize: number; // percentage of capital per trade
  stopLoss: number; // percentage
  takeProfit: number; // percentage
  // Strategy-specific params
  spreadThreshold?: number;
  momentumPeriod?: number;
  breakoutPeriod?: number;
  meanReversionPeriod?: number;
}

interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Trade {
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  side: 'buy' | 'sell';
  size: number;
  pnl: number;
  pnlPercent: number;
  exitReason: 'take_profit' | 'stop_loss' | 'signal' | 'end_of_data';
}

interface BacktestResult {
  symbol: string;
  strategy: string;
  startDate: string;
  endDate: string;
  initialCapital: number;
  finalCapital: number;
  totalReturn: number;
  totalReturnPercent: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  sharpeRatio: number;
  profitFactor: number;
  averageWin: number;
  averageLoss: number;
  largestWin: number;
  largestLoss: number;
  trades: Trade[];
  equityCurve: { time: number; equity: number }[];
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
    if (!response.ok) {
      console.error(`Failed to fetch candles: ${response.status}`);
      break;
    }
    
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
    
    // Rate limiting
    await new Promise(r => setTimeout(r, 100));
  }
  
  // Sort by timestamp
  return allCandles.sort((a, b) => a.timestamp - b.timestamp);
}

// Calculate Simple Moving Average
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

// Generate trading signals based on strategy
function generateSignals(
  candles: Candle[],
  config: BacktestConfig
): ('buy' | 'sell' | 'hold')[] {
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const signals: ('buy' | 'sell' | 'hold')[] = [];
  
  switch (config.strategy) {
    case 'spread': {
      // Simple spread strategy: buy when price drops below SMA, sell when above
      const period = 20;
      const threshold = config.spreadThreshold || 0.5;
      const ma = sma(closes, period);
      
      for (let i = 0; i < candles.length; i++) {
        if (isNaN(ma[i])) {
          signals.push('hold');
        } else {
          const deviation = ((closes[i] - ma[i]) / ma[i]) * 100;
          if (deviation < -threshold) {
            signals.push('buy');
          } else if (deviation > threshold) {
            signals.push('sell');
          } else {
            signals.push('hold');
          }
        }
      }
      break;
    }
    
    case 'momentum': {
      // Momentum strategy: buy when price breaks above recent highs
      const period = config.momentumPeriod || 14;
      
      for (let i = 0; i < candles.length; i++) {
        if (i < period) {
          signals.push('hold');
        } else {
          const recentHighs = highs.slice(i - period, i);
          const recentLows = lows.slice(i - period, i);
          const highestHigh = Math.max(...recentHighs);
          const lowestLow = Math.min(...recentLows);
          
          if (closes[i] > highestHigh) {
            signals.push('buy');
          } else if (closes[i] < lowestLow) {
            signals.push('sell');
          } else {
            signals.push('hold');
          }
        }
      }
      break;
    }
    
    case 'breakout': {
      // Breakout strategy: Bollinger Bands
      const period = config.breakoutPeriod || 20;
      const ma = sma(closes, period);
      const std = stdDev(closes, period);
      
      for (let i = 0; i < candles.length; i++) {
        if (isNaN(ma[i]) || isNaN(std[i])) {
          signals.push('hold');
        } else {
          const upperBand = ma[i] + 2 * std[i];
          const lowerBand = ma[i] - 2 * std[i];
          
          if (closes[i] < lowerBand) {
            signals.push('buy'); // Price below lower band - oversold
          } else if (closes[i] > upperBand) {
            signals.push('sell'); // Price above upper band - overbought
          } else {
            signals.push('hold');
          }
        }
      }
      break;
    }
    
    case 'mean_reversion': {
      // Mean reversion: buy when RSI is oversold, sell when overbought
      const period = config.meanReversionPeriod || 14;
      
      // Calculate RSI
      const gains: number[] = [];
      const losses: number[] = [];
      
      for (let i = 1; i < candles.length; i++) {
        const change = closes[i] - closes[i - 1];
        gains.push(change > 0 ? change : 0);
        losses.push(change < 0 ? -change : 0);
      }
      
      const avgGains = sma(gains, period);
      const avgLosses = sma(losses, period);
      
      signals.push('hold'); // First candle
      for (let i = 0; i < avgGains.length; i++) {
        if (isNaN(avgGains[i]) || isNaN(avgLosses[i]) || avgLosses[i] === 0) {
          signals.push('hold');
        } else {
          const rs = avgGains[i] / avgLosses[i];
          const rsi = 100 - (100 / (1 + rs));
          
          if (rsi < 30) {
            signals.push('buy'); // Oversold
          } else if (rsi > 70) {
            signals.push('sell'); // Overbought
          } else {
            signals.push('hold');
          }
        }
      }
      break;
    }
    
    default:
      for (let i = 0; i < candles.length; i++) {
        signals.push('hold');
      }
  }
  
  return signals;
}

// Run backtest simulation
function runBacktest(
  candles: Candle[],
  signals: ('buy' | 'sell' | 'hold')[],
  config: BacktestConfig
): BacktestResult {
  let capital = config.initialCapital;
  let position: { side: 'buy' | 'sell'; entryPrice: number; entryTime: number; size: number } | null = null;
  const trades: Trade[] = [];
  const equityCurve: { time: number; equity: number }[] = [];
  
  let peakEquity = capital;
  let maxDrawdown = 0;
  
  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    const signal = signals[i];
    
    // Calculate current equity
    let currentEquity = capital;
    if (position) {
      const unrealizedPnl = position.side === 'buy' 
        ? (candle.close - position.entryPrice) * position.size
        : (position.entryPrice - candle.close) * position.size;
      currentEquity = capital + unrealizedPnl;
    }
    
    // Track equity curve
    equityCurve.push({ time: candle.timestamp, equity: currentEquity });
    
    // Update max drawdown
    if (currentEquity > peakEquity) {
      peakEquity = currentEquity;
    }
    const drawdown = peakEquity - currentEquity;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
    
    // Check stop loss / take profit if in position
    if (position) {
      const pnlPercent = position.side === 'buy'
        ? ((candle.close - position.entryPrice) / position.entryPrice) * 100
        : ((position.entryPrice - candle.close) / position.entryPrice) * 100;
      
      let exitReason: Trade['exitReason'] | null = null;
      
      if (pnlPercent <= -config.stopLoss) {
        exitReason = 'stop_loss';
      } else if (pnlPercent >= config.takeProfit) {
        exitReason = 'take_profit';
      } else if (
        (position.side === 'buy' && signal === 'sell') ||
        (position.side === 'sell' && signal === 'buy')
      ) {
        exitReason = 'signal';
      }
      
      if (exitReason) {
        const pnl = position.side === 'buy'
          ? (candle.close - position.entryPrice) * position.size
          : (position.entryPrice - candle.close) * position.size;
        
        trades.push({
          entryTime: position.entryTime,
          exitTime: candle.timestamp,
          entryPrice: position.entryPrice,
          exitPrice: candle.close,
          side: position.side,
          size: position.size,
          pnl,
          pnlPercent,
          exitReason,
        });
        
        capital += pnl;
        position = null;
      }
    }
    
    // Enter new position
    if (!position && signal !== 'hold') {
      const positionValue = capital * (config.positionSize / 100);
      const size = positionValue / candle.close;
      
      position = {
        side: signal,
        entryPrice: candle.close,
        entryTime: candle.timestamp,
        size,
      };
    }
  }
  
  // Close any open position at end
  if (position && candles.length > 0) {
    const lastCandle = candles[candles.length - 1];
    const pnl = position.side === 'buy'
      ? (lastCandle.close - position.entryPrice) * position.size
      : (position.entryPrice - lastCandle.close) * position.size;
    const pnlPercent = position.side === 'buy'
      ? ((lastCandle.close - position.entryPrice) / position.entryPrice) * 100
      : ((position.entryPrice - lastCandle.close) / position.entryPrice) * 100;
    
    trades.push({
      entryTime: position.entryTime,
      exitTime: lastCandle.timestamp,
      entryPrice: position.entryPrice,
      exitPrice: lastCandle.close,
      side: position.side,
      size: position.size,
      pnl,
      pnlPercent,
      exitReason: 'end_of_data',
    });
    
    capital += pnl;
  }
  
  // Calculate statistics
  const winningTrades = trades.filter(t => t.pnl > 0);
  const losingTrades = trades.filter(t => t.pnl <= 0);
  
  const totalReturn = capital - config.initialCapital;
  const totalReturnPercent = (totalReturn / config.initialCapital) * 100;
  
  const averageWin = winningTrades.length > 0
    ? winningTrades.reduce((sum, t) => sum + t.pnl, 0) / winningTrades.length
    : 0;
  const averageLoss = losingTrades.length > 0
    ? Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0) / losingTrades.length)
    : 0;
  
  const largestWin = winningTrades.length > 0
    ? Math.max(...winningTrades.map(t => t.pnl))
    : 0;
  const largestLoss = losingTrades.length > 0
    ? Math.abs(Math.min(...losingTrades.map(t => t.pnl)))
    : 0;
  
  const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
  
  // Calculate Sharpe Ratio (simplified, using daily returns)
  const returns = trades.map(t => t.pnlPercent);
  const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const returnStd = returns.length > 1
    ? Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length)
    : 1;
  const sharpeRatio = returnStd > 0 ? (avgReturn / returnStd) * Math.sqrt(252) : 0;
  
  return {
    symbol: config.symbol,
    strategy: config.strategy,
    startDate: config.startDate,
    endDate: config.endDate,
    initialCapital: config.initialCapital,
    finalCapital: capital,
    totalReturn,
    totalReturnPercent,
    totalTrades: trades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRate: trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0,
    maxDrawdown,
    maxDrawdownPercent: peakEquity > 0 ? (maxDrawdown / peakEquity) * 100 : 0,
    sharpeRatio,
    profitFactor,
    averageWin,
    averageLoss,
    largestWin,
    largestLoss,
    trades: trades.slice(-100), // Return last 100 trades
    equityCurve: equityCurve.filter((_, i) => i % Math.max(1, Math.floor(equityCurve.length / 200)) === 0), // Sample for chart
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const config: BacktestConfig = await req.json();
    
    console.log(`Starting backtest for ${config.symbol} with ${config.strategy} strategy`);
    
    // Parse dates
    const startTime = Math.floor(new Date(config.startDate).getTime() / 1000);
    const endTime = Math.floor(new Date(config.endDate).getTime() / 1000);
    
    // Validate time range
    const maxDays = 365;
    if ((endTime - startTime) > maxDays * 24 * 3600) {
      return new Response(
        JSON.stringify({ error: `Maximum backtest period is ${maxDays} days` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Fetch historical data
    console.log(`Fetching historical data from ${config.startDate} to ${config.endDate}`);
    const candles = await fetchHistoricalData(config.symbol, startTime, endTime);
    
    if (candles.length < 50) {
      return new Response(
        JSON.stringify({ error: 'Insufficient historical data for backtest (minimum 50 candles required)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log(`Fetched ${candles.length} candles, generating signals...`);
    
    // Generate signals
    const signals = generateSignals(candles, config);
    
    // Run backtest
    console.log('Running backtest simulation...');
    const result = runBacktest(candles, signals, config);
    
    console.log(`Backtest complete: ${result.totalTrades} trades, ${result.winRate.toFixed(1)}% win rate, ${result.totalReturnPercent.toFixed(2)}% return`);
    
    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('Backtest error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
