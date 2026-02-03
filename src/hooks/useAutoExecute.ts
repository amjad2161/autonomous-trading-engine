import { useState, useEffect, useCallback } from 'react';

export interface AutoExecuteSettings {
  enabled: boolean;
  maxTradeSize: number; // Max USDT per trade
  minEdge: number; // Minimum edge percentage to execute
  dailyLossLimit: number; // Stop trading if daily loss exceeds this
  maxOpenTrades: number; // Maximum concurrent trades
  allowedTypes: ('spread' | 'arbitrage')[]; // Which opportunity types to auto-execute
}

const STORAGE_KEY = 'auto_execute_settings';
const DAILY_STATS_KEY = 'auto_execute_daily_stats';

const DEFAULT_SETTINGS: AutoExecuteSettings = {
  enabled: false,
  maxTradeSize: 10, // $10 max per trade (conservative default)
  minEdge: 0.2, // 0.2% minimum edge
  dailyLossLimit: 50, // Stop if $50 lost
  maxOpenTrades: 3,
  allowedTypes: ['spread'], // Only spread by default (safer)
};

interface DailyStats {
  date: string;
  totalPnL: number;
  tradesExecuted: number;
  tradesToday: string[];
}

export function useAutoExecuteSettings() {
  const [settings, setSettingsState] = useState<AutoExecuteSettings>(DEFAULT_SETTINGS);
  const [dailyStats, setDailyStats] = useState<DailyStats>({
    date: new Date().toDateString(),
    totalPnL: 0,
    tradesExecuted: 0,
    tradesToday: [],
  });
  const [isLoading, setIsLoading] = useState(true);

  // Load settings from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        setSettingsState({ ...DEFAULT_SETTINGS, ...JSON.parse(stored) });
      } catch {
        // Use defaults
      }
    }

    // Load daily stats
    const statsStored = localStorage.getItem(DAILY_STATS_KEY);
    if (statsStored) {
      try {
        const stats = JSON.parse(statsStored);
        // Reset if new day
        if (stats.date !== new Date().toDateString()) {
          setDailyStats({
            date: new Date().toDateString(),
            totalPnL: 0,
            tradesExecuted: 0,
            tradesToday: [],
          });
        } else {
          setDailyStats(stats);
        }
      } catch {
        // Use fresh stats
      }
    }

    setIsLoading(false);
  }, []);

  const updateSettings = useCallback((updates: Partial<AutoExecuteSettings>) => {
    setSettingsState(prev => {
      const newSettings = { ...prev, ...updates };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newSettings));
      return newSettings;
    });
  }, []);

  const recordTrade = useCallback((tradeId: string, pnl: number) => {
    setDailyStats(prev => {
      const newStats = {
        ...prev,
        totalPnL: prev.totalPnL + pnl,
        tradesExecuted: prev.tradesExecuted + 1,
        tradesToday: [...prev.tradesToday, tradeId],
      };
      localStorage.setItem(DAILY_STATS_KEY, JSON.stringify(newStats));
      return newStats;
    });
  }, []);

  const resetDailyStats = useCallback(() => {
    const freshStats = {
      date: new Date().toDateString(),
      totalPnL: 0,
      tradesExecuted: 0,
      tradesToday: [],
    };
    setDailyStats(freshStats);
    localStorage.setItem(DAILY_STATS_KEY, JSON.stringify(freshStats));
  }, []);

  // Check if trading should be halted (Kill Switch)
  const shouldHaltTrading = useCallback(() => {
    // Daily loss limit exceeded
    if (dailyStats.totalPnL < -settings.dailyLossLimit) {
      return { halt: true, reason: 'Daily loss limit exceeded' };
    }
    return { halt: false, reason: null };
  }, [dailyStats.totalPnL, settings.dailyLossLimit]);

  return {
    settings,
    updateSettings,
    dailyStats,
    recordTrade,
    resetDailyStats,
    shouldHaltTrading,
    isLoading,
  };
}
