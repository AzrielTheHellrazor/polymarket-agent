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

    if (tickSize !== undefined) {
      return await this.client.createAndPostOrder(
        { tokenID, price, side, size, feeRateBps },
        { tickSize: tickSize as any, negRisk },
        orderType as OrderType.GTC | OrderType.GTD | undefined
      );
    }

    const order = await this.client.createOrder({ price, size, side, tokenID, feeRateBps });
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
  funderAddress?: string,
  signatureType: number = 1,
  normalApiCreds?: ApiKeyCreds,
  builderApiCreds?: ApiKeyCreds,
  host: string = 'https://clob.polymarket.com',
  chainId: number = 137
): Promise<OrderService> {
  const signer = new Wallet(privateKey);
  console.log(`   Wallet address: ${signer.address}`);

  let creds = normalApiCreds;

  if (!creds) {
    const tempClient = new ClobClient(host, chainId, signer);
    creds = await tempClient.createOrDeriveApiKey();
    console.log('✅ API key created/derived');
  } else {
    console.log('🔑 Using API credentials from environment');
  }

  let builderConfig;
  if (builderApiCreds?.key && builderApiCreds?.secret && builderApiCreds?.passphrase) {
    builderConfig = new BuilderConfig({
      localBuilderCreds: {
        key: builderApiCreds.key,
        secret: builderApiCreds.secret,
        passphrase: builderApiCreds.passphrase,
      },
    });
    console.log('🔧 Builder API credentials configured');
  }

  const client = new ClobClient(
    host,
    chainId,
    signer,
    creds,
    funderAddress ? signatureType : undefined,
    funderAddress,
    undefined,
    undefined,
    builderConfig
  );

  return new OrderService(client);
}

export default OrderService;
