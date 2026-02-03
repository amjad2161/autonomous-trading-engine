import { useState, useEffect, useCallback } from 'react';

export interface AutoExecuteSettings {
  enabled: boolean;
  maxTradeSize: number; // Max USDT per trade
  maxPositionSize: number; // Max % of portfolio per trade
  minEdge: number; // Minimum edge percentage to execute
  dailyLossLimit: number; // Stop trading if daily loss exceeds this
  drawdownLimit: number; // Stop if total drawdown exceeds this %
  maxOpenTrades: number; // Maximum concurrent trades
  maxTradesPerHour: number; // Rate limiting
  allowedTypes: ('spread' | 'arbitrage' | 'momentum' | 'breakout' | 'reversion' | 'volume_spike')[];
  slippageTolerance: number; // Max slippage allowed %
  cooldownAfterLoss: number; // Minutes to pause after losing trade
}

const STORAGE_KEY = 'auto_execute_settings';
const DAILY_STATS_KEY = 'auto_execute_daily_stats';
const CIRCUIT_BREAKER_KEY = 'circuit_breaker_state';
const TRADE_HISTORY_KEY = 'trade_history';

const DEFAULT_SETTINGS: AutoExecuteSettings = {
  enabled: false,
  maxTradeSize: 50, // $50 max per trade
  maxPositionSize: 10, // 10% of portfolio max
  minEdge: 0.2, // 0.2% minimum edge
  dailyLossLimit: 100, // Stop if $100 lost
  drawdownLimit: 20, // Stop if 20% drawdown
  maxOpenTrades: 3,
  maxTradesPerHour: 10,
  allowedTypes: ['spread'], // Start conservative
  slippageTolerance: 0.5, // 0.5% max slippage
  cooldownAfterLoss: 5, // 5 minute cooldown after loss
};

interface DailyStats {
  date: string;
  totalPnL: number;
  tradesExecuted: number;
  winningTrades: number;
  losingTrades: number;
  largestWin: number;
  largestLoss: number;
  tradesToday: string[];
  hourlyTrades: Record<string, number>; // hour -> count
}

interface CircuitBreakerState {
  triggered: boolean;
  reason: string | null;
  triggeredAt: number | null;
  level: 'none' | 'caution' | 'warning' | 'critical' | 'halted';
  consecutiveLosses: number;
  cooldownUntil: number | null;
}

interface TradeRecord {
  id: string;
  timestamp: number;
  symbol: string;
  type: string;
  side: 'buy' | 'sell';
  amount: number;
  entryPrice: number;
  exitPrice?: number;
  pnl?: number;
  status: 'open' | 'closed' | 'cancelled';
  slippage?: number;
  executionTime?: number;
}

export function useAutoExecuteSettings() {
  const [settings, setSettingsState] = useState<AutoExecuteSettings>(DEFAULT_SETTINGS);
  const [dailyStats, setDailyStats] = useState<DailyStats>({
    date: new Date().toDateString(),
    totalPnL: 0,
    tradesExecuted: 0,
    winningTrades: 0,
    losingTrades: 0,
    largestWin: 0,
    largestLoss: 0,
    tradesToday: [],
    hourlyTrades: {},
  });
  const [circuitBreaker, setCircuitBreaker] = useState<CircuitBreakerState>({
    triggered: false,
    reason: null,
    triggeredAt: null,
    level: 'none',
    consecutiveLosses: 0,
    cooldownUntil: null,
  });
  const [tradeHistory, setTradeHistory] = useState<TradeRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load from localStorage
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
        if (stats.date !== new Date().toDateString()) {
          // Reset for new day
          const freshStats = {
            date: new Date().toDateString(),
            totalPnL: 0,
            tradesExecuted: 0,
            winningTrades: 0,
            losingTrades: 0,
            largestWin: 0,
            largestLoss: 0,
            tradesToday: [],
            hourlyTrades: {},
          };
          setDailyStats(freshStats);
          localStorage.setItem(DAILY_STATS_KEY, JSON.stringify(freshStats));
        } else {
          setDailyStats(stats);
        }
      } catch {
        // Use fresh stats
      }
    }

    // Load circuit breaker state
    const cbStored = localStorage.getItem(CIRCUIT_BREAKER_KEY);
    if (cbStored) {
      try {
        const cb = JSON.parse(cbStored);
        // Check if cooldown expired
        if (cb.cooldownUntil && Date.now() > cb.cooldownUntil) {
          cb.cooldownUntil = null;
        }
        setCircuitBreaker(cb);
      } catch {
        // Use defaults
      }
    }

    // Load trade history (last 100 trades)
    const historyStored = localStorage.getItem(TRADE_HISTORY_KEY);
    if (historyStored) {
      try {
        setTradeHistory(JSON.parse(historyStored).slice(-100));
      } catch {
        // Use empty array
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

  const updateCircuitBreaker = useCallback((updates: Partial<CircuitBreakerState>) => {
    setCircuitBreaker(prev => {
      const newState = { ...prev, ...updates };
      localStorage.setItem(CIRCUIT_BREAKER_KEY, JSON.stringify(newState));
      return newState;
    });
  }, []);

  const recordTrade = useCallback((trade: Omit<TradeRecord, 'id' | 'timestamp'> & { pnl: number }) => {
    const tradeId = `trade-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const record: TradeRecord = {
      id: tradeId,
      timestamp: Date.now(),
      ...trade,
    };

    // Update trade history
    setTradeHistory(prev => {
      const newHistory = [...prev, record].slice(-100);
      localStorage.setItem(TRADE_HISTORY_KEY, JSON.stringify(newHistory));
      return newHistory;
    });

    // Update daily stats
    const hourKey = new Date().getHours().toString();
    
    setDailyStats(prev => {
      const isWin = trade.pnl > 0;
      const newStats: DailyStats = {
        ...prev,
        totalPnL: prev.totalPnL + trade.pnl,
        tradesExecuted: prev.tradesExecuted + 1,
        winningTrades: prev.winningTrades + (isWin ? 1 : 0),
        losingTrades: prev.losingTrades + (isWin ? 0 : 1),
        largestWin: Math.max(prev.largestWin, isWin ? trade.pnl : 0),
        largestLoss: Math.min(prev.largestLoss, isWin ? 0 : trade.pnl),
        tradesToday: [...prev.tradesToday, tradeId],
        hourlyTrades: {
          ...prev.hourlyTrades,
          [hourKey]: (prev.hourlyTrades[hourKey] || 0) + 1,
        },
      };
      localStorage.setItem(DAILY_STATS_KEY, JSON.stringify(newStats));
      return newStats;
    });

    // Update circuit breaker
    if (trade.pnl < 0) {
      setCircuitBreaker(prev => {
        const newConsecutive = prev.consecutiveLosses + 1;
        let newLevel = prev.level;
        let newReason = prev.reason;
        let cooldownUntil = prev.cooldownUntil;
        
        // Escalate based on consecutive losses
        if (newConsecutive >= 5) {
          newLevel = 'halted';
          newReason = `5 consecutive losses - trading halted`;
        } else if (newConsecutive >= 3) {
          newLevel = 'critical';
          newReason = `${newConsecutive} consecutive losses`;
          cooldownUntil = Date.now() + (settings.cooldownAfterLoss * 60 * 1000 * 2);
        } else if (newConsecutive >= 2) {
          newLevel = 'warning';
          newReason = `${newConsecutive} consecutive losses`;
          cooldownUntil = Date.now() + (settings.cooldownAfterLoss * 60 * 1000);
        } else {
          newLevel = 'caution';
          cooldownUntil = Date.now() + (settings.cooldownAfterLoss * 60 * 1000);
        }

        const newState = {
          ...prev,
          consecutiveLosses: newConsecutive,
          level: newLevel,
          reason: newReason,
          triggered: newLevel === 'halted' || newLevel === 'critical',
          triggeredAt: Date.now(),
          cooldownUntil,
        };
        localStorage.setItem(CIRCUIT_BREAKER_KEY, JSON.stringify(newState));
        return newState;
      });
    } else {
      // Reset consecutive losses on win
      setCircuitBreaker(prev => {
        const newState = {
          ...prev,
          consecutiveLosses: 0,
          level: 'none' as const,
          reason: null,
          triggered: false,
          triggeredAt: null,
          cooldownUntil: null,
        };
        localStorage.setItem(CIRCUIT_BREAKER_KEY, JSON.stringify(newState));
        return newState;
      });
    }

    return tradeId;
  }, [settings.cooldownAfterLoss]);

  const resetDailyStats = useCallback(() => {
    const freshStats: DailyStats = {
      date: new Date().toDateString(),
      totalPnL: 0,
      tradesExecuted: 0,
      winningTrades: 0,
      losingTrades: 0,
      largestWin: 0,
      largestLoss: 0,
      tradesToday: [],
      hourlyTrades: {},
    };
    setDailyStats(freshStats);
    localStorage.setItem(DAILY_STATS_KEY, JSON.stringify(freshStats));
  }, []);

  const resetCircuitBreaker = useCallback(() => {
    const freshState: CircuitBreakerState = {
      triggered: false,
      reason: null,
      triggeredAt: null,
      level: 'none',
      consecutiveLosses: 0,
      cooldownUntil: null,
    };
    setCircuitBreaker(freshState);
    localStorage.setItem(CIRCUIT_BREAKER_KEY, JSON.stringify(freshState));
  }, []);

  const triggerEmergencyStop = useCallback((reason: string) => {
    const newState: CircuitBreakerState = {
      triggered: true,
      reason: `EMERGENCY: ${reason}`,
      triggeredAt: Date.now(),
      level: 'halted',
      consecutiveLosses: circuitBreaker.consecutiveLosses,
      cooldownUntil: null, // Manual reset required
    };
    setCircuitBreaker(newState);
    localStorage.setItem(CIRCUIT_BREAKER_KEY, JSON.stringify(newState));
    
    // Also disable auto-execute
    updateSettings({ enabled: false });
  }, [circuitBreaker.consecutiveLosses, updateSettings]);

  // Check if trading should be halted (Multi-level Kill Switch)
  const shouldHaltTrading = useCallback((): { halt: boolean; reason: string | null; level: string } => {
    // 1. Circuit breaker triggered
    if (circuitBreaker.triggered) {
      return { halt: true, reason: circuitBreaker.reason, level: circuitBreaker.level };
    }

    // 2. In cooldown
    if (circuitBreaker.cooldownUntil && Date.now() < circuitBreaker.cooldownUntil) {
      const remaining = Math.ceil((circuitBreaker.cooldownUntil - Date.now()) / 60000);
      return { halt: true, reason: `Cooling down - ${remaining}min remaining`, level: 'caution' };
    }

    // 3. Daily loss limit exceeded
    if (dailyStats.totalPnL < -settings.dailyLossLimit) {
      return { halt: true, reason: `Daily loss limit exceeded ($${Math.abs(dailyStats.totalPnL).toFixed(2)})`, level: 'halted' };
    }

    // 4. Hourly rate limit
    const currentHour = new Date().getHours().toString();
    const hourlyCount = dailyStats.hourlyTrades[currentHour] || 0;
    if (hourlyCount >= settings.maxTradesPerHour) {
      return { halt: true, reason: `Hourly rate limit (${hourlyCount}/${settings.maxTradesPerHour})`, level: 'warning' };
    }

    // 5. Win rate too low (after at least 10 trades)
    if (dailyStats.tradesExecuted >= 10) {
      const winRate = dailyStats.winningTrades / dailyStats.tradesExecuted;
      if (winRate < 0.35) {
        return { halt: true, reason: `Win rate too low (${(winRate * 100).toFixed(1)}%)`, level: 'critical' };
      }
    }

    return { halt: false, reason: null, level: 'none' as const };
  }, [
    circuitBreaker,
    dailyStats,
    settings.dailyLossLimit,
    settings.maxTradesPerHour,
  ]);

  // Check if specific opportunity can be executed
  const canExecuteOpportunity = useCallback((
    type: string,
    expectedEdge: number,
    tradeSize: number,
    portfolioValue: number
  ): { canExecute: boolean; reason: string | null } => {
    // Check if type is allowed
    if (!settings.allowedTypes.includes(type as any)) {
      return { canExecute: false, reason: `Strategy type '${type}' not enabled` };
    }

    // Check edge threshold
    if (expectedEdge < settings.minEdge) {
      return { canExecute: false, reason: `Edge ${expectedEdge.toFixed(3)}% below minimum ${settings.minEdge}%` };
    }

    // Check trade size
    if (tradeSize > settings.maxTradeSize) {
      return { canExecute: false, reason: `Trade size $${tradeSize} exceeds max $${settings.maxTradeSize}` };
    }

    // Check position size as % of portfolio
    if (portfolioValue > 0) {
      const positionPercent = (tradeSize / portfolioValue) * 100;
      if (positionPercent > settings.maxPositionSize) {
        return { canExecute: false, reason: `Position ${positionPercent.toFixed(1)}% exceeds max ${settings.maxPositionSize}%` };
      }
    }

    // Check halt status
    const haltCheck = shouldHaltTrading();
    if (haltCheck.halt) {
      return { canExecute: false, reason: haltCheck.reason };
    }

    return { canExecute: true, reason: null };
  }, [settings, shouldHaltTrading]);

  // Calculate statistics
  const calculateStats = useCallback(() => {
    const winRate = dailyStats.tradesExecuted > 0 
      ? (dailyStats.winningTrades / dailyStats.tradesExecuted) * 100 
      : 0;
    
    const avgWin = dailyStats.winningTrades > 0 
      ? dailyStats.largestWin / dailyStats.winningTrades 
      : 0;
    
    const avgLoss = dailyStats.losingTrades > 0 
      ? Math.abs(dailyStats.largestLoss) / dailyStats.losingTrades 
      : 0;
    
    const profitFactor = avgLoss > 0 ? avgWin / avgLoss : avgWin;
    
    return {
      winRate,
      avgWin,
      avgLoss,
      profitFactor,
      totalTrades: dailyStats.tradesExecuted,
      netPnL: dailyStats.totalPnL,
    };
  }, [dailyStats]);

  return {
    settings,
    updateSettings,
    dailyStats,
    recordTrade,
    resetDailyStats,
    circuitBreaker,
    resetCircuitBreaker,
    triggerEmergencyStop,
    shouldHaltTrading,
    canExecuteOpportunity,
    tradeHistory,
    calculateStats,
    isLoading,
  };
}
