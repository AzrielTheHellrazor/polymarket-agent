export interface Market {
  [key: string]: unknown;
}

export interface FetchMarketsOptions {
  limit?: number;
  page?: number;
  active?: boolean;
  closed?: boolean;
  resolved?: boolean;
  tags?: string[];
}

const GAMMA_API_BASE_URL = 'https://gamma-api.polymarket.com';

export async function fetchMarkets(options?: FetchMarketsOptions): Promise<Market[]> {
  const url = new URL(`${GAMMA_API_BASE_URL}/markets`);
  
  if (options) {
    const { limit, page, active, closed, resolved, tags } = options;
    if (limit !== undefined) url.searchParams.set('limit', limit.toString());
    if (page !== undefined) url.searchParams.set('page', page.toString());
    if (active !== undefined) url.searchParams.set('active', active.toString());
    if (closed !== undefined) url.searchParams.set('closed', closed.toString());
    if (resolved !== undefined) url.searchParams.set('resolved', resolved.toString());
    if (tags && tags.length > 0) url.searchParams.set('tags', tags.join(','));
  }

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }
  return response.json() as Market[];
}

export default { fetchMarkets };
