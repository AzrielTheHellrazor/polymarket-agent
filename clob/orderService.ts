// ============================================================================
// Type Definitions
// ============================================================================

import { ClobClient, OrderType, Side } from '@polymarket/clob-client';
import type { ApiKeyCreds } from '@polymarket/clob-client';
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

export interface EditOrderParams {
  price?: number;
  size?: number;
  feeRateBps?: number;
}

export interface CancelOrderResponse {
  canceled: string[];
  not_canceled: Record<string, string>;
}

export interface OpenOrder {
  id: string;
  token_id: string;
  price: string;
  size: string;
  side: 'BUY' | 'SELL';
  status: string;
  created_at?: string;
  updated_at?: string;
  market?: string;
  asset_id?: string;
  [key: string]: unknown;
}

export interface GetOpenOrdersOptions {
  id?: string;
  market?: string;
  asset_id?: string;
}

export type CopyStrategy = 'exact' | 'scaled' | 'percentage' | 'adaptive';

export interface CopyTrade {
  tokenID: string;
  price: number;
  size: number;
  side: Side;
  timestamp?: number;
}

export interface CopyStrategyConfig {
  strategy: CopyStrategy;
  scaleFactor?: number; // For scaled strategy (e.g., 0.5 = 50%)
  percentageOfBalance?: number; // For percentage strategy (e.g., 0.1 = 10%)
  maxSlippage?: number; // For adaptive strategy (e.g., 0.02 = 2%)
  currentBalance?: number; // Current USDC balance for percentage calculation
  currentMarketPrice?: number; // Current market price for adaptive strategy
}

export interface CalculatedOrderParams {
  tokenID: string;
  price: number;
  size: number;
  side: Side;
  feeRateBps: number;
}

// ============================================================================
// Order Service Class
// ============================================================================

export class OrderService {
  private client: ClobClient;
  private host: string;
  private chainId: number;

  constructor(
    client: ClobClient,
    host: string = 'https://clob.polymarket.com',
    chainId: number = 137
  ) {
    this.client = client;
    this.host = host;
    this.chainId = chainId;
  }

  /**
   * Place a single order
   * @param params - Order parameters
   * @returns Order response
   * @see https://docs.polymarket.com/developers/CLOB/orders/create-order
   */
  async placeOrder(params: PlaceOrderParams): Promise<unknown> {
    const {
      tokenID,
      price,
      size,
      side,
      feeRateBps = 0,
      tickSize,
      negRisk = false,
      orderType = OrderType.GTC,
    } = params;

    if (!tokenID || !price || !size || !side) {
      throw new Error('Missing required order parameters: tokenID, price, size, side');
    }

    if (price <= 0 || size <= 0) {
      throw new Error('Price and size must be greater than 0');
    }

    try {
      // Use createAndPostOrder if tickSize and negRisk are provided
      if (tickSize !== undefined) {
        const response = await this.client.createAndPostOrder(
          {
            tokenID,
            price,
            side,
            size,
            feeRateBps,
          },
          { tickSize: tickSize as any, negRisk },
          orderType as OrderType.GTC | OrderType.GTD | undefined
        );
        return response;
      }

      // Otherwise, use create_order and post_order separately
      const orderArgs = {
        price,
        size,
        side,
        tokenID,
        feeRateBps,
      };

      const signedOrder = await this.client.createOrder(orderArgs);
      const response = await this.client.postOrder(signedOrder, orderType);
      return response;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to place order: ${errorMessage}`);
    }
  }

  /**
   * Cancel a single order
   * @param orderID - Order ID to cancel
   * @returns Cancel response
   * @see https://docs.polymarket.com/developers/CLOB/orders/cancel-orders
   */
  async cancelOrder(orderID: string): Promise<CancelOrderResponse> {
    if (!orderID || orderID.trim().length === 0) {
      throw new Error('Order ID is required');
    }

    try {
      // Use ClobClient's cancel method if available, otherwise use REST API
      const client = this.client as any;
      if (client.cancel) {
        const response = await client.cancel(orderID);
        return response as CancelOrderResponse;
      }
      // Fallback to REST API if method doesn't exist
      throw new Error('Cancel method not available on ClobClient');
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to cancel order: ${errorMessage}`);
    }
  }

  /**
   * Cancel multiple orders
   * @param orderIDs - Array of order IDs to cancel
   * @returns Cancel response
   * @see https://docs.polymarket.com/developers/CLOB/orders/cancel-orders
   */
  async cancelOrders(orderIDs: string[]): Promise<CancelOrderResponse> {
    if (!orderIDs || orderIDs.length === 0) {
      throw new Error('At least one order ID is required');
    }

    try {
      const client = this.client as any;
      if (client.cancelOrders) {
        const response = await client.cancelOrders(orderIDs);
        return response as CancelOrderResponse;
      }
      throw new Error('CancelOrders method not available on ClobClient');
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to cancel orders: ${errorMessage}`);
    }
  }

  /**
   * Cancel all open orders
   * @returns Cancel response
   * @see https://docs.polymarket.com/developers/CLOB/orders/cancel-orders
   */
  async cancelAllOrders(): Promise<CancelOrderResponse> {
    try {
      const client = this.client as any;
      if (client.cancelAll) {
        const response = await client.cancelAll();
        return response as CancelOrderResponse;
      }
      throw new Error('CancelAll method not available on ClobClient');
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to cancel all orders: ${errorMessage}`);
    }
  }

  /**
   * Cancel orders from a specific market
   * @param market - Condition ID of the market (optional)
   * @param asset_id - Asset/token ID (optional)
   * @returns Cancel response
   * @see https://docs.polymarket.com/developers/CLOB/orders/cancel-orders
   */
  async cancelMarketOrders(
    market?: string,
    asset_id?: string
  ): Promise<CancelOrderResponse> {
    if (!market && !asset_id) {
      throw new Error('Either market or asset_id must be provided');
    }

    try {
      const client = this.client as any;
      if (client.cancelMarketOrders) {
        const response = await client.cancelMarketOrders({
          market,
          asset_id,
        });
        return response as CancelOrderResponse;
      }
      throw new Error('CancelMarketOrders method not available on ClobClient');
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to cancel market orders: ${errorMessage}`);
    }
  }

  /**
   * Edit an order by canceling and placing a new one
   * Note: Polymarket doesn't have a direct edit order API,
   * so we cancel the old order and place a new one
   * @param orderID - Order ID to edit
   * @param updates - Updated order parameters
   * @param originalOrder - Original order details (needed for new order)
   * @returns New order response
   */
  async editOrder(
    orderID: string,
    updates: EditOrderParams,
    originalOrder: PlaceOrderParams
  ): Promise<unknown> {
    if (!orderID || orderID.trim().length === 0) {
      throw new Error('Order ID is required');
    }

    if (!updates.price && !updates.size && !updates.feeRateBps) {
      throw new Error('At least one update parameter is required');
    }

    try {
      // Cancel the existing order
      await this.cancelOrder(orderID);

      // Create new order with updated parameters
      const newOrderParams: PlaceOrderParams = {
        ...originalOrder,
        ...updates,
      };

      return await this.placeOrder(newOrderParams);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to edit order: ${errorMessage}`);
    }
  }

  /**
   * Get active/open orders
   * @param options - Filter options (id, market, asset_id)
   * @returns Array of open orders
   * @see https://docs.polymarket.com/developers/CLOB/orders/get-active-order
   */
  async getOpenOrders(
    options?: GetOpenOrdersOptions
  ): Promise<OpenOrder[]> {
    try {
      const client = this.client as any;
      // Try getOrders first, then getOrder if single ID provided
      if (options?.id && !options.market && !options.asset_id) {
        if (client.getOrder) {
          const response = await client.getOrder(options.id);
          return Array.isArray(response) ? response : [response];
        }
      }
      if (client.getOrders) {
        const response = await client.getOrders(options || {});
        return response as OpenOrder[];
      }
      throw new Error('GetOrders method not available on ClobClient');
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get open orders: ${errorMessage}`);
    }
  }

  /**
   * Calculate order parameters based on copy trading strategy
   * @param trade - Trade to copy
   * @param config - Copy strategy configuration
   * @returns Calculated order parameters
   */
  calculateOrderParams(
    trade: CopyTrade,
    config: CopyStrategyConfig
  ): CalculatedOrderParams {
    const { strategy } = config;
    let calculatedPrice = trade.price;
    let calculatedSize = trade.size;

    switch (strategy) {
      case 'exact':
        // Exact copy: same token, side, price, size
        calculatedPrice = trade.price;
        calculatedSize = trade.size;
        break;

      case 'scaled':
        // Scaled copy: same token, side, price, scaled size
        if (!config.scaleFactor || config.scaleFactor <= 0) {
          throw new Error('scaleFactor is required for scaled strategy');
        }
        calculatedPrice = trade.price;
        calculatedSize = trade.size * config.scaleFactor;
        break;

      case 'percentage':
        // Percentage copy: same token, side, price, percentage of balance
        if (!config.percentageOfBalance || config.percentageOfBalance <= 0) {
          throw new Error(
            'percentageOfBalance is required for percentage strategy'
          );
        }
        if (!config.currentBalance || config.currentBalance <= 0) {
          throw new Error('currentBalance is required for percentage strategy');
        }
        calculatedPrice = trade.price;
        // Calculate size based on percentage of balance
        const orderValue = config.currentBalance * config.percentageOfBalance;
        calculatedSize = orderValue / trade.price;
        break;

      case 'adaptive':
        // Adaptive copy: adjust price based on current market price (slippage control)
        if (!config.currentMarketPrice || config.currentMarketPrice <= 0) {
          throw new Error(
            'currentMarketPrice is required for adaptive strategy'
          );
        }
        if (!config.maxSlippage) {
          throw new Error('maxSlippage is required for adaptive strategy');
        }

        const marketPrice = config.currentMarketPrice;
        const maxSlippage = config.maxSlippage;

        // Calculate allowed price range
        const priceDiff = Math.abs(marketPrice - trade.price);
        const slippagePercent = priceDiff / marketPrice;

        if (slippagePercent > maxSlippage) {
          // Adjust price to stay within slippage limit
          if (trade.side === Side.BUY) {
            // For buy orders, use market price or slightly above
            calculatedPrice = marketPrice * (1 + maxSlippage * 0.5);
          } else {
            // For sell orders, use market price or slightly below
            calculatedPrice = marketPrice * (1 - maxSlippage * 0.5);
          }
        } else {
          // Use original price if within slippage limit
          calculatedPrice = trade.price;
        }

        calculatedSize = trade.size;
        break;

      default:
        throw new Error(`Unknown copy strategy: ${strategy}`);
    }

    // Validate calculated values
    if (calculatedPrice <= 0 || calculatedSize <= 0) {
      throw new Error(
        `Invalid calculated order parameters: price=${calculatedPrice}, size=${calculatedSize}`
      );
    }

    return {
      tokenID: trade.tokenID,
      price: calculatedPrice,
      size: calculatedSize,
      side: trade.side,
      feeRateBps: 0, // Default fee rate, can be overridden
    };
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create an OrderService instance with ClobClient
 * @param privateKey - Wallet private key
 * @param funderAddress - Funder address (Polymarket proxy address)
 * @param signatureType - Signature type (1: Magic/Email, 2: Browser Wallet, 0: EOA)
 * @param apiCreds - Optional API credentials (will be derived if not provided)
 * @param host - CLOB API host
 * @param chainId - Chain ID (default: 137 for Polygon)
 * @returns OrderService instance
 */
export async function createOrderService(
  privateKey: string,
  funderAddress?: string,
  signatureType: number = 1,
  apiCreds?: ApiKeyCreds,
  host: string = 'https://clob.polymarket.com',
  chainId: number = 137
): Promise<OrderService> {
  const signer = new Wallet(privateKey);

  // Derive or use provided API credentials
  const tempClient = new ClobClient(host, chainId, signer);
  const creds = apiCreds || (await tempClient.createOrDeriveApiKey());

  // Initialize client with signature type and funder if provided
  let client: ClobClient;
  if (funderAddress) {
    client = new ClobClient(
      host,
      chainId,
      signer,
      creds,
      signatureType,
      funderAddress
    );
  } else {
    client = new ClobClient(host, chainId, signer, creds);
  }

  return new OrderService(client, host, chainId);
}

// ============================================================================
// Default Export
// ============================================================================

export default OrderService;

