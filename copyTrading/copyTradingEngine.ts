// ============================================================================
// Type Definitions
// ============================================================================

import { ethers } from 'ethers';
import { Side } from '@polymarket/clob-client';
import OrderService, {
  type CopyStrategy,
  type CopyStrategyConfig,
  type CalculatedOrderParams,
  type PlaceOrderParams,
} from '../clob/orderService';
import { getOrderBook, getBestBidAskSingle } from '../clob/restService';
import { fetchMarkets } from '../gamma/marketService';
import type { DetectedTrade } from './onchainMonitor';

export interface RiskLimits {
  maxPositionSize: number; // In USD
  maxOrderValue: number; // In USD
  maxDailyLoss: number; // In USD
  maxSlippage?: number; // For adaptive copy (e.g., 0.02 = 2%)
}

export interface MarketFilters {
  whitelistMarkets?: string[]; // Condition IDs
  blacklistMarkets?: string[]; // Condition IDs
  minMarketLiquidity?: number; // Minimum liquidity in USD
}

export interface CopyTradingConfig {
  copyStrategy: CopyStrategy;
  scaleFactor?: number; // For scaled copy (e.g., 0.5 = 50%)
  percentageOfBalance?: number; // For percentage copy (e.g., 0.1 = 10%)
  riskLimits: RiskLimits;
  filters?: MarketFilters;
}

export interface Position {
  tokenID: string;
  size: number; // Token amount
  avgPrice: number; // Average entry price
  side: 'BUY' | 'SELL';
  valueUSD: number; // Value in USD
}

export interface DailyStats {
  date: string; // Format: YYYY-MM-DD
  startingBalance: number;
  currentBalance: number;
  totalLoss: number;
  totalProfit: number;
  tradesCount: number;
}

// ============================================================================
// Contract Addresses
// ============================================================================

const USDC_CONTRACT = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'; // Polygon USDC
const USDC_DECIMALS = 6;

// USDC ABI (only for balanceOf)
const USDC_ABI = [
  {
    constant: true,
    inputs: [{ name: '_owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: 'balance', type: 'uint256' }],
    type: 'function',
  },
] as const;

// ============================================================================
// Copy Trading Engine Class
// ============================================================================

export class CopyTradingEngine {
  private orderService: OrderService;
  private provider: ethers.Provider | null = null;
  private userWalletAddress: string | null = null;
  private config: CopyTradingConfig;

  // State tracking
  private positions: Map<string, Position> = new Map(); // tokenID -> Position
  private dailyStats: DailyStats | null = null;
  private marketMetadata: Map<string, any> = new Map(); // tokenID -> Market info
  private marketMetadataCacheTime: number = 0;
  private readonly MARKET_CACHE_TTL = 3600000; // 1 hour

  // USDC contract interface
  private usdcContract: ethers.Contract | null = null;

  constructor(
    orderService: OrderService,
    config: CopyTradingConfig,
    userWalletAddress?: string,
    rpcUrl?: string
  ) {
    this.orderService = orderService;
    this.config = config;
    this.userWalletAddress = userWalletAddress || null;

    // Initialize provider for balance reading
    if (rpcUrl || process.env.RPC_URL) {
      const providerUrl = rpcUrl || process.env.RPC_URL!;
      this.provider = new ethers.JsonRpcProvider(providerUrl);
      
      if (this.provider && this.userWalletAddress) {
        this.usdcContract = new ethers.Contract(
          USDC_CONTRACT,
          USDC_ABI,
          this.provider
        );
      }
    }
  }

  /**
   * Process detected trade and copy it
   * @param trade - Detected trade from wallet monitor
   * @param sourceWallet - Source wallet address
   */
  async processTrade(trade: DetectedTrade, sourceWallet: string): Promise<void> {
    try {
      console.log(`Processing trade from ${sourceWallet}:`, {
        tokenID: trade.tokenID,
        side: trade.side,
        size: trade.size,
        price: trade.price,
      });

      // 1. Check if trade should be copied
      const shouldCopy = await this.shouldCopyTrade(trade, sourceWallet);
      if (!shouldCopy) {
        console.log('Trade filtered out by risk controls or filters');
        return;
      }

      // 2. Calculate copy order parameters
      const orderParams = await this.calculateCopyOrder(trade, sourceWallet);
      if (!orderParams) {
        console.log('Failed to calculate order parameters');
        return;
      }

      // 3. Execute copy order
      await this.executeCopyOrder(orderParams, trade);
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      console.error(`Error processing trade:`, errorObj);
      throw errorObj;
    }
  }

  /**
   * Check if trade should be copied based on risk controls and filters
   * @param trade - Detected trade
   * @param sourceWallet - Source wallet address
   */
  async shouldCopyTrade(trade: DetectedTrade, sourceWallet: string): Promise<boolean> {
    // 1. Get market metadata
    const marketInfo = await this.getMarketMetadata(trade.tokenID);
    if (!marketInfo) {
      console.warn(`Market info not found for tokenID: ${trade.tokenID}`);
      return false;
    }

    // 2. Check whitelist/blacklist
    if (this.config.filters) {
      const conditionId = marketInfo.conditionId || marketInfo.id;
      
      if (this.config.filters.whitelistMarkets) {
        if (!this.config.filters.whitelistMarkets.includes(conditionId)) {
          console.log(`Market ${conditionId} not in whitelist`);
          return false;
        }
      }

      if (this.config.filters.blacklistMarkets) {
        if (this.config.filters.blacklistMarkets.includes(conditionId)) {
          console.log(`Market ${conditionId} is blacklisted`);
          return false;
        }
      }

      // 3. Check market liquidity
      if (this.config.filters.minMarketLiquidity) {
        const liquidity = await this.getMarketLiquidity(trade.tokenID);
        if (liquidity < this.config.filters.minMarketLiquidity) {
          console.log(`Market liquidity ${liquidity} below minimum ${this.config.filters.minMarketLiquidity}`);
          return false;
        }
      }
    }

    // 4. Check daily loss limit
    if (await this.wouldExceedDailyLoss(trade)) {
      console.log('Trade would exceed daily loss limit');
      return false;
    }

    // 5. Check max order value
    const orderValue = parseFloat(trade.price) * parseFloat(trade.size);
    if (orderValue > this.config.riskLimits.maxOrderValue) {
      console.log(`Order value ${orderValue} exceeds max ${this.config.riskLimits.maxOrderValue}`);
      return false;
    }

    return true;
  }

  /**
   * Calculate copy order parameters based on strategy
   * @param trade - Detected trade
   * @param sourceWallet - Source wallet address
   */
  async calculateCopyOrder(
    trade: DetectedTrade,
    sourceWallet: string
  ): Promise<CalculatedOrderParams | null> {
    try {
      // Get current balance for percentage strategy
      let currentBalance: number | undefined;
      if (
        this.config.copyStrategy === 'percentage' ||
        this.config.copyStrategy === 'adaptive'
      ) {
        const balance = await this.getUSDCBalance();
        currentBalance = balance !== null ? balance : undefined;
        if (!currentBalance || currentBalance <= 0) {
          console.warn('Unable to get USDC balance for percentage/adaptive strategy');
          return null;
        }
      }

      // Get current market price for adaptive strategy
      let currentMarketPrice: number | undefined;
      if (this.config.copyStrategy === 'adaptive') {
        const price = await this.getCurrentMarketPrice(trade.tokenID);
        currentMarketPrice = price ?? undefined;
        if (!currentMarketPrice || currentMarketPrice <= 0) {
          console.warn('Unable to get market price for adaptive strategy');
          return null;
        }
      }

      // Convert DetectedTrade to CopyTrade format
      const copyTrade = {
        tokenID: trade.tokenID,
        price: parseFloat(trade.price),
        size: parseFloat(trade.size),
        side: trade.side === 'BUY' ? Side.BUY : Side.SELL,
        timestamp: trade.timestamp,
      };

      // Create strategy config
      const strategyConfig: CopyStrategyConfig = {
        strategy: this.config.copyStrategy,
        scaleFactor: this.config.scaleFactor,
        percentageOfBalance: this.config.percentageOfBalance,
        maxSlippage: this.config.riskLimits.maxSlippage,
        currentBalance,
        currentMarketPrice,
      };

      // Calculate order parameters
      const orderParams = this.orderService.calculateOrderParams(
        copyTrade,
        strategyConfig
      );

      // Check max position size
      const orderValue = orderParams.price * orderParams.size;
      const currentPosition = this.positions.get(trade.tokenID);
      const currentPositionValue = currentPosition?.valueUSD || 0;
      const newPositionValue = currentPositionValue + orderValue;

      if (newPositionValue > this.config.riskLimits.maxPositionSize) {
        console.log(
          `Position size ${newPositionValue} would exceed max ${this.config.riskLimits.maxPositionSize}`
        );
        return null;
      }

      return orderParams;
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      console.error('Error calculating copy order:', errorObj);
      return null;
    }
  }

  /**
   * Execute copy order
   * @param orderParams - Calculated order parameters
   * @param originalTrade - Original detected trade
   */
  async executeCopyOrder(
    orderParams: CalculatedOrderParams,
    originalTrade: DetectedTrade
  ): Promise<void> {
    try {
      // Get market metadata for tickSize and negRisk
      const marketInfo = await this.getMarketMetadata(originalTrade.tokenID);
      if (!marketInfo) {
        throw new Error(`Market info not found for tokenID: ${originalTrade.tokenID}`);
      }

      const tickSize = marketInfo.tickSize || '0.001';
      const negRisk = marketInfo.negRisk || false;

      // Prepare order parameters
      const placeOrderParams: PlaceOrderParams = {
        tokenID: orderParams.tokenID,
        price: orderParams.price,
        size: orderParams.size,
        side: orderParams.side,
        feeRateBps: orderParams.feeRateBps,
        tickSize,
        negRisk,
      };

      // Place order
      const response = await this.orderService.placeOrder(placeOrderParams);
      console.log('Copy order placed successfully:', response);

      // Update position tracking
      this.updatePosition(orderParams, originalTrade);

      // Update daily stats
      this.updateDailyStats(orderParams, originalTrade);
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      console.error('Error executing copy order:', errorObj);
      throw errorObj;
    }
  }

  /**
   * Get USDC balance from on-chain
   */
  async getUSDCBalance(): Promise<number | null> {
    const contract = this.usdcContract;
    const address = this.userWalletAddress;
    
    if (!contract || !address) {
      return null;
    }

    try {
      const balance = await (contract as any).balanceOf(address);
      const balanceNumber = Number(ethers.formatUnits(balance, USDC_DECIMALS));
      return balanceNumber;
    } catch (error) {
      console.error('Error getting USDC balance:', error);
      return null;
    }
  }

  /**
   * Get current market price (best bid/ask)
   */
  async getCurrentMarketPrice(tokenID: string): Promise<number | null> {
    try {
      const spread = await getBestBidAskSingle(tokenID);
      const price = parseFloat(spread);
      return isNaN(price) ? null : price;
    } catch (error) {
      console.error('Error getting market price:', error);
      return null;
    }
  }

  /**
   * Get market liquidity from order book
   */
  async getMarketLiquidity(tokenID: string): Promise<number> {
    try {
      const orderBook = await getOrderBook(tokenID);
      
      // Calculate liquidity as sum of top 5 bid/ask levels
      const topBids = orderBook.bids.slice(0, 5);
      const topAsks = orderBook.asks.slice(0, 5);

      let bidLiquidity = 0;
      let askLiquidity = 0;

      topBids.forEach((bid) => {
        bidLiquidity += parseFloat(bid.price) * parseFloat(bid.size);
      });

      topAsks.forEach((ask) => {
        askLiquidity += parseFloat(ask.price) * parseFloat(ask.size);
      });

      // Return average liquidity
      return (bidLiquidity + askLiquidity) / 2;
    } catch (error) {
      console.error('Error getting market liquidity:', error);
      return 0;
    }
  }

  /**
   * Get market metadata (cached)
   */
  async getMarketMetadata(tokenID: string): Promise<any | null> {
    // Check cache
    const now = Date.now();
    if (
      this.marketMetadata.has(tokenID) &&
      now - this.marketMetadataCacheTime < this.MARKET_CACHE_TTL
    ) {
      return this.marketMetadata.get(tokenID);
    }

    try {
      // Fetch all markets and find matching tokenID
      const markets = await fetchMarkets({ active: true, limit: 1000 });
      
      // Search for market with matching tokenID
      for (const market of markets) {
        const outcomes = (market as any).outcomes || [];
        for (const outcome of outcomes) {
          if (outcome.token_id === tokenID || outcome.asset_id === tokenID) {
            const marketInfo = {
              ...market,
              tokenID,
              tickSize: outcome.tick_size || market.tickSize,
              negRisk: outcome.neg_risk !== undefined ? outcome.neg_risk : market.negRisk,
              conditionId: market.conditionId || market.id,
            };
            this.marketMetadata.set(tokenID, marketInfo);
            this.marketMetadataCacheTime = now;
            return marketInfo;
          }
        }
      }

      console.warn(`Market not found for tokenID: ${tokenID}`);
      return null;
    } catch (error) {
      console.error('Error fetching market metadata:', error);
      return null;
    }
  }

  /**
   * Check if trade would exceed daily loss limit
   */
  private async wouldExceedDailyLoss(trade: DetectedTrade): Promise<boolean> {
    // Initialize daily stats if needed
    await this.ensureDailyStats();

    if (!this.dailyStats) {
      return false;
    }

    // Calculate potential loss from this trade
    const orderValue = parseFloat(trade.price) * parseFloat(trade.size);
    const potentialLoss = orderValue * 0.1; // Assume 10% max loss per trade (conservative)

    const newTotalLoss = this.dailyStats.totalLoss + potentialLoss;

    return newTotalLoss > this.config.riskLimits.maxDailyLoss;
  }

  /**
   * Ensure daily stats are initialized
   */
  private async ensureDailyStats(): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    if (!today) {
      return;
    }

    if (!this.dailyStats || this.dailyStats.date !== today) {
      const currentBalance = await this.getUSDCBalance() || 0;

      this.dailyStats = {
        date: today,
        startingBalance: currentBalance,
        currentBalance: currentBalance,
        totalLoss: 0,
        totalProfit: 0,
        tradesCount: 0,
      };
    }
  }

  /**
   * Update position tracking
   */
  private updatePosition(
    orderParams: CalculatedOrderParams,
    originalTrade: DetectedTrade
  ): void {
    const tokenID = orderParams.tokenID;
    const orderValue = orderParams.price * orderParams.size;
    const currentPosition = this.positions.get(tokenID);

    if (orderParams.side === Side.BUY) {
      // Buying - increase position
      if (currentPosition) {
        const totalSize = currentPosition.size + orderParams.size;
        const totalValue = currentPosition.valueUSD + orderValue;
        const avgPrice = totalValue / totalSize;

        this.positions.set(tokenID, {
          tokenID,
          size: totalSize,
          avgPrice,
          side: 'BUY',
          valueUSD: totalValue,
        });
      } else {
        this.positions.set(tokenID, {
          tokenID,
          size: orderParams.size,
          avgPrice: orderParams.price,
          side: 'BUY',
          valueUSD: orderValue,
        });
      }
    } else {
      // Selling - decrease position
      if (currentPosition && currentPosition.side === 'BUY') {
        const newSize = currentPosition.size - orderParams.size;
        const soldValue = orderParams.price * orderParams.size;
        const remainingValue = currentPosition.valueUSD - soldValue;

        if (newSize <= 0) {
          // Position closed
          this.positions.delete(tokenID);
        } else {
          this.positions.set(tokenID, {
            tokenID,
            size: newSize,
            avgPrice: currentPosition.avgPrice,
            side: 'BUY',
            valueUSD: remainingValue,
          });
        }
      }
    }
  }

  /**
   * Update daily statistics
   */
  private updateDailyStats(
    orderParams: CalculatedOrderParams,
    originalTrade: DetectedTrade
  ): void {
    this.ensureDailyStats();

    if (!this.dailyStats) return;

    const orderValue = orderParams.price * orderParams.size;
    this.dailyStats.tradesCount++;

    // Update balance (simplified - actual balance should come from User Channel)
    // For now, we'll track it approximately
    if (orderParams.side === Side.BUY) {
      this.dailyStats.currentBalance -= orderValue;
    } else {
      this.dailyStats.currentBalance += orderValue;
    }

    // Calculate P&L (simplified)
    const pnl = this.dailyStats.currentBalance - this.dailyStats.startingBalance;
    if (pnl < 0) {
      this.dailyStats.totalLoss = Math.abs(pnl);
    } else {
      this.dailyStats.totalProfit = pnl;
    }
  }

  /**
   * Get current positions
   */
  getPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  /**
   * Get daily statistics
   */
  getDailyStats(): DailyStats | null {
    return this.dailyStats;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<CopyTradingConfig>): void {
    this.config = {
      ...this.config,
      ...config,
      riskLimits: {
        ...this.config.riskLimits,
        ...(config.riskLimits || {}),
      },
      filters: {
        ...this.config.filters,
        ...(config.filters || {}),
      },
    };
  }

  /**
   * Get current configuration
   */
  getConfig(): CopyTradingConfig {
    return { ...this.config };
  }
}

// ============================================================================
// Default Export
// ============================================================================

export default CopyTradingEngine;

