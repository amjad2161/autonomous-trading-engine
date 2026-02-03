import { supabase } from "@/integrations/supabase/client";

export interface BacktestConfig {
  symbol: string;
  strategy: 'spread' | 'momentum' | 'breakout' | 'mean_reversion';
  startDate: string;
  endDate: string;
  initialCapital: number;
  positionSize: number;
  stopLoss: number;
  takeProfit: number;
  spreadThreshold?: number;
  momentumPeriod?: number;
  breakoutPeriod?: number;
  meanReversionPeriod?: number;
}

export interface BacktestTrade {
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

export interface BacktestResult {
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
  trades: BacktestTrade[];
  equityCurve: { time: number; equity: number }[];
}

export async function runBacktest(config: BacktestConfig): Promise<BacktestResult> {
  const { data, error } = await supabase.functions.invoke('backtest', {
    body: config
  });

  if (error) {
    throw new Error(`Backtest failed: ${error.message}`);
  }

  if (data.error) {
    throw new Error(data.error);
  }

  return data as BacktestResult;
}

export function formatBacktestDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function getStrategyName(strategy: string): string {
  const names: Record<string, string> = {
    spread: 'ניצול מרווחים',
    momentum: 'מומנטום',
    breakout: 'פריצות',
    mean_reversion: 'חזרה לממוצע'
  };
  return names[strategy] || strategy;
}
