import { ethers } from 'ethers';
import { Side } from '@polymarket/clob-client';
import OrderService, { type CopyStrategyConfig, type PlaceOrderParams } from '../clob/orderService';
import { getOrderBook, getBestBidAskSingle } from '../clob/restService';
import type { OrderBook } from '../clob/restService';
import { fetchMarkets } from '../gamma/marketService';
import type { DetectedTrade } from './onchainMonitor';

export interface RiskLimits {
  maxPositionSize: number;
  maxOrderValue: number;
  maxDailyLoss: number;
  maxSlippage?: number;
}

export interface MarketFilters {
  whitelistMarkets?: string[];
  blacklistMarkets?: string[];
  minMarketLiquidity?: number;
}

export interface CopyTradingConfig {
  copyStrategy: 'exact' | 'scaled' | 'percentage' | 'adaptive';
  scaleFactor?: number;
  percentageOfBalance?: number;
  riskLimits: RiskLimits;
  filters?: MarketFilters;
}

const USDC_CONTRACT = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const USDC_DECIMALS = 6;
const USDC_ABI = [{ constant: true, inputs: [{ name: '_owner', type: 'address' }], name: 'balanceOf', outputs: [{ name: 'balance', type: 'uint256' }], type: 'function' }] as const;

export class CopyTradingEngine {
  private orderService: OrderService;
  private provider: ethers.Provider | null = null;
  private userWalletAddress: string | null = null;
  private config: CopyTradingConfig;
  private positions: Map<string, any> = new Map();
  private dailyStats: any = null;
  private marketMetadata: Map<string, any> = new Map();
  private marketMetadataCacheTime: number = 0;
  private readonly MARKET_CACHE_TTL = 3600000;
  private usdcContract: ethers.Contract | null = null;

  constructor(orderService: OrderService, config: CopyTradingConfig, userWalletAddress?: string, rpcUrl?: string) {
    this.orderService = orderService;
    this.config = config;
    this.userWalletAddress = userWalletAddress || null;

    if (rpcUrl || process.env.RPC_URL) {
      this.provider = new ethers.JsonRpcProvider(rpcUrl || process.env.RPC_URL!);
      if (this.provider && this.userWalletAddress) {
        this.usdcContract = new ethers.Contract(USDC_CONTRACT, USDC_ABI, this.provider);
      }
    }
  }

  async processTrade(trade: DetectedTrade, sourceWallet: string): Promise<boolean> {
    if (!(await this.shouldCopyTrade(trade, sourceWallet))) return false;
    const orderParams = await this.calculateCopyOrder(trade, sourceWallet);
    if (!orderParams) return false;
    await this.executeCopyOrder(orderParams, trade);
    return true;
  }

  async shouldCopyTrade(trade: DetectedTrade, sourceWallet: string): Promise<boolean> {
    const marketInfo = await this.getMarketMetadata(trade.tokenID);
    if (!marketInfo) return false;

    if (this.config.filters) {
      const conditionId = marketInfo.conditionId || marketInfo.id;
      if (this.config.filters.blacklistMarkets?.includes(conditionId)) return false;
      if (this.config.filters.minMarketLiquidity) {
        const liquidity = await this.getMarketLiquidity(trade.tokenID);
        if (liquidity < this.config.filters.minMarketLiquidity) return false;
      }
    }

    if (await this.wouldExceedDailyLoss(trade)) return false;

    const normalizedPrice = parseFloat(trade.price) / 1e18;
    const rawSize = parseFloat(trade.size);
    const normalizedSize = rawSize > 1e15 ? rawSize / 1e18 : rawSize > 1e6 ? rawSize / 1e6 : rawSize;
    const actualOrderValueUSD = normalizedPrice * normalizedSize * (this.config.scaleFactor || 1);
    
    return actualOrderValueUSD <= this.config.riskLimits.maxOrderValue;
  }

  async calculateCopyOrder(trade: DetectedTrade, sourceWallet: string) {
    let currentBalance: number | undefined;
    if (this.config.copyStrategy === 'percentage' || this.config.copyStrategy === 'adaptive') {
      const balance = await this.getUSDCBalance();
      currentBalance = balance ?? undefined;
      if (!currentBalance || currentBalance <= 0) return null;
    }

    let currentMarketPrice: number | undefined;
    if (this.config.copyStrategy === 'adaptive') {
      const price = await this.getCurrentMarketPrice(trade.tokenID);
      currentMarketPrice = price ?? undefined;
      if (!currentMarketPrice || currentMarketPrice <= 0) return null;
    }

    const normalizedPrice = parseFloat(trade.price) / 1e18;
    const rawSize = parseFloat(trade.size);
    const normalizedSize = rawSize > 1e15 ? rawSize / 1e18 : rawSize > 1e6 ? rawSize / 1e6 : rawSize;

    const copyTrade = {
      tokenID: trade.tokenID,
      price: normalizedPrice,
      size: normalizedSize,
      side: trade.side === 'BUY' ? Side.BUY : Side.SELL,
    };

    const strategyConfig: CopyStrategyConfig = {
      strategy: this.config.copyStrategy,
      scaleFactor: this.config.scaleFactor,
      percentageOfBalance: this.config.percentageOfBalance,
      maxSlippage: this.config.riskLimits.maxSlippage,
      currentBalance,
      currentMarketPrice,
    };

    const orderParams = this.orderService.calculateOrderParams(copyTrade, strategyConfig);
    const orderValue = orderParams.price * orderParams.size;
    const currentPosition = this.positions.get(trade.tokenID);
    const newPositionValue = (currentPosition?.valueUSD || 0) + orderValue;

    if (newPositionValue > this.config.riskLimits.maxPositionSize) return null;
    return orderParams;
  }

  async executeCopyOrder(orderParams: any, originalTrade: DetectedTrade) {
    const marketInfo = await this.getMarketMetadata(originalTrade.tokenID);
    if (!marketInfo) throw new Error(`Market info not found for tokenID: ${originalTrade.tokenID}`);

    const placeOrderParams: PlaceOrderParams = {
      tokenID: orderParams.tokenID,
      price: orderParams.price,
      size: orderParams.size,
      side: orderParams.side,
      feeRateBps: orderParams.feeRateBps,
      tickSize: marketInfo.tickSize || '0.001',
      negRisk: marketInfo.negRisk || false,
    };

    console.log(`📤 Placing order: ${orderParams.side} ${orderParams.size} @ ${orderParams.price}`);
    const response = await this.orderService.placeOrder(placeOrderParams);
    
    if (response && typeof response === 'object' && 'error' in response) {
      throw new Error(`Order failed: ${JSON.stringify(response)}`);
    }
    
    console.log('✅ ORDER PLACED SUCCESSFULLY!');
    this.updatePosition(orderParams, originalTrade);
    this.updateDailyStats(orderParams, originalTrade);
  }

  async getUSDCBalance(): Promise<number | null> {
    if (!this.usdcContract || !this.userWalletAddress) return null;
    const balance = await (this.usdcContract as any).balanceOf(this.userWalletAddress);
    return Number(ethers.formatUnits(balance, USDC_DECIMALS));
  }

  async getCurrentMarketPrice(tokenID: string): Promise<number | null> {
    const spread = await getBestBidAskSingle(tokenID);
    const price = parseFloat(spread);
    return isNaN(price) ? null : price;
  }

  async getMarketLiquidity(tokenID: string): Promise<number> {
    const orderBook = await getOrderBook(tokenID);
    const topBids = orderBook.bids.slice(0, 5);
    const topAsks = orderBook.asks.slice(0, 5);
    let bidLiquidity = 0;
    let askLiquidity = 0;
    topBids.forEach((bid) => { bidLiquidity += parseFloat(bid.price) * parseFloat(bid.size); });
    topAsks.forEach((ask) => { askLiquidity += parseFloat(ask.price) * parseFloat(ask.size); });
    return (bidLiquidity + askLiquidity) / 2;
  }

  async getMarketMetadata(tokenID: string) {
    if (!tokenID || tokenID === '0' || tokenID.trim() === '') return null;

    const now = Date.now();
    if (this.marketMetadata.has(tokenID) && now - this.marketMetadataCacheTime < this.MARKET_CACHE_TTL) {
      return this.marketMetadata.get(tokenID);
    }

    try {
      const orderBook: OrderBook = await getOrderBook(tokenID);
      if (orderBook) {
        const marketInfo = {
          tokenID,
          assetID: orderBook.asset_id || tokenID,
          tickSize: orderBook.tick_size || '0.001',
          negRisk: orderBook.neg_risk !== undefined ? orderBook.neg_risk : false,
          market: orderBook.market || '',
          conditionId: orderBook.market || '',
        };
        this.marketMetadata.set(tokenID, marketInfo);
        this.marketMetadataCacheTime = now;
        console.log(`✅ Market metadata found for tokenID: ${tokenID} (via CLOB API)`);
        return marketInfo;
      }
    } catch {}

    try {
      const markets = await fetchMarkets({ active: true, limit: 1000 });
      for (const market of markets) {
        const clobTokenIds = (market as any).clobTokenIds || [];
        if (Array.isArray(clobTokenIds) && clobTokenIds.includes(tokenID)) {
          const outcomes = (market as any).outcomes || [];
          const matchingOutcome = outcomes.find((outcome: any) => outcome.asset_id === tokenID);
          const marketInfo = {
            ...market,
            tokenID,
            assetID: matchingOutcome?.asset_id || tokenID,
            tickSize: matchingOutcome?.tick_size || market.tickSize || '0.001',
            negRisk: matchingOutcome?.neg_risk !== undefined ? matchingOutcome.neg_risk : (market.negRisk !== undefined ? market.negRisk : false),
            conditionId: market.conditionId || market.id,
          };
          this.marketMetadata.set(tokenID, marketInfo);
          this.marketMetadataCacheTime = now;
          console.log(`✅ Market metadata found for tokenID: ${tokenID} (via Gamma API)`);
          return marketInfo;
        }
      }
    } catch {}

    return null;
  }

  private async wouldExceedDailyLoss(trade: DetectedTrade): Promise<boolean> {
    await this.ensureDailyStats();
    if (!this.dailyStats) return false;

    const normalizedPrice = parseFloat(trade.price) / 1e18;
    const rawSize = parseFloat(trade.size);
    const normalizedSize = rawSize > 1e15 ? rawSize / 1e18 : rawSize > 1e6 ? rawSize / 1e6 : rawSize;
    const actualOrderValueUSD = normalizedPrice * normalizedSize * (this.config.scaleFactor || 1);
    const potentialLoss = actualOrderValueUSD * 0.1;
    const newTotalLoss = this.dailyStats.totalLoss + potentialLoss;

    return newTotalLoss > this.config.riskLimits.maxDailyLoss;
  }

  private async ensureDailyStats() {
    const today = new Date().toISOString().split('T')[0];
    if (!today) return;

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

  private updatePosition(orderParams: any, originalTrade: DetectedTrade) {
    const tokenID = orderParams.tokenID;
    const orderValue = orderParams.price * orderParams.size;
    const currentPosition = this.positions.get(tokenID);

    if (orderParams.side === Side.BUY) {
      if (currentPosition) {
        const totalSize = currentPosition.size + orderParams.size;
        const totalValue = currentPosition.valueUSD + orderValue;
        this.positions.set(tokenID, {
          tokenID,
          size: totalSize,
          avgPrice: totalValue / totalSize,
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
      if (currentPosition && currentPosition.side === 'BUY') {
        const newSize = currentPosition.size - orderParams.size;
        const soldValue = orderParams.price * orderParams.size;
        const remainingValue = currentPosition.valueUSD - soldValue;
        if (newSize <= 0) {
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

  private updateDailyStats(orderParams: any, originalTrade: DetectedTrade) {
    this.ensureDailyStats();
    if (!this.dailyStats) return;

    const orderValue = orderParams.price * orderParams.size;
    this.dailyStats.tradesCount++;
    if (orderParams.side === Side.BUY) {
      this.dailyStats.currentBalance -= orderValue;
    } else {
      this.dailyStats.currentBalance += orderValue;
    }

    const pnl = this.dailyStats.currentBalance - this.dailyStats.startingBalance;
    if (pnl < 0) {
      this.dailyStats.totalLoss = Math.abs(pnl);
    } else {
      this.dailyStats.totalProfit = pnl;
    }
  }
}

export default CopyTradingEngine;
