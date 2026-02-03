import { Ticker, OrderBook } from "./gate-api";

export type WebSocketStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface TickerUpdate {
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

export interface OrderBookUpdate {
  currency_pair: string;
  asks: [string, string][];
  bids: [string, string][];
  first_update_id: number;
  last_update_id: number;
}

type MessageHandler = (data: unknown) => void;
type StatusHandler = (status: WebSocketStatus) => void;

interface Subscription {
  channel: string;
  payload: string[];
  handlers: Set<MessageHandler>;
}

class GateWebSocketManager {
  private ws: WebSocket | null = null;
  private status: WebSocketStatus = 'disconnected';
  private statusHandlers: Set<StatusHandler> = new Set();
  private subscriptions: Map<string, Subscription> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private lastDataTimestamp: number = Date.now();
  private stalenessCheckInterval: ReturnType<typeof setInterval> | null = null;
  private stalenessThreshold = 30000; // 30 seconds without data = stale

  constructor() {
    // Start staleness monitoring
    this.stalenessCheckInterval = setInterval(() => {
      this.checkStaleness();
    }, 5000);
  }

  private checkStaleness() {
    if (this.status === 'connected' && this.subscriptions.size > 0) {
      const timeSinceLastData = Date.now() - this.lastDataTimestamp;
      if (timeSinceLastData > this.stalenessThreshold) {
        console.warn(`[GateWS] Data stale for ${timeSinceLastData}ms, reconnecting...`);
        this.reconnect();
      }
    }
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      this.setStatus('connecting');
      console.log('[GateWS] Connecting to Gate.io WebSocket...');

      try {
        // Gate.io public WebSocket endpoint
        this.ws = new WebSocket('wss://api.gateio.ws/ws/v4/');

        this.ws.onopen = () => {
          console.log('[GateWS] Connected successfully');
          this.setStatus('connected');
          this.reconnectAttempts = 0;
          this.lastDataTimestamp = Date.now();
          
          // Resubscribe to all channels
          this.resubscribeAll();
          
          // Start ping interval to keep connection alive
          this.startPingInterval();
          
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event);
        };

        this.ws.onerror = (error) => {
          console.error('[GateWS] WebSocket error:', error);
          this.setStatus('error');
        };

        this.ws.onclose = (event) => {
          console.log(`[GateWS] Connection closed: ${event.code} ${event.reason}`);
          this.setStatus('disconnected');
          this.stopPingInterval();
          
          // Auto-reconnect if not intentionally closed
          if (event.code !== 1000) {
            this.scheduleReconnect();
          }
        };
      } catch (error) {
        console.error('[GateWS] Failed to create WebSocket:', error);
        this.setStatus('error');
        reject(error);
      }
    });
  }

  private handleMessage(event: MessageEvent) {
    try {
      const data = JSON.parse(event.data);
      this.lastDataTimestamp = Date.now();
      
      // Handle ping/pong
      if (data.channel === 'spot.ping') {
        this.sendPong(data.time);
        return;
      }

      // Handle subscription acknowledgment
      if (data.event === 'subscribe') {
        console.log(`[GateWS] Subscribed to ${data.channel}:`, data.result?.status);
        return;
      }

      // Handle updates
      if (data.event === 'update' && data.result) {
        const channelKey = this.getChannelKey(data.channel, data.result.currency_pair || '');
        const subscription = this.subscriptions.get(channelKey);
        
        if (subscription) {
          subscription.handlers.forEach(handler => {
            try {
              handler(data.result);
            } catch (err) {
              console.error('[GateWS] Handler error:', err);
            }
          });
        }
      }
    } catch (error) {
      console.error('[GateWS] Failed to parse message:', error);
    }
  }

  private sendPong(time: number) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        time: Math.floor(Date.now() / 1000),
        channel: 'spot.pong'
      }));
    }
  }

  private startPingInterval() {
    this.stopPingInterval();
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          time: Math.floor(Date.now() / 1000),
          channel: 'spot.ping'
        }));
      }
    }, 20000); // Ping every 20 seconds
  }

  private stopPingInterval() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[GateWS] Max reconnect attempts reached');
      this.setStatus('error');
      return;
    }

    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts), 30000);
    console.log(`[GateWS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect().catch(console.error);
    }, delay);
  }

  private reconnect() {
    this.ws?.close();
    this.connect().catch(console.error);
  }

  private resubscribeAll() {
    this.subscriptions.forEach((subscription, key) => {
      this.sendSubscription(subscription.channel, subscription.payload);
    });
  }

  private sendSubscription(channel: string, payload: string[]) {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      console.warn('[GateWS] Cannot subscribe, WebSocket not open');
      return;
    }

    const message = {
      time: Math.floor(Date.now() / 1000),
      channel,
      event: 'subscribe',
      payload
    };

    console.log('[GateWS] Subscribing:', message);
    this.ws.send(JSON.stringify(message));
  }

  private sendUnsubscription(channel: string, payload: string[]) {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      return;
    }

    const message = {
      time: Math.floor(Date.now() / 1000),
      channel,
      event: 'unsubscribe',
      payload
    };

    this.ws.send(JSON.stringify(message));
  }

  private getChannelKey(channel: string, pair: string): string {
    return `${channel}:${pair}`;
  }

  private setStatus(status: WebSocketStatus) {
    this.status = status;
    this.statusHandlers.forEach(handler => handler(status));
  }

  getStatus(): WebSocketStatus {
    return this.status;
  }

  onStatusChange(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  // Subscribe to ticker updates for multiple pairs
  subscribeTickers(pairs: string[], handler: MessageHandler): () => void {
    // Gate.io uses spot.tickers for multiple pairs
    const channel = 'spot.tickers';
    const key = this.getChannelKey(channel, pairs.join(','));

    let subscription = this.subscriptions.get(key);
    if (!subscription) {
      subscription = {
        channel,
        payload: pairs,
        handlers: new Set()
      };
      this.subscriptions.set(key, subscription);
      
      // Connect and subscribe if needed
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.sendSubscription(channel, pairs);
      } else {
        this.connect().then(() => {
          this.sendSubscription(channel, pairs);
        }).catch(console.error);
      }
    }

    subscription.handlers.add(handler);

    return () => {
      subscription!.handlers.delete(handler);
      if (subscription!.handlers.size === 0) {
        this.subscriptions.delete(key);
        this.sendUnsubscription(channel, pairs);
      }
    };
  }

  // Subscribe to order book updates for a single pair
  subscribeOrderBook(pair: string, handler: MessageHandler): () => void {
    const channel = 'spot.order_book_update';
    const key = this.getChannelKey(channel, pair);

    let subscription = this.subscriptions.get(key);
    if (!subscription) {
      subscription = {
        channel,
        payload: [pair, '20', '100ms'], // pair, depth, interval
        handlers: new Set()
      };
      this.subscriptions.set(key, subscription);

      if (this.ws?.readyState === WebSocket.OPEN) {
        this.sendSubscription(channel, subscription.payload);
      } else {
        this.connect().then(() => {
          this.sendSubscription(channel, subscription!.payload);
        }).catch(console.error);
      }
    }

    subscription.handlers.add(handler);

    return () => {
      subscription!.handlers.delete(handler);
      if (subscription!.handlers.size === 0) {
        this.subscriptions.delete(key);
        this.sendUnsubscription(channel, subscription!.payload);
      }
    };
  }

  disconnect() {
    this.stopPingInterval();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.stalenessCheckInterval) {
      clearInterval(this.stalenessCheckInterval);
      this.stalenessCheckInterval = null;
    }
    this.subscriptions.clear();
    this.ws?.close(1000);
    this.ws = null;
    this.setStatus('disconnected');
  }
}

// Singleton instance
export const gateWebSocket = new GateWebSocketManager();
