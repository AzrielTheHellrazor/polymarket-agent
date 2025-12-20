// ============================================================================
// Type Definitions
// ============================================================================

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

export interface SearchMarketsOptions {
  query: string;
  limit?: number;
  page?: number;
  active?: boolean;
  closed?: boolean;
  resolved?: boolean;
}

// ============================================================================
// Gamma API Base URL
// ============================================================================

const GAMMA_API_BASE_URL = 'https://gamma-api.polymarket.com';

// ============================================================================
// Market Discovery Functions
// ============================================================================

export async function fetchMarkets(options?: FetchMarketsOptions): Promise<Market[]> {
  const url = new URL(`${GAMMA_API_BASE_URL}/markets`);
  
  if (options) {
    const { limit, page, active, closed, resolved, tags } = options;
    
    if (limit !== undefined) {
      url.searchParams.set('limit', limit.toString());
    }
    
    if (page !== undefined) {
      url.searchParams.set('page', page.toString());
    }
    
    if (active !== undefined) {
      url.searchParams.set('active', active.toString());
    }
    
    if (closed !== undefined) {
      url.searchParams.set('closed', closed.toString());
    }
    
    if (resolved !== undefined) {
      url.searchParams.set('resolved', resolved.toString());
    }
    
    if (tags && tags.length > 0) {
      url.searchParams.set('tags', tags.join(','));
    }
  }

  const response = await fetch(url.toString());
  
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json() as Market[];
  return data;
}

export async function fetchMarketById(id: string): Promise<Market[]> {
  const apiUrl = `${GAMMA_API_BASE_URL}/markets/${id}`;
  const response = await fetch(apiUrl);
  
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json() as Market[];
  return data;
}

export async function fetchMarketBySlug(slug: string): Promise<Market[]> {
  const apiUrl = `${GAMMA_API_BASE_URL}/markets/slug/${slug}`;
  const response = await fetch(apiUrl);
  
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json() as Market[];
  return data;
}

export async function fetchMarketsByTags(tags: string[]): Promise<Market[]> {
  if (!tags || tags.length === 0) {
    throw new Error('Tags array cannot be empty');
  }

  const url = new URL(`${GAMMA_API_BASE_URL}/markets`);
  url.searchParams.set('tags', tags.join(','));
  
  const response = await fetch(url.toString());
  
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json() as Market[];
  return data;
}

export async function searchMarkets(options: SearchMarketsOptions): Promise<Market[]> {
  const { query, limit, page, active, closed, resolved } = options;

  if (!query || query.trim().length === 0) {
    throw new Error('Query parameter is required');
  }

  const url = new URL(`${GAMMA_API_BASE_URL}/markets`);
  
  url.searchParams.set('q', query);
  
  if (limit !== undefined) {
    url.searchParams.set('limit', limit.toString());
  }
  
  if (page !== undefined) {
    url.searchParams.set('page', page.toString());
  }
  
  if (active !== undefined) {
    url.searchParams.set('active', active.toString());
  }
  
  if (closed !== undefined) {
    url.searchParams.set('closed', closed.toString());
  }
  
  if (resolved !== undefined) {
    url.searchParams.set('resolved', resolved.toString());
  }

  const response = await fetch(url.toString());
  
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json() as Market[];
  return data;
}

// ============================================================================
// Default Export
// ============================================================================

const marketService = {
  fetchMarkets,
  fetchMarketById,
  fetchMarketBySlug,
  fetchMarketsByTags,
  searchMarkets,
};

export default marketService;