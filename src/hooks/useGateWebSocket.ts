import { useState, useEffect, useCallback, useRef } from 'react';
import { gateWebSocket, WebSocketStatus, TickerUpdate, OrderBookUpdate } from '@/lib/gate-websocket';
import { Ticker, OrderBook } from '@/lib/gate-api';

// Hook for WebSocket connection status
export function useWebSocketStatus() {
  const [status, setStatus] = useState<WebSocketStatus>(gateWebSocket.getStatus());

  useEffect(() => {
    const unsubscribe = gateWebSocket.onStatusChange(setStatus);
    return unsubscribe;
  }, []);

  return status;
}

// Hook for real-time ticker data
export function useRealtimeTickers(pairs: string[]) {
  const [tickers, setTickers] = useState<Map<string, Ticker>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const pairsRef = useRef(pairs);

  // Update ref when pairs change
  useEffect(() => {
    pairsRef.current = pairs;
  }, [pairs]);

  useEffect(() => {
    if (pairs.length === 0) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    const handleUpdate = (data: unknown) => {
      const update = data as TickerUpdate;
      
      setTickers(prev => {
        const next = new Map(prev);
        next.set(update.currency_pair, {
          currency_pair: update.currency_pair,
          last: update.last,
          lowest_ask: update.lowest_ask,
          highest_bid: update.highest_bid,
          change_percentage: update.change_percentage,
          base_volume: update.base_volume,
          quote_volume: update.quote_volume,
          high_24h: update.high_24h,
          low_24h: update.low_24h,
        });
        return next;
      });
      
      setIsLoading(false);
    };

    const unsubscribe = gateWebSocket.subscribeTickers(pairs, handleUpdate);

    return () => {
      unsubscribe();
    };
  }, [pairs.join(',')]); // Only resubscribe when pairs actually change

  const tickersArray = Array.from(tickers.values());

  return {
    data: tickersArray.length > 0 ? tickersArray : undefined,
    isLoading,
    error,
    status: useWebSocketStatus(),
  };
}

// Hook for real-time order book data
export function useRealtimeOrderBook(pair: string, enabled = true) {
  const [orderBook, setOrderBook] = useState<OrderBook | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!enabled || !pair) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    const handleUpdate = (data: unknown) => {
      const update = data as OrderBookUpdate;
      
      setOrderBook({
        asks: update.asks || [],
        bids: update.bids || [],
      });
      
      setIsLoading(false);
    };

    const unsubscribe = gateWebSocket.subscribeOrderBook(pair, handleUpdate);

    return () => {
      unsubscribe();
    };
  }, [pair, enabled]);

  return {
    data: orderBook,
    isLoading,
    error,
  };
}

// Combined hook that provides both polling and WebSocket options
export function useTickersWithFallback(pairs: string[], useWebSocket = true) {
  const wsData = useRealtimeTickers(pairs);
  
  // If WebSocket is disabled or errored, the component can fall back to polling
  // by using the original useTickers hook
  
  if (!useWebSocket) {
    return { ...wsData, isWebSocket: false };
  }
  
  return { ...wsData, isWebSocket: true };
}
