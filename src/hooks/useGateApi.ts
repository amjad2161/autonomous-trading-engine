import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getSpotBalances,
  getTickers,
  getOrderBook,
  getOpenOrders,
  placeOrder,
  cancelOrder,
  cancelAllOrders,
  getCurrencyPairs,
  SpotBalance,
  Ticker,
  OrderBook,
  OpenOrder,
} from "@/lib/gate-api";

// Balances
export function useSpotBalances() {
  return useQuery({
    queryKey: ['gate', 'balances'],
    queryFn: getSpotBalances,
    refetchInterval: 5000, // Refresh every 5 seconds
    retry: 2,
  });
}

// Tickers
export function useTickers(pairs?: string[]) {
  return useQuery({
    queryKey: ['gate', 'tickers', pairs],
    queryFn: () => getTickers(pairs),
    refetchInterval: 2000, // Refresh every 2 seconds for real-time data
    retry: 2,
  });
}

// Order Book
export function useOrderBook(pair: string, limit = 20) {
  return useQuery({
    queryKey: ['gate', 'orderbook', pair, limit],
    queryFn: () => getOrderBook(pair, limit),
    refetchInterval: 1000, // Very frequent for order book
    enabled: !!pair,
    retry: 2,
  });
}

// Currency Pairs
export function useCurrencyPairs() {
  return useQuery({
    queryKey: ['gate', 'pairs'],
    queryFn: getCurrencyPairs,
    staleTime: 1000 * 60 * 60, // Cache for 1 hour
    retry: 2,
  });
}

// Open Orders - Gate.io requires currency_pair parameter
// When pair is not provided, the query is disabled
export function useOpenOrders(pair?: string) {
  return useQuery({
    queryKey: ['gate', 'orders', pair],
    queryFn: () => getOpenOrders(pair!),
    refetchInterval: 3000,
    retry: 2,
    enabled: !!pair, // Only fetch when pair is provided
  });
}

// Place Order mutation
export function usePlaceOrder() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ pair, side, amount, price, type }: {
      pair: string;
      side: 'buy' | 'sell';
      amount: string;
      price: string;
      type?: 'limit' | 'market';
    }) => placeOrder(pair, side, amount, price, type),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gate', 'orders'] });
      queryClient.invalidateQueries({ queryKey: ['gate', 'balances'] });
    },
  });
}

// Cancel Order mutation
export function useCancelOrder() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ orderId, pair }: { orderId: string; pair: string }) => 
      cancelOrder(orderId, pair),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gate', 'orders'] });
      queryClient.invalidateQueries({ queryKey: ['gate', 'balances'] });
    },
  });
}

// Cancel All Orders mutation
export function useCancelAllOrders() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (pair?: string) => cancelAllOrders(pair),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gate', 'orders'] });
      queryClient.invalidateQueries({ queryKey: ['gate', 'balances'] });
    },
  });
}

// Computed values
export function useUSDTBalance(balances?: SpotBalance[]) {
  if (!balances) return { available: 0, locked: 0, total: 0 };
  
  const usdt = balances.find(b => b.currency === 'USDT');
  const available = parseFloat(usdt?.available || '0');
  const locked = parseFloat(usdt?.locked || '0');
  
  return {
    available,
    locked,
    total: available + locked,
  };
}

export function useTotalPortfolioValue(balances?: SpotBalance[], tickers?: Ticker[]) {
  if (!balances || !tickers) return 0;
  
  let total = 0;
  
  for (const balance of balances) {
    const available = parseFloat(balance.available);
    const locked = parseFloat(balance.locked);
    const amount = available + locked;
    
    if (amount === 0) continue;
    
    if (balance.currency === 'USDT') {
      total += amount;
    } else {
      const ticker = tickers.find(t => t.currency_pair === `${balance.currency}_USDT`);
      if (ticker) {
        total += amount * parseFloat(ticker.last);
      }
    }
  }
  
  return total;
}

// Calculate Daily P&L based on 24h price changes
export function useDailyPnL(balances?: SpotBalance[], tickers?: Ticker[]) {
  if (!balances || !tickers) return { amount: 0, percent: 0 };
  
  let totalPnL = 0;
  let totalCurrentValue = 0;
  
  for (const balance of balances) {
    const available = parseFloat(balance.available);
    const locked = parseFloat(balance.locked);
    const amount = available + locked;
    
    if (amount === 0) continue;
    
    if (balance.currency === 'USDT') {
      // USDT doesn't change in value
      totalCurrentValue += amount;
    } else {
      const ticker = tickers.find(t => t.currency_pair === `${balance.currency}_USDT`);
      if (ticker) {
        const currentPrice = parseFloat(ticker.last);
        const changePercent = parseFloat(ticker.change_percentage);
        const currentValue = amount * currentPrice;
        
        // Calculate value 24h ago: currentValue / (1 + changePercent/100)
        const value24hAgo = currentValue / (1 + changePercent / 100);
        const pnl = currentValue - value24hAgo;
        
        totalPnL += pnl;
        totalCurrentValue += currentValue;
      }
    }
  }
  
  const pnlPercent = totalCurrentValue > 0 ? (totalPnL / (totalCurrentValue - totalPnL)) * 100 : 0;
  
  return {
    amount: totalPnL,
    percent: pnlPercent,
  };
}
