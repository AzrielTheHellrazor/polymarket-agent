import { ClobClient, OrderType, Side } from '@polymarket/clob-client';
import type { ApiKeyCreds } from '@polymarket/clob-client';
import { BuilderConfig } from '@polymarket/builder-signing-sdk';
import { Wallet } from '@ethersproject/wallet';

export interface PlaceOrderParams {
  tokenID: string;
  price: number;
  size: number;
  side: Side;
  feeRateBps?: number;
  tickSize?: string;
  negRisk?: boolean;
  orderType?: OrderType;
}

export interface CopyTrade {
  tokenID: string;
  price: number;
  size: number;
  side: Side;
}

export interface CopyStrategyConfig {
  strategy: 'exact' | 'scaled' | 'percentage' | 'adaptive';
  scaleFactor?: number;
  percentageOfBalance?: number;
  maxSlippage?: number;
  currentBalance?: number;
  currentMarketPrice?: number;
}

export class OrderService {
  private client: ClobClient;

  constructor(client: ClobClient) {
    this.client = client;
  }

  async placeOrder(params: PlaceOrderParams) {
    const { tokenID, price, size, side, feeRateBps = 0, tickSize, negRisk = false, orderType = OrderType.GTC } = params;
    const adjustedSize = size + 0.1;

    if (tickSize !== undefined) {
      return await this.client.createAndPostOrder(
        { tokenID, price, side, size: adjustedSize, feeRateBps },
        { tickSize: tickSize as any, negRisk },
        orderType as OrderType.GTC | OrderType.GTD | undefined
      );
    }

    console.log(`   Side: ${side}`);
    console.log(`   Token ID: ${tokenID}`);
    
    const order = await this.client.createOrder({ price, size: adjustedSize, side, tokenID, feeRateBps });
    
    console.log(`📦 Order Created:`);
    console.log(`   Order object:`, JSON.stringify(order, null, 2));
    if ((order as any).makerAmount) {
      const makerAmountUSDC = parseFloat((order as any).makerAmount) / 1e6;
      console.log(`   Maker Amount (USDC): ${makerAmountUSDC.toFixed(6)}`);
    }
    if ((order as any).takerAmount) {
      const takerAmountToken = parseFloat((order as any).takerAmount) / 1e18;
      console.log(`   Taker Amount (Token): ${takerAmountToken.toFixed(6)}`);
    }
    
    return await this.client.postOrder(order, orderType);
  }

  calculateOrderParams(trade: CopyTrade, config: CopyStrategyConfig) {
    let price = trade.price;
    let size = trade.size;

    switch (config.strategy) {
      case 'exact':
        break;

      case 'scaled':
        size = trade.size * (config.scaleFactor || 1);
        break;

      case 'percentage':
        const orderValue = (config.currentBalance || 0) * (config.percentageOfBalance || 0);
        size = orderValue / trade.price;
        break;

      case 'adaptive':
        if (config.currentMarketPrice && config.maxSlippage) {
          const priceDiff = Math.abs(config.currentMarketPrice - trade.price);
          const slippagePercent = priceDiff / config.currentMarketPrice;
          if (slippagePercent > config.maxSlippage) {
            price = trade.side === Side.BUY
              ? config.currentMarketPrice * (1 + config.maxSlippage * 0.5)
              : config.currentMarketPrice * (1 - config.maxSlippage * 0.5);
          }
        }
        break;
    }

    const POLYMARKET_FEE_RATE = 0.02;
    const baseOrderValueUSD = price * size;
    const feeAmountUSD = baseOrderValueUSD * POLYMARKET_FEE_RATE;
    const totalOrderValueUSD = baseOrderValueUSD + feeAmountUSD;
    const minOrderValueUSD = 1.0;
    
    if (totalOrderValueUSD < minOrderValueUSD) {
      const adjustedBaseValue = minOrderValueUSD / (1 + POLYMARKET_FEE_RATE);
      size = adjustedBaseValue / price;
    }

    return {
      tokenID: trade.tokenID,
      price,
      size,
      side: trade.side,
      feeRateBps: 0,
    };
  }
}

export async function createOrderService(
  privateKey: string,
  host: string = 'https://clob.polymarket.com',
  chainId: number = 137
): Promise<OrderService> {
  const signer = new Wallet(privateKey);
  const tempClient = new ClobClient(host, chainId, signer);
  const apiCreds = await tempClient.createOrDeriveApiKey();


  const client = new ClobClient(
    host,
    chainId,
    signer,
    apiCreds,
    2,
    process.env.FUNDER_ADDRESS
  );

  return new OrderService(client);
}

export default OrderService;
