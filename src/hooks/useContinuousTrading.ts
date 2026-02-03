import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface TradingSettings {
  minEdge: number;
  maxTradeSize: number;
  maxDailyLoss: number;
  stopLossPercent: number;
  autoLiquidate: boolean;
  maxTradesPerHour: number;
  cycleIntervalSeconds: number;
}

export interface TradeCycle {
  timestamp: number;
  scanned: number;
  opportunities: number;
  tradesExecuted: number;
  tradesSuccessful: number;
  liquidationsPerformed: number;
  balanceBefore: number;
  balanceAfter: number;
  pnl: number;
}

export interface ContinuousTradingState {
  isRunning: boolean;
  isPaused: boolean;
  cycleCount: number;
  totalPnL: number;
  totalTrades: number;
  successfulTrades: number;
  lastCycle: TradeCycle | null;
  currentBalance: number;
  startBalance: number;
  recentCycles: TradeCycle[];
  errors: string[];
}

const DEFAULT_SETTINGS: TradingSettings = {
  minEdge: 2,
  maxTradeSize: 10,
  maxDailyLoss: 5,
  stopLossPercent: 2,
  autoLiquidate: true,
  maxTradesPerHour: 10,
  cycleIntervalSeconds: 30,
};

const STORAGE_KEY = 'continuous_trading_settings';
const STATE_KEY = 'continuous_trading_state';

export function useContinuousTrading() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<TradingSettings>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) } : DEFAULT_SETTINGS;
  });
  
  const [state, setState] = useState<ContinuousTradingState>(() => {
    const stored = localStorage.getItem(STATE_KEY);
    const defaultState: ContinuousTradingState = {
      isRunning: false,
      isPaused: false,
      cycleCount: 0,
      totalPnL: 0,
      totalTrades: 0,
      successfulTrades: 0,
      lastCycle: null,
      currentBalance: 0,
      startBalance: 0,
      recentCycles: [],
      errors: [],
    };
    return stored ? { ...defaultState, ...JSON.parse(stored) } : defaultState;
  });
  
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isRunningRef = useRef(false);

  // Save settings to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  // Save state to localStorage
  useEffect(() => {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  }, [state]);

  // Execute a single trading cycle
  const executeCycle = useCallback(async () => {
    if (!isRunningRef.current) return;
    
    try {
      console.log('[ContinuousTrading] Executing cycle...');
      
      const { data, error } = await supabase.functions.invoke('continuous-trader', {
        body: settings,
      });
      
      if (error) throw error;
      
      if (data.success) {
        const pnl = data.balance.after - data.balance.before;
        
        const cycle: TradeCycle = {
          timestamp: data.timestamp,
          scanned: data.cycle.scanned,
          opportunities: data.cycle.opportunities,
          tradesExecuted: data.cycle.tradesExecuted,
          tradesSuccessful: data.cycle.tradesSuccessful,
          liquidationsPerformed: data.cycle.liquidationsPerformed,
          balanceBefore: data.balance.before,
          balanceAfter: data.balance.after,
          pnl,
        };
        
        setState(prev => ({
          ...prev,
          cycleCount: prev.cycleCount + 1,
          totalPnL: prev.totalPnL + pnl,
          totalTrades: prev.totalTrades + data.cycle.tradesExecuted,
          successfulTrades: prev.successfulTrades + data.cycle.tradesSuccessful,
          lastCycle: cycle,
          currentBalance: data.balance.after,
          recentCycles: [cycle, ...prev.recentCycles.slice(0, 19)],
        }));
        
        if (data.cycle.tradesExecuted > 0) {
          toast({
            title: `מחזור #${state.cycleCount + 1} הושלם`,
            description: `${data.cycle.tradesSuccessful}/${data.cycle.tradesExecuted} עסקאות | P&L: $${pnl.toFixed(2)}`,
            variant: pnl >= 0 ? 'default' : 'destructive',
          });
        }
        
        // Check for daily loss limit
        if (state.totalPnL + pnl < -settings.maxDailyLoss) {
          console.log('[ContinuousTrading] Daily loss limit reached, stopping...');
          stop();
          toast({
            title: 'מסחר הופסק',
            description: `הגעת למגבלת ההפסד היומית ($${settings.maxDailyLoss})`,
            variant: 'destructive',
          });
        }
      } else {
        throw new Error(data.error || 'Unknown error');
      }
    } catch (err) {
      console.error('[ContinuousTrading] Cycle error:', err);
      setState(prev => ({
        ...prev,
        errors: [
          `${new Date().toLocaleTimeString()}: ${err instanceof Error ? err.message : 'שגיאה'}`,
          ...prev.errors.slice(0, 9),
        ],
      }));
    }
  }, [settings, state.cycleCount, state.totalPnL, toast]);

  // Start continuous trading
  const start = useCallback(async () => {
    if (isRunningRef.current) return;
    
    console.log('[ContinuousTrading] Starting...');
    isRunningRef.current = true;
    
    // Get initial balance
    try {
      const { data } = await supabase.functions.invoke('gate-api', {
        body: { endpoint: '/spot/accounts', method: 'GET' },
      });
      
      const usdtBalance = data?.find((b: { currency: string }) => b.currency === 'USDT');
      const balance = usdtBalance ? parseFloat(usdtBalance.available) : 0;
      
      setState(prev => ({
        ...prev,
        isRunning: true,
        isPaused: false,
        startBalance: prev.startBalance || balance,
        currentBalance: balance,
        errors: [],
      }));
      
      toast({
        title: 'מסחר רציף הופעל',
        description: `יתרה: $${balance.toFixed(2)} | מחזור כל ${settings.cycleIntervalSeconds} שניות`,
      });
      
      // Execute first cycle immediately
      await executeCycle();
      
      // Set up interval for subsequent cycles
      intervalRef.current = setInterval(executeCycle, settings.cycleIntervalSeconds * 1000);
    } catch (err) {
      console.error('[ContinuousTrading] Start error:', err);
      isRunningRef.current = false;
      setState(prev => ({ ...prev, isRunning: false }));
      toast({
        title: 'שגיאה בהפעלה',
        description: err instanceof Error ? err.message : 'שגיאה לא ידועה',
        variant: 'destructive',
      });
    }
  }, [settings.cycleIntervalSeconds, executeCycle, toast]);

  // Stop continuous trading
  const stop = useCallback(() => {
    console.log('[ContinuousTrading] Stopping...');
    isRunningRef.current = false;
    
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    
    setState(prev => ({ ...prev, isRunning: false, isPaused: false }));
    
    toast({
      title: 'מסחר רציף הופסק',
      description: `סה"כ: ${state.cycleCount} מחזורים | P&L: $${state.totalPnL.toFixed(2)}`,
    });
  }, [state.cycleCount, state.totalPnL, toast]);

  // Pause/Resume
  const togglePause = useCallback(() => {
    if (state.isPaused) {
      setState(prev => ({ ...prev, isPaused: false }));
      intervalRef.current = setInterval(executeCycle, settings.cycleIntervalSeconds * 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setState(prev => ({ ...prev, isPaused: true }));
    }
  }, [state.isPaused, settings.cycleIntervalSeconds, executeCycle]);

  // Reset stats
  const resetStats = useCallback(() => {
    setState(prev => ({
      ...prev,
      cycleCount: 0,
      totalPnL: 0,
      totalTrades: 0,
      successfulTrades: 0,
      startBalance: prev.currentBalance,
      recentCycles: [],
      errors: [],
    }));
  }, []);

  // Manual liquidation
  const liquidateNow = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke('auto-liquidate', {
        body: {},
      });
      
      if (error) throw error;
      
      toast({
        title: 'הליקווידציה הושלמה',
        description: `המרת $${data.totalLiquidatedUSDT?.toFixed(2) || 0} ל-USDT`,
      });
      
      return data;
    } catch (err) {
      toast({
        title: 'שגיאה בהמרה',
        description: err instanceof Error ? err.message : 'שגיאה',
        variant: 'destructive',
      });
      throw err;
    }
  }, [toast]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  return {
    settings,
    setSettings,
    state,
    start,
    stop,
    togglePause,
    resetStats,
    liquidateNow,
    executeCycle,
  };
}
