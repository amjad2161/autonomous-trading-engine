import { useState, useEffect, useCallback, useRef } from 'react';
import { gateWebSocket, TickerUpdate } from '@/lib/gate-websocket';
import { supabase } from '@/integrations/supabase/client';

export interface TickScalpingState {
  isActive: boolean;
  ticksProcessed: number;
  tradesExecuted: number;
  pnlTotal: number;
  activePositions: string[];
  lastTick: { pair: string; price: number; action: string } | null;
  errors: string[];
}

export interface TickScalpingConfig {
  pairs: string[];
  maxPositions: number;
  balance: number;
}

export function useTickScalping(config: TickScalpingConfig) {
  const [state, setState] = useState<TickScalpingState>({
    isActive: false,
    ticksProcessed: 0,
    tradesExecuted: 0,
    pnlTotal: 0,
    activePositions: [],
    lastTick: null,
    errors: [],
  });
  
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const tickQueueRef = useRef<Map<string, TickerUpdate>>(new Map());
  const processingRef = useRef(false);
  
  // Process tick through edge function
  const processTick = useCallback(async (tick: TickerUpdate) => {
    try {
      const { data, error } = await supabase.functions.invoke('tick-processor', {
        body: {
          tick: {
            pair: tick.currency_pair,
            price: tick.last,
            bid: tick.highest_bid,
            ask: tick.lowest_ask,
            volume: tick.quote_volume,
            timestamp: Date.now(),
          },
          balance: config.balance,
        },
      });
      
      if (error) throw error;
      
      setState(prev => ({
        ...prev,
        ticksProcessed: prev.ticksProcessed + 1,
        lastTick: {
          pair: tick.currency_pair,
          price: parseFloat(tick.last),
          action: data.action,
        },
        ...(data.executed && {
          tradesExecuted: prev.tradesExecuted + 1,
          pnlTotal: prev.pnlTotal + (data.pnl || 0),
        }),
        activePositions: data.activeScalps || prev.activePositions,
      }));
      
      return data;
    } catch (err) {
      console.error('[TickScalping] Error processing tick:', err);
      setState(prev => ({
        ...prev,
        errors: [...prev.errors.slice(-9), err instanceof Error ? err.message : 'Unknown error'],
      }));
      return null;
    }
  }, [config.balance]);
  
  // Batch process ticks (avoid overwhelming the edge function)
  const processTickQueue = useCallback(async () => {
    if (processingRef.current || tickQueueRef.current.size === 0) return;
    
    processingRef.current = true;
    
    try {
      // Process one tick per pair at a time
      const promises = Array.from(tickQueueRef.current.values()).map(tick => processTick(tick));
      tickQueueRef.current.clear();
      
      await Promise.all(promises);
    } finally {
      processingRef.current = false;
    }
  }, [processTick]);
  
  // Handle incoming tick
  const handleTick = useCallback((update: unknown) => {
    const tick = update as TickerUpdate;
    if (!tick.currency_pair) return;
    
    // Queue the latest tick for each pair
    tickQueueRef.current.set(tick.currency_pair, tick);
  }, []);
  
  // Start tick scalping
  const start = useCallback(async () => {
    if (state.isActive) return;
    
    console.log('[TickScalping] Starting with pairs:', config.pairs);
    
    // Connect to WebSocket
    await gateWebSocket.connect();
    
    // Subscribe to tickers
    unsubscribeRef.current = gateWebSocket.subscribeTickers(config.pairs, handleTick);
    
    // Start processing loop
    const interval = setInterval(processTickQueue, 500); // Process every 500ms
    
    setState(prev => ({
      ...prev,
      isActive: true,
      errors: [],
    }));
    
    // Store interval for cleanup
    (window as unknown as { tickScalpingInterval: NodeJS.Timeout }).tickScalpingInterval = interval;
  }, [state.isActive, config.pairs, handleTick, processTickQueue]);
  
  // Stop tick scalping
  const stop = useCallback(() => {
    if (!state.isActive) return;
    
    console.log('[TickScalping] Stopping...');
    
    // Unsubscribe from tickers
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
    
    // Clear processing interval
    const interval = (window as unknown as { tickScalpingInterval: NodeJS.Timeout }).tickScalpingInterval;
    if (interval) {
      clearInterval(interval);
    }
    
    tickQueueRef.current.clear();
    
    setState(prev => ({
      ...prev,
      isActive: false,
    }));
  }, [state.isActive]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);
  
  return {
    state,
    start,
    stop,
    isConnected: gateWebSocket.getStatus() === 'connected',
  };
}
