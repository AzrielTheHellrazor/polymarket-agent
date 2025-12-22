export interface OrderBook {
  market: string;
  asset_id: string;
  timestamp: string;
  hash: string;
  bids: { price: string; size: string }[];
  asks: { price: string; size: string }[];
  min_order_size: string;
  tick_size: string;
  neg_risk: boolean;
}

const CLOB_API_BASE_URL = 'https://clob.polymarket.com';

async function fetchWithErrorHandling<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`CLOB API request failed: ${response.status} ${response.statusText}. ${errorText}`);
  }
  return response.json() as T;
}

export async function getOrderBook(tokenID: string): Promise<OrderBook> {
  if (!tokenID || tokenID.trim().length === 0) {
    throw new Error('Token ID is required');
  }
  const url = new URL(`${CLOB_API_BASE_URL}/book`);
  url.searchParams.set('token_id', tokenID);
  return fetchWithErrorHandling<OrderBook>(url.toString());
}

export async function getBestBidAskSingle(tokenID: string, side?: 'BUY' | 'SELL'): Promise<string> {
  const tokens = [tokenID];
  const body = tokens.map((tokenID) => {
    const request: any = { token_id: tokenID };
    if (side) request.side = side;
    return request;
  });

  const result = await fetchWithErrorHandling<Record<string, string>>(
    `${CLOB_API_BASE_URL}/spreads`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
  return result[tokenID] || '0';
}

export default { getOrderBook, getBestBidAskSingle };
