import { supabase } from "@/integrations/supabase/client";

export interface OptimizeConfig {
  symbol: string;
  strategy: 'spread' | 'momentum' | 'breakout' | 'mean_reversion';
  startDate: string;
  endDate: string;
  initialCapital: number;
  positionSizeRange: [number, number, number];
  stopLossRange: [number, number, number];
  takeProfitRange: [number, number, number];
  periodRange?: [number, number, number];
  thresholdRange?: [number, number, number];
  metric: 'return' | 'sharpe' | 'profit_factor' | 'win_rate';
  maxIterations?: number;
}

export interface OptimizedParams {
  positionSize: number;
  stopLoss: number;
  takeProfit: number;
  period?: number;
  threshold?: number;
}

export interface OptimizationResultItem {
  params: OptimizedParams;
  score: number;
  totalReturn: number;
  winRate: number;
  sharpeRatio: number;
  profitFactor: number;
  maxDrawdown: number;
  trades: number;
}

export interface OptimizationResult {
  bestParams: OptimizedParams;
  bestScore: number;
  metric: string;
  results: OptimizationResultItem[];
  totalIterations: number;
  candlesUsed: number;
}

export async function runOptimization(config: OptimizeConfig): Promise<OptimizationResult> {
  const { data, error } = await supabase.functions.invoke('optimize-strategy', {
    body: config
  });

  if (error) {
    throw new Error(`Optimization failed: ${error.message}`);
  }

  if (data.error) {
    throw new Error(data.error);
  }

  return data as OptimizationResult;
}

export function getMetricLabel(metric: string): string {
  const labels: Record<string, string> = {
    return: 'תשואה',
    sharpe: 'Sharpe Ratio',
    profit_factor: 'Profit Factor',
    win_rate: 'Win Rate'
  };
  return labels[metric] || metric;
}
