import { supabase } from "@/integrations/supabase/client";

export interface WalkForwardConfig {
  symbol: string;
  strategy: 'spread' | 'momentum' | 'breakout' | 'mean_reversion';
  startDate: string;
  endDate: string;
  initialCapital: number;
  windows: number;
  inSampleRatio: number;
  metric: 'return' | 'sharpe' | 'profit_factor' | 'win_rate';
}

export interface WalkForwardWindow {
  windowIndex: number;
  inSampleStart: string;
  inSampleEnd: string;
  outSampleStart: string;
  outSampleEnd: string;
  optimizedParams: {
    positionSize: number;
    stopLoss: number;
    takeProfit: number;
    period: number;
    threshold: number;
  };
  inSampleReturn: number;
  outSampleReturn: number;
  outSampleWinRate: number;
  outSampleTrades: number;
  outSampleSharpe: number;
  outSampleMaxDrawdown: number;
  isProfit: boolean;
}

export interface WalkForwardResult {
  symbol: string;
  strategy: string;
  windows: WalkForwardWindow[];
  aggregatedMetrics: {
    totalOutSampleReturn: number;
    averageOutSampleReturn: number;
    outSampleWinRate: number;
    profitableWindows: number;
    totalWindows: number;
    robustnessScore: number;
    stabilityScore: number;
    averageSharpe: number;
    maxDrawdown: number;
  };
  recommendation: 'strong' | 'moderate' | 'weak' | 'avoid';
  recommendationReason: string;
}

export async function runWalkForward(config: WalkForwardConfig): Promise<WalkForwardResult> {
  const { data, error } = await supabase.functions.invoke('walk-forward', {
    body: config
  });

  if (error) {
    throw new Error(`Walk-Forward failed: ${error.message}`);
  }

  if (data.error) {
    throw new Error(data.error);
  }

  return data as WalkForwardResult;
}

export function getRecommendationColor(recommendation: string): string {
  switch (recommendation) {
    case 'strong': return 'text-primary';
    case 'moderate': return 'text-accent-foreground';
    case 'weak': return 'text-muted-foreground';
    case 'avoid': return 'text-destructive';
    default: return 'text-foreground';
  }
}

export function getRecommendationLabel(recommendation: string): string {
  switch (recommendation) {
    case 'strong': return 'חזקה מאוד';
    case 'moderate': return 'בינונית';
    case 'weak': return 'חלשה';
    case 'avoid': return 'להימנע';
    default: return recommendation;
  }
}
