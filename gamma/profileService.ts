// ============================================================================
// Type Definitions
// ============================================================================

export interface PublicProfile {
  address: string;
  username?: string;
  [key: string]: unknown;
}

export interface Trade {
  id?: string;
  market?: string;
  tokenId?: string;
  side?: 'buy' | 'sell';
  price?: string;
  size?: string;
  timestamp?: string;
  [key: string]: unknown;
}

export interface Position {
  tokenId?: string;
  market?: string;
  size?: string;
  avgPrice?: string;
  [key: string]: unknown;
}

export interface FetchTradeHistoryOptions {
  limit?: number;
  page?: number;
  market?: string;
  tokenId?: string;
  startDate?: string;
  endDate?: string;
}

// ============================================================================
// Gamma API Base URL
// ============================================================================

const GAMMA_API_BASE_URL = 'https://gamma-api.polymarket.com';

// ============================================================================
// Public Profile & Trade History Functions
// ============================================================================

export async function fetchPublicProfile(address: `0x${string}`): Promise<PublicProfile> {
  if (!address || !address.startsWith('0x')) {
    throw new Error('Invalid address format. Address must start with 0x');
  }

  const url = new URL(`${GAMMA_API_BASE_URL}/public-profile`);
  url.searchParams.set('address', address);
  
  const response = await fetch(url.toString());
  
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json() as PublicProfile;
  return data;
}


// ============================================================================
// Default Export
// ============================================================================

const profileService = {
  fetchPublicProfile,
  //fetchPositions,
  //fetchTradeHistory,
  //parseTradeHistory,
};

export default profileService;
