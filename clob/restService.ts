// ============================================================================
// Type Definitions
// ============================================================================

export interface OrderBookLevel {
  price: string;
  size: string;
}

export interface OrderBook {
  market: string;
  asset_id: string;
  timestamp: string;
  hash: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  min_order_size: string;
  tick_size: string;
  neg_risk: boolean;
}

export interface MakerOrder {
  order_id: string;
  maker_address: string;
  owner: string;
  matched_amount: string;
  fee_rate_bps: string;
  price: string;
  asset_id: string;
  outcome: string;
  side: 'buy' | 'sell';
}

export interface Trade {
  id: string;
  taker_order_id: string;
  market: string;
  asset_id: string;
  side: 'buy' | 'sell';
  size: string;
  fee_rate_bps: string;
  price: string;
  status: string;
  match_time: string;
  last_update: string;
  outcome: string;
  maker_address: string;
  owner: string;
  transaction_hash: string;
  bucket_index: number;
  maker_orders: MakerOrder[];
  type: 'TAKER' | 'MAKER';
}

export interface PriceHistoryPoint {
  t: number; // Unix timestamp
  p: number; // Price
}

export interface PriceHistory {
  history: PriceHistoryPoint[];
}

export interface SpreadRequest {
  token_id: string;
  side?: 'BUY' | 'SELL';
}

export interface SpreadResponse {
  [token_id: string]: string; // Map of token_id to spread value
}

export interface GetTradesOptions {
  id?: string;
  taker?: string;
  maker?: string;
  market?: string;
  before?: string; // Unix timestamp
  after?: string; // Unix timestamp
}

export interface GetHistoricalPricesOptions {
  startTs?: number; // Unix timestamp
  endTs?: number; // Unix timestamp
  interval?: '1m' | '6h' | '1h' | '1d' | '1w' | 'max';
  fidelity?: number; // Resolution in minutes
}

// ============================================================================
// CLOB API Base URL
// ============================================================================

const CLOB_API_BASE_URL = 'https://clob.polymarket.com';

// ============================================================================
// Helper Functions
// ============================================================================

async function fetchWithErrorHandling<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(url, options);

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(
      `CLOB API request failed: ${response.status} ${response.statusText}. ${errorText}`
    );
  }

  return response.json() as T;
}

// ============================================================================
// CLOB REST API Functions
// ============================================================================

/**
 * Get order book snapshot for a specific token
 * @param tokenID - The unique identifier for the token
 * @returns Order book snapshot with bids, asks, and market information
 * @see https://docs.polymarket.com/api-reference/orderbook/get-order-book-summary
 */
export async function getOrderBook(tokenID: string): Promise<OrderBook> {
  if (!tokenID || tokenID.trim().length === 0) {
    throw new Error('Token ID is required');
  }

  const url = new URL(`${CLOB_API_BASE_URL}/book`);
  url.searchParams.set('token_id', tokenID);

  return fetchWithErrorHandling<OrderBook>(url.toString());
}

/**
 * Get recent trades for a specific token or user
 * @param options - Trade filter options (tokenID can be passed as market)
 * @param limit - Optional limit for number of trades (not in API, but useful for filtering)
 * @returns Array of trades
 * @see https://docs.polymarket.com/developers/CLOB/trades/trades
 * @note This endpoint requires L2 Header (authentication)
 */
export async function getRecentTrades(
  tokenID?: string,
  options?: GetTradesOptions & { limit?: number }
): Promise<Trade[]> {
  const url = new URL(`${CLOB_API_BASE_URL}/data/trades`);

  // If tokenID is provided, use it as market parameter
  const market = options?.market || tokenID;
  if (market) {
    url.searchParams.set('market', market);
  }

  // Add other filter options
  if (options) {
    const { id, taker, maker, before, after } = options;
    
    if (id) {
      url.searchParams.set('id', id);
    }
    if (taker) {
      url.searchParams.set('taker', taker);
    }
    if (maker) {
      url.searchParams.set('maker', maker);
    }
    if (before) {
      url.searchParams.set('before', before);
    }
    if (after) {
      url.searchParams.set('after', after);
    }
  }

  const trades = await fetchWithErrorHandling<Trade[]>(url.toString());
  
  // Apply limit if provided (client-side filtering)
  if (options?.limit && options.limit > 0) {
    return trades.slice(0, options.limit);
  }

  return trades;
}

/**
 * Get historical price data for a traded token
 * @param tokenID - The CLOB token ID (market parameter)
 * @param options - Optional time range and interval parameters
 * @returns Historical price data with timestamps and prices
 * @see https://docs.polymarket.com/api-reference/pricing/get-price-history-for-a-traded-token
 */
export async function getHistoricalPrices(
  tokenID: string,
  options?: GetHistoricalPricesOptions
): Promise<PriceHistory> {
  if (!tokenID || tokenID.trim().length === 0) {
    throw new Error('Token ID is required');
  }

  const url = new URL(`${CLOB_API_BASE_URL}/prices-history`);
  url.searchParams.set('market', tokenID);

  if (options) {
    const { startTs, endTs, interval, fidelity } = options;

    if (startTs !== undefined) {
      url.searchParams.set('startTs', startTs.toString());
    }
    if (endTs !== undefined) {
      url.searchParams.set('endTs', endTs.toString());
    }
    if (interval) {
      url.searchParams.set('interval', interval);
    }
    if (fidelity !== undefined) {
      url.searchParams.set('fidelity', fidelity.toString());
    }
  }

  return fetchWithErrorHandling<PriceHistory>(url.toString());
}

/**
 * Get best bid/ask prices (spreads) for one or more tokens
 * @param tokenIDs - Array of token IDs to get spreads for
 * @param side - Optional side parameter (BUY or SELL)
 * @returns Map of token_id to spread value
 * @see https://docs.polymarket.com/api-reference/spreads/get-bid-ask-spreads
 */
export async function getBestBidAsk(
  tokenIDs: string | string[],
  side?: 'BUY' | 'SELL'
): Promise<SpreadResponse> {
  const tokens = Array.isArray(tokenIDs) ? tokenIDs : [tokenIDs];

  if (tokens.length === 0) {
    throw new Error('At least one token ID is required');
  }

  if (tokens.length > 500) {
    throw new Error('Maximum 500 token IDs allowed per request');
  }

  const body: SpreadRequest[] = tokens.map((tokenID) => {
    const request: SpreadRequest = { token_id: tokenID };
    if (side) {
      request.side = side;
    }
    return request;
  });

  return fetchWithErrorHandling<SpreadResponse>(
    `${CLOB_API_BASE_URL}/spreads`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );
}

/**
 * Get best bid/ask for a single token (convenience function)
 * @param tokenID - The unique identifier for the token
 * @param side - Optional side parameter (BUY or SELL)
 * @returns Spread value as a string
 */
export async function getBestBidAskSingle(
  tokenID: string,
  side?: 'BUY' | 'SELL'
): Promise<string> {
  const result = await getBestBidAsk(tokenID, side);
  return result[tokenID] || '0';
}

// ============================================================================
// Default Export
// ============================================================================

const restService = {
  getOrderBook,
  getRecentTrades,
  getHistoricalPrices,
  getBestBidAsk,
  getBestBidAskSingle,
};

export default restService;

