import { supabase } from "@/integrations/supabase/client";

export interface SpotBalance {
  currency: string;
  available: string;
  locked: string;
}

export interface Ticker {
  currency_pair: string;
  last: string;
  lowest_ask: string;
  highest_bid: string;
  change_percentage: string;
  base_volume: string;
  quote_volume: string;
  high_24h: string;
  low_24h: string;
}

export interface OrderBook {
  asks: [string, string][];
  bids: [string, string][];
}

export interface OpenOrder {
  id: string;
  currency_pair: string;
  side: 'buy' | 'sell';
  amount: string;
  price: string;
  left: string;
  filled_total: string;
  status: string;
  create_time: string;
}

async function callGateApi<T>(
  endpoint: string,
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
  params: Record<string, string> = {},
  body?: Record<string, unknown>
): Promise<T> {
  const { data, error } = await supabase.functions.invoke('gate-api', {
    body: { endpoint, method, params, body }
  });

  if (error) {
    throw new Error(`API call failed: ${error.message}`);
  }

  if (data.error) {
    throw new Error(data.error);
  }

  return data as T;
}

// Account endpoints
export async function getSpotBalances(): Promise<SpotBalance[]> {
  return callGateApi<SpotBalance[]>('/spot/accounts');
}

export async function getTotalBalance(): Promise<{ total: { amount: string; currency: string }[] }> {
  return callGateApi('/wallet/total_balance');
}

// Market data endpoints
export async function getTickers(pairs?: string[]): Promise<Ticker[]> {
  const params: Record<string, string> = {};
  if (pairs && pairs.length > 0) {
    params.currency_pair = pairs.join(',');
  }
  return callGateApi<Ticker[]>('/spot/tickers', 'GET', params);
}

export async function getOrderBook(pair: string, limit = 20): Promise<OrderBook> {
  return callGateApi<OrderBook>(`/spot/order_book`, 'GET', { 
    currency_pair: pair, 
    limit: limit.toString() 
  });
}

export async function getCurrencyPairs(): Promise<{ id: string; base: string; quote: string; trade_status: string }[]> {
  return callGateApi('/spot/currency_pairs');
}

// Trading endpoints
export async function getOpenOrders(pair?: string): Promise<OpenOrder[]> {
  const params: Record<string, string> = { status: 'open' };
  if (pair) {
    params.currency_pair = pair;
  }
  return callGateApi<OpenOrder[]>('/spot/orders', 'GET', params);
}

export async function placeOrder(
  pair: string,
  side: 'buy' | 'sell',
  amount: string,
  price: string,
  type: 'limit' | 'market' = 'limit'
): Promise<{ id: string }> {
  return callGateApi<{ id: string }>('/spot/orders', 'POST', {}, {
    currency_pair: pair,
    side,
    amount,
    price,
    type,
    time_in_force: 'gtc',
  });
}

export async function cancelOrder(orderId: string, pair: string): Promise<void> {
  await callGateApi(`/spot/orders/${orderId}`, 'DELETE', { currency_pair: pair });
}

export async function cancelAllOrders(pair?: string): Promise<void> {
  const params: Record<string, string> = {};
  if (pair) {
    params.currency_pair = pair;
  }
  await callGateApi('/spot/orders', 'DELETE', params);
}

// Utility functions
export function formatUSDT(value: string | number): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

export function formatCrypto(value: string | number, decimals = 8): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

export function formatPercentage(value: string | number): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  const sign = num >= 0 ? '+' : '';
  return `${sign}${num.toFixed(2)}%`;
}
