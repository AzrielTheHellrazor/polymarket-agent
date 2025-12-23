export interface OrderBookLevel {
  price: string;
  size: string;
}

export interface OrderBookUpdate {
  asset_id: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  timestamp?: string;
}

export interface MarketTrade {
  asset_id: string;
  trade_id: string;
  price: string;
  size: string;
  side: 'buy' | 'sell';
  timestamp: string;
  taker_order_id?: string;
  maker_order_id?: string;
}

export interface MarketChannelMessage {
  type?: string;
  event_type?: string;
  asset_id?: string;
  bids?: OrderBookLevel[];
  asks?: OrderBookLevel[];
  trade_id?: string;
  price?: string;
  size?: string;
  side?: 'buy' | 'sell';
  timestamp?: string;
  [key: string]: unknown;
}

export type OrderBookUpdateCallback = (update: OrderBookUpdate) => void;
export type TradeCallback = (trade: MarketTrade) => void;
export type ErrorCallback = (error: Error) => void;
export type ConnectionCallback = () => void;

const WSS_BASE_URL = 'wss://ws-subscriptions-clob.polymarket.com';
const MARKET_CHANNEL_PATH = '/ws/market';
const PING_INTERVAL_MS = 10000; // 10 seconds

export class MarketChannel {
  private ws: WebSocket | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private subscribedAssets: Set<string> = new Set();
  private isConnected: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 1000;

  private onOrderBookUpdateCallbacks: OrderBookUpdateCallback[] = [];
  private onTradeCallbacks: TradeCallback[] = [];
  private onErrorCallbacks: ErrorCallback[] = [];
  private onConnectCallbacks: ConnectionCallback[] = [];
  private onDisconnectCallbacks: ConnectionCallback[] = [];

  async connect(initialAssetIds?: string[]): Promise<void> {
    if (this.isConnected && this.ws?.readyState === WebSocket.OPEN) {
      console.warn('Market Channel already connected');
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        const url = `${WSS_BASE_URL}${MARKET_CHANNEL_PATH}`;
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
          console.log('Market Channel WebSocket connected');
          this.isConnected = true;
          this.reconnectAttempts = 0;

          this.startPingInterval();

          if (initialAssetIds && initialAssetIds.length > 0) {
            this.subscribe(initialAssetIds);
          }

          this.onConnectCallbacks.forEach((callback) => callback());

          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws.onerror = (error) => {
          const errorObj = new Error(`WebSocket error: ${error}`);
          console.error('Market Channel WebSocket error:', errorObj);
          this.onErrorCallbacks.forEach((callback) => callback(errorObj));
          reject(errorObj);
        };

        this.ws.onclose = (event) => {
          console.log('Market Channel WebSocket closed', {
            code: event.code,
            reason: event.reason,
          });
          this.isConnected = false;
          this.stopPingInterval();

          this.onDisconnectCallbacks.forEach((callback) => callback());

          if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.attemptReconnect(initialAssetIds);
          }
        };
      } catch (error) {
        const errorObj = error instanceof Error ? error : new Error(String(error));
        this.onErrorCallbacks.forEach((callback) => callback(errorObj));
        reject(errorObj);
      }
    });
  }

  subscribe(assetIds: string[]): void {
    if (!this.isConnected || this.ws?.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected. Call connect() first.');
    }

    if (!assetIds || assetIds.length === 0) {
      throw new Error('At least one asset ID is required');
    }

    assetIds.forEach((id) => this.subscribedAssets.add(id));

    const message = {
      assets_ids: assetIds,
      operation: 'subscribe',
    };

    this.ws.send(JSON.stringify(message));
    console.log(`Subscribed to ${assetIds.length} asset(s):`, assetIds);
  }

  unsubscribe(assetIds: string[]): void {
    if (!this.isConnected || this.ws?.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected. Call connect() first.');
    }

    if (!assetIds || assetIds.length === 0) {
      throw new Error('At least one asset ID is required');
    }

    assetIds.forEach((id) => this.subscribedAssets.delete(id));

    const message = {
      assets_ids: assetIds,
      operation: 'unsubscribe',
    };

    this.ws.send(JSON.stringify(message));
    console.log(`Unsubscribed from ${assetIds.length} asset(s):`, assetIds);
  }

  onOrderBookUpdate(callback: OrderBookUpdateCallback): void {
    this.onOrderBookUpdateCallbacks.push(callback);
  }

  onTrade(callback: TradeCallback): void {
    this.onTradeCallbacks.push(callback);
  }

  onError(callback: ErrorCallback): void {
    this.onErrorCallbacks.push(callback);
  }

  onConnect(callback: ConnectionCallback): void {
    this.onConnectCallbacks.push(callback);
  }

  onDisconnect(callback: ConnectionCallback): void {
    this.onDisconnectCallbacks.push(callback);
  }

  removeAllCallbacks(): void {
    this.onOrderBookUpdateCallbacks = [];
    this.onTradeCallbacks = [];
    this.onErrorCallbacks = [];
    this.onConnectCallbacks = [];
    this.onDisconnectCallbacks = [];
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    this.stopPingInterval();
    this.isConnected = false;
    this.subscribedAssets.clear();
  }

  getConnectionStatus(): boolean {
    return this.isConnected && this.ws?.readyState === WebSocket.OPEN;
  }

  getSubscribedAssets(): string[] {
    return Array.from(this.subscribedAssets);
  }

  private handleMessage(data: string | Blob): void {
    try {
      if (data === 'PING' || data === 'PONG') {
        return;
      }

      const text = typeof data === 'string' ? data : '';
      if (!text) {
        return;
      }

      const message: MarketChannelMessage = JSON.parse(text);

      if (message.bids || message.asks) {
        this.handleOrderBookUpdate(message);
      }

      if (message.trade_id || message.event_type === 'trade') {
        this.handleTrade(message);
      }
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      console.error('Error handling WebSocket message:', errorObj);
      this.onErrorCallbacks.forEach((callback) => callback(errorObj));
    }
  }

  private handleOrderBookUpdate(message: MarketChannelMessage): void {
    if (!message.asset_id) {
      return;
    }

    const update: OrderBookUpdate = {
      asset_id: message.asset_id,
      bids: message.bids || [],
      asks: message.asks || [],
      timestamp: message.timestamp as string | undefined,
    };

    this.onOrderBookUpdateCallbacks.forEach((callback) => callback(update));
  }

  private handleTrade(message: MarketChannelMessage): void {
    if (!message.asset_id || !message.price || !message.size) {
      return;
    }

    const trade: MarketTrade = {
      asset_id: message.asset_id,
      trade_id: (message.trade_id as string) || (message.id as string) || '',
      price: String(message.price),
      size: String(message.size),
      side: (message.side as 'buy' | 'sell') || 'buy',
      timestamp: (message.timestamp as string) || new Date().toISOString(),
      taker_order_id: message.taker_order_id as string | undefined,
      maker_order_id: message.maker_order_id as string | undefined,
    };

    this.onTradeCallbacks.forEach((callback) => callback(trade));
  }

  private startPingInterval(): void {
    this.stopPingInterval();

    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send('PING');
      }
    }, PING_INTERVAL_MS);
  }

  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private attemptReconnect(initialAssetIds?: string[]): void {
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    console.log(
      `Attempting to reconnect to Market Channel (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay}ms`
    );

    setTimeout(() => {
      this.connect(initialAssetIds).catch((error) => {
        console.error('Reconnection failed:', error);
      });
    }, delay);
  }
}

export default MarketChannel;

