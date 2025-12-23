export interface AuthCredentials {
  apiKey: string;
  secret: string;
  passphrase: string;
}

export interface FillEvent {
  type: 'TRADE';
  trade_id: string;
  order_id: string;
  token_id: string;
  asset_id: string;
  price: string;
  size: string;
  side: 'BUY' | 'SELL';
  timestamp: string;
  fee_rate_bps?: string;
  maker_order_id?: string;
  taker_order_id?: string;
  [key: string]: unknown;
}

export interface OrderUpdateEvent {
  type: 'PLACEMENT' | 'UPDATE' | 'CANCELLATION';
  order_id: string;
  token_id?: string;
  asset_id?: string;
  price?: string;
  size?: string;
  side?: 'BUY' | 'SELL';
  status?: string;
  timestamp: string;
  [key: string]: unknown;
}

export interface BalanceUpdateEvent {
  type: 'BALANCE';
  token_id?: string;
  asset_id?: string;
  balance: string;
  timestamp: string;
  [key: string]: unknown;
}

export interface UserChannelMessage {
  type?: string;
  event_type?: string;
  trade_id?: string;
  order_id?: string;
  token_id?: string;
  asset_id?: string;
  price?: string;
  size?: string;
  side?: 'BUY' | 'SELL';
  status?: string;
  balance?: string;
  timestamp?: string;
  fee_rate_bps?: string;
  [key: string]: unknown;
}

export type FillCallback = (fill: FillEvent) => void;
export type OrderUpdateCallback = (update: OrderUpdateEvent) => void;
export type BalanceUpdateCallback = (update: BalanceUpdateEvent) => void;
export type ErrorCallback = (error: Error) => void;
export type ConnectionCallback = () => void;

const WSS_BASE_URL = 'wss://ws-subscriptions-clob.polymarket.com';
const USER_CHANNEL_PATH = '/ws/user';
const PING_INTERVAL_MS = 10000; // 10 seconds

export class UserChannel {
  private ws: WebSocket | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private subscribedMarkets: Set<string> = new Set();
  private isConnected: boolean = false;
  private isAuthenticated: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 1000;
  private authCredentials: AuthCredentials | null = null;

  private onFillCallbacks: FillCallback[] = [];
  private onOrderUpdateCallbacks: OrderUpdateCallback[] = [];
  private onBalanceUpdateCallbacks: BalanceUpdateCallback[] = [];
  private onErrorCallbacks: ErrorCallback[] = [];
  private onConnectCallbacks: ConnectionCallback[] = [];
  private onDisconnectCallbacks: ConnectionCallback[] = [];

  async connect(auth: AuthCredentials, initialMarkets?: string[]): Promise<void> {
    this.authCredentials = auth;

    return new Promise((resolve, reject) => {
      try {
        const url = `${WSS_BASE_URL}${USER_CHANNEL_PATH}`;
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
          console.log('User Channel WebSocket connected');
          this.isConnected = true;
          this.reconnectAttempts = 0;

          this.startPingInterval();

          this.authenticate(initialMarkets)
            .then(() => {
              this.onConnectCallbacks.forEach((callback) => callback());
              resolve();
            })
            .catch((error) => {
              const errorObj =
                error instanceof Error ? error : new Error(String(error));
              this.onErrorCallbacks.forEach((callback) => callback(errorObj));
              reject(errorObj);
            });
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws.onerror = (error) => {
          const errorObj = new Error(`WebSocket error: ${error}`);
          console.error('User Channel WebSocket error:', errorObj);
          this.onErrorCallbacks.forEach((callback) => callback(errorObj));
          reject(errorObj);
        };

        this.ws.onclose = (event) => {
          console.log('User Channel WebSocket closed', {
            code: event.code,
            reason: event.reason,
          });
          this.isConnected = false;
          this.isAuthenticated = false;
          this.stopPingInterval();

          this.onDisconnectCallbacks.forEach((callback) => callback());

          if (
            event.code !== 1000 &&
            this.reconnectAttempts < this.maxReconnectAttempts &&
            this.authCredentials
          ) {
            this.attemptReconnect(initialMarkets);
          }
        };
      } catch (error) {
        const errorObj =
          error instanceof Error ? error : new Error(String(error));
        this.onErrorCallbacks.forEach((callback) => callback(errorObj));
        reject(errorObj);
      }
    });
  }

  private async authenticate(markets?: string[]): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }

    if (!this.authCredentials) {
      throw new Error('Authentication credentials are not set');
    }

    const authMessage = {
      type: 'user',
      auth: {
        apiKey: this.authCredentials.apiKey,
        secret: this.authCredentials.secret,
        passphrase: this.authCredentials.passphrase,
      },
      markets: markets || [],
    };

    this.ws.send(JSON.stringify(authMessage));
    console.log('User Channel authentication sent');

    if (markets && markets.length > 0) {
      markets.forEach((market) => this.subscribedMarkets.add(market));
    }

    this.isAuthenticated = true;
  }

  subscribeToMarkets(markets: string[]): void {
    if (!this.isConnected || this.ws?.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected. Call connect() first.');
    }

    if (!this.isAuthenticated) {
      throw new Error('Not authenticated. Call connect() first.');
    }

    if (!markets || markets.length === 0) {
      throw new Error('At least one market condition ID is required');
    }

    markets.forEach((market) => this.subscribedMarkets.add(market));

    this.authenticate(Array.from(this.subscribedMarkets));
    console.log(`Subscribed to ${markets.length} market(s):`, markets);
  }

unsubscribeFromMarkets(markets: string[]): void {
    if (!this.isConnected || this.ws?.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected. Call connect() first.');
    }

    if (!this.isAuthenticated) {
      throw new Error('Not authenticated. Call connect() first.');
    }

    if (!markets || markets.length === 0) {
      throw new Error('At least one market condition ID is required');
    }

    markets.forEach((market) => this.subscribedMarkets.delete(market));

    this.authenticate(Array.from(this.subscribedMarkets));
    console.log(`Unsubscribed from ${markets.length} market(s):`, markets);
  }

  onFill(callback: FillCallback): void {
    this.onFillCallbacks.push(callback);
  }

  onOrderUpdate(callback: OrderUpdateCallback): void {
    this.onOrderUpdateCallbacks.push(callback);
  }

  onBalanceUpdate(callback: BalanceUpdateCallback): void {
    this.onBalanceUpdateCallbacks.push(callback);
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
    this.onFillCallbacks = [];
    this.onOrderUpdateCallbacks = [];
    this.onBalanceUpdateCallbacks = [];
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
    this.isAuthenticated = false;
    this.subscribedMarkets.clear();
    this.authCredentials = null;
  }

  getConnectionStatus(): boolean {
    return (
      this.isConnected &&
      this.isAuthenticated &&
      this.ws?.readyState === WebSocket.OPEN
    );
  }

  getAuthenticationStatus(): boolean {
    return this.isAuthenticated;
  }

  getSubscribedMarkets(): string[] {
    return Array.from(this.subscribedMarkets);
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

      const message: UserChannelMessage = JSON.parse(text);

      if (message.type === 'auth' || message.event_type === 'auth') {
        if (message.status === 'success' || message.status === 'ok') {
          console.log('User Channel authentication successful');
          this.isAuthenticated = true;
        } else {
          console.error('User Channel authentication failed:', message);
          this.isAuthenticated = false;
        }
        return;
      }

      if (message.type === 'TRADE' || message.event_type === 'TRADE' || message.trade_id) {
        this.handleFillEvent(message);
      }

      if (
        message.type === 'PLACEMENT' ||
        message.type === 'UPDATE' ||
        message.type === 'CANCELLATION' ||
        message.event_type === 'PLACEMENT' ||
        message.event_type === 'UPDATE' ||
        message.event_type === 'CANCELLATION'
      ) {
        this.handleOrderUpdateEvent(message);
      }

      if (message.type === 'BALANCE' || message.event_type === 'BALANCE' || message.balance) {
        this.handleBalanceUpdateEvent(message);
      }
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      console.error('Error handling WebSocket message:', errorObj);
      this.onErrorCallbacks.forEach((callback) => callback(errorObj));
    }
  }

  private handleFillEvent(message: UserChannelMessage): void {
    if (!message.trade_id || !message.order_id || !message.price || !message.size) {
      return;
    }

    const fill: FillEvent = {
      type: 'TRADE',
      trade_id: message.trade_id as string,
      order_id: message.order_id as string,
      token_id: (message.token_id as string) || (message.asset_id as string) || '',
      asset_id: (message.asset_id as string) || (message.token_id as string) || '',
      price: String(message.price),
      size: String(message.size),
      side: (message.side as 'BUY' | 'SELL') || 'BUY',
      timestamp: (message.timestamp as string) || new Date().toISOString(),
      fee_rate_bps: message.fee_rate_bps as string | undefined,
      maker_order_id: message.maker_order_id as string | undefined,
      taker_order_id: message.taker_order_id as string | undefined,
    };

    this.onFillCallbacks.forEach((callback) => callback(fill));
  }

  private handleOrderUpdateEvent(message: UserChannelMessage): void {
    if (!message.order_id) {
      return;
    }

    const eventType =
      (message.type as 'PLACEMENT' | 'UPDATE' | 'CANCELLATION') ||
      (message.event_type as 'PLACEMENT' | 'UPDATE' | 'CANCELLATION') ||
      'UPDATE';

    const update: OrderUpdateEvent = {
      type: eventType,
      order_id: message.order_id as string,
      token_id: message.token_id as string | undefined,
      asset_id: message.asset_id as string | undefined,
      price: message.price ? String(message.price) : undefined,
      size: message.size ? String(message.size) : undefined,
      side: message.side as 'BUY' | 'SELL' | undefined,
      status: message.status as string | undefined,
      timestamp: (message.timestamp as string) || new Date().toISOString(),
    };

    this.onOrderUpdateCallbacks.forEach((callback) => callback(update));
  }

  private handleBalanceUpdateEvent(message: UserChannelMessage): void {
    if (!message.balance) {
      return;
    }

    const update: BalanceUpdateEvent = {
      type: 'BALANCE',
      token_id: message.token_id as string | undefined,
      asset_id: message.asset_id as string | undefined,
      balance: String(message.balance),
      timestamp: (message.timestamp as string) || new Date().toISOString(),
    };

    this.onBalanceUpdateCallbacks.forEach((callback) => callback(update));
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

  private attemptReconnect(initialMarkets?: string[]): void {
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    console.log(
      `Attempting to reconnect to User Channel (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay}ms`
    );

    setTimeout(() => {
      if (this.authCredentials) {
        this.connect(this.authCredentials, initialMarkets).catch((error) => {
          console.error('Reconnection failed:', error);
        });
      }
    }, delay);
  }
}

export default UserChannel;
