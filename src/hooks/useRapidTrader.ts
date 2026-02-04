import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface RapidTraderConfig {
  maxTradesPerCycle: number;
  tradeAmountUSDT: number;
  minVolume: number;
  targetProfitPercent: number;
  maxSpreadPercent: number;
  delayBetweenTrades: number;
  cycleIntervalSeconds: number;
}

export interface TradeResult {
  pair: string;
  buyPrice: number;
  sellPrice: number;
  amount: string;
  profit: number;
  profitPercent: number;
  status: 'success' | 'partial' | 'failed';
  error?: string;
  durationMs: number;
}

export interface RapidTraderStats {
  isRunning: boolean;
  cycleCount: number;
  totalTrades: number;
  successfulTrades: number;
  partialTrades: number;
  failedTrades: number;
  totalProfit: number;
  avgProfitPercent: number;
  avgDurationMs: number;
  currentBalance: number;
  startBalance: number;
  recentTrades: TradeResult[];
  lastCycleTime: number | null;
  errors: string[];
}

const DEFAULT_CONFIG: RapidTraderConfig = {
  maxTradesPerCycle: 10,
  tradeAmountUSDT: 5,
  minVolume: 50000,
  targetProfitPercent: 0.05,
  maxSpreadPercent: 1.0,
  delayBetweenTrades: 100,
  cycleIntervalSeconds: 10,
};

const STORAGE_KEY = 'rapid_trader_config';
const STATS_KEY = 'rapid_trader_stats';

export function useRapidTrader() {
  const { toast } = useToast();
  
  const [config, setConfig] = useState<RapidTraderConfig>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? { ...DEFAULT_CONFIG, ...JSON.parse(stored) } : DEFAULT_CONFIG;
  });

  const [stats, setStats] = useState<RapidTraderStats>(() => {
    const stored = localStorage.getItem(STATS_KEY);
    const defaultStats: RapidTraderStats = {
      isRunning: false,
      cycleCount: 0,
      totalTrades: 0,
      successfulTrades: 0,
      partialTrades: 0,
      failedTrades: 0,
      totalProfit: 0,
      avgProfitPercent: 0,
      avgDurationMs: 0,
      currentBalance: 0,
      startBalance: 0,
      recentTrades: [],
      lastCycleTime: null,
      errors: [],
    };
    return stored ? { ...defaultStats, ...JSON.parse(stored), isRunning: false } : defaultStats;
  });

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isRunningRef = useRef(false);

  // Save config to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }, [config]);

  // Save stats to localStorage
  useEffect(() => {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  }, [stats]);

  // Execute a single cycle
  const executeCycle = useCallback(async () => {
    if (!isRunningRef.current) return;

    try {
      console.log('[RapidTrader] Executing cycle...');
      
      const { data, error } = await supabase.functions.invoke('rapid-trader', {
        body: config,
      });

      if (error) throw error;

      if (data.success) {
        setStats(prev => ({
          ...prev,
          cycleCount: prev.cycleCount + 1,
          totalTrades: prev.totalTrades + data.summary.totalTrades,
          successfulTrades: prev.successfulTrades + data.summary.successfulTrades,
          partialTrades: prev.partialTrades + data.summary.partialTrades,
          failedTrades: prev.failedTrades + data.summary.failedTrades,
          totalProfit: prev.totalProfit + data.summary.totalProfit,
          avgProfitPercent: data.summary.avgProfitPercent || prev.avgProfitPercent,
          avgDurationMs: data.summary.avgDurationMs || prev.avgDurationMs,
          currentBalance: data.balance.after,
          recentTrades: [...data.trades, ...prev.recentTrades].slice(0, 50),
          lastCycleTime: Date.now(),
        }));

        if (data.summary.totalTrades > 0) {
          toast({
            title: `מחזור #${stats.cycleCount + 1}`,
            description: `${data.summary.successfulTrades}/${data.summary.totalTrades} עסקאות | רווח: $${data.summary.totalProfit.toFixed(4)}`,
            variant: data.summary.totalProfit >= 0 ? 'default' : 'destructive',
          });
        }
      } else {
        setStats(prev => ({
          ...prev,
          errors: [
            `${new Date().toLocaleTimeString()}: ${data.error || 'שגיאה'}`,
            ...prev.errors.slice(0, 9),
          ],
        }));
      }
    } catch (err) {
      console.error('[RapidTrader] Cycle error:', err);
      setStats(prev => ({
        ...prev,
        errors: [
          `${new Date().toLocaleTimeString()}: ${err instanceof Error ? err.message : 'שגיאה'}`,
          ...prev.errors.slice(0, 9),
        ],
      }));
    }
  }, [config, stats.cycleCount, toast]);

  // Start rapid trading
  const start = useCallback(async () => {
    if (isRunningRef.current) return;

    console.log('[RapidTrader] Starting...');
    isRunningRef.current = true;

    // Get initial balance
    try {
      const { data } = await supabase.functions.invoke('gate-api', {
        body: { endpoint: '/spot/accounts', method: 'GET' },
      });

      const usdtBalance = data?.find((b: { currency: string }) => b.currency === 'USDT');
      const balance = usdtBalance ? parseFloat(usdtBalance.available) : 0;

      setStats(prev => ({
        ...prev,
        isRunning: true,
        startBalance: prev.startBalance || balance,
        currentBalance: balance,
        errors: [],
      }));

      toast({
        title: '⚡ Rapid Trader הופעל',
        description: `יתרה: $${balance.toFixed(2)} | מחזור כל ${config.cycleIntervalSeconds} שניות`,
      });

      // Execute first cycle immediately
      await executeCycle();

      // Set up interval for subsequent cycles
      intervalRef.current = setInterval(executeCycle, config.cycleIntervalSeconds * 1000);
    } catch (err) {
      console.error('[RapidTrader] Start error:', err);
      isRunningRef.current = false;
      setStats(prev => ({ ...prev, isRunning: false }));
      toast({
        title: 'שגיאה בהפעלה',
        description: err instanceof Error ? err.message : 'שגיאה',
        variant: 'destructive',
      });
    }
  }, [config.cycleIntervalSeconds, executeCycle, toast]);

  // Stop rapid trading
  const stop = useCallback(() => {
    console.log('[RapidTrader] Stopping...');
    isRunningRef.current = false;

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    setStats(prev => ({ ...prev, isRunning: false }));

    toast({
      title: 'Rapid Trader הופסק',
      description: `סה"כ: ${stats.totalTrades} עסקאות | רווח: $${stats.totalProfit.toFixed(4)}`,
    });
  }, [stats.totalTrades, stats.totalProfit, toast]);

  // Reset stats
  const resetStats = useCallback(() => {
    setStats(prev => ({
      ...prev,
      cycleCount: 0,
      totalTrades: 0,
      successfulTrades: 0,
      partialTrades: 0,
      failedTrades: 0,
      totalProfit: 0,
      avgProfitPercent: 0,
      avgDurationMs: 0,
      startBalance: prev.currentBalance,
      recentTrades: [],
      errors: [],
    }));
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  return {
    config,
    setConfig,
    stats,
    start,
    stop,
    resetStats,
    executeCycle,
  };
}
