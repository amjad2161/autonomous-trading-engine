import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface SystemState {
  id: string;
  is_active: boolean;
  started_at: string;
  last_heartbeat: string;
  total_cycles: number;
  total_trades: number;
  successful_trades: number;
  total_pnl: number;
  current_balance: number;
  settings: Record<string, unknown>;
}

export interface TradeHistoryItem {
  id: string;
  order_id: string;
  symbol: string;
  side: string;
  type: string;
  amount: number;
  price: number;
  expected_edge: number;
  actual_pnl: number;
  status: string;
  error: string;
  executed_at: string;
}

export interface SystemLogItem {
  id: string;
  level: string;
  component: string;
  message: string;
  details: unknown;
  created_at: string;
}

export function useAutonomousSystem() {
  const [state, setState] = useState<SystemState | null>(null);
  const [trades, setTrades] = useState<TradeHistoryItem[]>([]);
  const [logs, setLogs] = useState<SystemLogItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch current state
  const fetchState = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke('autonomous-orchestrator', {
        body: { command: 'status' },
      });
      
      if (error) throw error;
      
      if (data.state) {
        setState(data.state);
      }
      if (data.recentTrades) {
        setTrades(data.recentTrades);
      }
      if (data.recentLogs) {
        setLogs(data.recentLogs);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch state');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Start the system
  const start = useCallback(async () => {
    try {
      setIsLoading(true);
      
      // Start the orchestrator
      await supabase.functions.invoke('autonomous-orchestrator', {
        body: { command: 'start' },
      });
      
      // Start the scheduler for 10 minutes (will need to be re-triggered)
      await supabase.functions.invoke('scheduler', {
        body: { durationMinutes: 10, intervalSeconds: 30 },
      });
      
      await fetchState();
      return { success: true };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start');
      return { success: false, error: err };
    } finally {
      setIsLoading(false);
    }
  }, [fetchState]);

  // Stop the system
  const stop = useCallback(async () => {
    try {
      setIsLoading(true);
      
      await supabase.functions.invoke('autonomous-orchestrator', {
        body: { command: 'stop' },
      });
      
      await fetchState();
      return { success: true };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop');
      return { success: false, error: err };
    } finally {
      setIsLoading(false);
    }
  }, [fetchState]);

  // Run a single cycle manually
  const runCycle = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke('autonomous-orchestrator', {
        body: { command: 'cycle' },
      });
      
      if (error) throw error;
      
      await fetchState();
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run cycle');
      throw err;
    }
  }, [fetchState]);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    fetchState();
    const interval = setInterval(fetchState, 10000);
    return () => clearInterval(interval);
  }, [fetchState]);

  return {
    state,
    trades,
    logs,
    isLoading,
    error,
    start,
    stop,
    runCycle,
    refresh: fetchState,
  };
}
