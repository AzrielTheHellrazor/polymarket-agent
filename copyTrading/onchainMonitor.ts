// ============================================================================
// Type Definitions
// ============================================================================

import { ethers } from 'ethers';

export interface DetectedTrade {
  walletAddress: string;
  tokenID: string;
  assetID?: string;
  price: string;
  size: string;
  side: 'BUY' | 'SELL';
  timestamp: number;
  transactionHash: string;
  blockNumber: number;
  eventName: string;
  [key: string]: unknown;
}

export type TradeCallback = (trade: DetectedTrade) => void;
export type ErrorCallback = (error: Error) => void;

// ============================================================================
// Polymarket Contract Addresses (Polygon Mainnet)
// ============================================================================

const POLYMARKET_CONTRACTS = {
  // CTF Exchange - Main trading contract
  CTF_EXCHANGE: '0xC5d563A36AE78145C45a50134d48A1215220f80a',
  // Conditional Token Framework
  CTF: '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045',
  // Old CTF Exchange (for historical data)
  CTF_EXCHANGE_OLD: '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E',
} as const;

// ============================================================================
// Contract ABIs
// ============================================================================

const CTF_EXCHANGE_ABI = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'bytes32', name: 'orderHash', type: 'bytes32' },
      { indexed: true, internalType: 'address', name: 'maker', type: 'address' },
      { indexed: true, internalType: 'address', name: 'taker', type: 'address' },
      { indexed: false, internalType: 'uint256', name: 'makerAssetId', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'takerAssetId', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'makerAmountFilled', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'takerAmountFilled', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'fee', type: 'uint256' },
    ],
    name: 'OrderFilled',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'bytes32', name: 'takerOrderHash', type: 'bytes32' },
      { indexed: true, internalType: 'address', name: 'takerOrderMaker', type: 'address' },
      { indexed: false, internalType: 'uint256', name: 'makerAssetId', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'takerAssetId', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'makerAmountFilled', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'takerAmountFilled', type: 'uint256' },
    ],
    name: 'OrdersMatched',
    type: 'event',
  },
] as const;

const CTF_ABI = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'address', name: 'operator', type: 'address' },
      { indexed: true, internalType: 'address', name: 'from', type: 'address' },
      { indexed: true, internalType: 'address', name: 'to', type: 'address' },
      { indexed: false, internalType: 'uint256', name: 'id', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'value', type: 'uint256' },
    ],
    name: 'TransferSingle',
    type: 'event',
  },
] as const;

// Event topic hashes
const ORDER_FILLED_EVENT_TOPIC = ethers.id('OrderFilled(bytes32,address,address,uint256,uint256,uint256,uint256,uint256)');
const ORDERS_MATCHED_EVENT_TOPIC = ethers.id('OrdersMatched(bytes32,address,uint256,uint256,uint256,uint256)');
const TRANSFER_SINGLE_EVENT_TOPIC = ethers.id('TransferSingle(address,address,address,uint256,uint256)');

// ============================================================================
// On-Chain Monitor Class
// ============================================================================

export class OnChainMonitor {
  private provider: ethers.Provider | null = null;
  private trackedWallets: Set<string> = new Set();
  private isMonitoring: boolean = false;
  private monitoringContracts: string[] = [];
  private eventFilters: ethers.EventLog[] = [];
  private lastProcessedBlock: number = 0;
  private ctfExchangeInterface: ethers.Interface;
  private ctfInterface: ethers.Interface;

  // Event callbacks
  private onTradeCallbacks: TradeCallback[] = [];
  private onErrorCallbacks: ErrorCallback[] = [];

  /**
   * Initialize the monitor with RPC provider
   * @param rpcUrl - RPC provider URL
   */
  constructor(rpcUrl?: string) {
    if (rpcUrl) {
      this.provider = new ethers.JsonRpcProvider(rpcUrl);
    } else {
      // Try to get from environment variable
      const envRpcUrl = process.env.RPC_URL;
      if (envRpcUrl) {
        this.provider = new ethers.JsonRpcProvider(envRpcUrl);
      } else {
        throw new Error('RPC URL is required. Provide it in constructor or set RPC_URL environment variable.');
      }
    }

    // Initialize contract interfaces for event decoding
    this.ctfExchangeInterface = new ethers.Interface(CTF_EXCHANGE_ABI);
    this.ctfInterface = new ethers.Interface(CTF_ABI);
  }

  /**
   * Load tracked wallets from JSON file
   * @param filePath - Path to trackedWallets.json file
   */
  async loadTrackedWallets(filePath: string = 'trackedWallets.json'): Promise<void> {
    try {
      const file = Bun.file(filePath);
      const content = await file.text();
      const data = JSON.parse(content);

      if (data.wallets && Array.isArray(data.wallets)) {
        this.trackedWallets.clear();
        data.wallets.forEach((wallet: string) => {
          if (ethers.isAddress(wallet)) {
            this.trackedWallets.add(wallet.toLowerCase());
          } else {
            console.warn(`Invalid wallet address: ${wallet}`);
          }
        });
        console.log(`Loaded ${this.trackedWallets.size} tracked wallet(s)`);
      } else {
        throw new Error('Invalid trackedWallets.json format. Expected { "wallets": [...] }');
      }
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      throw new Error(`Failed to load tracked wallets: ${errorObj.message}`);
    }
  }

  /**
   * Add wallet addresses to track
   * @param addresses - Array of wallet addresses
   */
  addTrackedWallets(addresses: string[]): void {
    addresses.forEach((address) => {
      if (ethers.isAddress(address)) {
        this.trackedWallets.add(address.toLowerCase());
      } else {
        console.warn(`Invalid wallet address: ${address}`);
      }
    });
    console.log(`Now tracking ${this.trackedWallets.size} wallet(s)`);
  }

  /**
   * Remove wallet addresses from tracking
   * @param addresses - Array of wallet addresses
   */
  removeTrackedWallets(addresses: string[]): void {
    addresses.forEach((address) => {
      this.trackedWallets.delete(address.toLowerCase());
    });
    console.log(`Now tracking ${this.trackedWallets.size} wallet(s)`);
  }

  /**
   * Get list of tracked wallets
   */
  getTrackedWallets(): string[] {
    return Array.from(this.trackedWallets);
  }

  /**
   * Subscribe to Polymarket contracts
   * @param contractAddresses - Optional array of contract addresses (defaults to known Polymarket contracts)
   */
  subscribeToPolymarketContracts(contractAddresses?: string[]): void {
    if (contractAddresses && contractAddresses.length > 0) {
      this.monitoringContracts = contractAddresses;
    } else {
      // Use default Polymarket contracts
      this.monitoringContracts = [
        POLYMARKET_CONTRACTS.CTF_EXCHANGE,
        POLYMARKET_CONTRACTS.CTF_EXCHANGE_OLD,
      ];
    }
    console.log(`Subscribed to ${this.monitoringContracts.length} contract(s)`);
  }

  /**
   * Start monitoring wallets for trades
   * @param fromBlock - Block number to start from (default: latest - 1000 for safety)
   */
  async startMonitoring(fromBlock?: number): Promise<void> {
    if (!this.provider) {
      throw new Error('Provider not initialized. Call constructor with RPC URL.');
    }

    if (this.trackedWallets.size === 0) {
      throw new Error('No wallets to track. Add wallets first.');
    }

    if (this.monitoringContracts.length === 0) {
      this.subscribeToPolymarketContracts();
    }

    if (this.isMonitoring) {
      console.warn('Monitoring already started');
      return;
    }

    this.isMonitoring = true;

    // Get starting block
    if (!fromBlock) {
      const latestBlock = await this.provider.getBlockNumber();
      fromBlock = Math.max(0, latestBlock - 1000); // Start from 1000 blocks ago for safety
    }

    this.lastProcessedBlock = fromBlock;
    console.log(`Starting monitoring from block ${fromBlock}`);

    // Start listening for new blocks
    this.provider.on('block', async (blockNumber) => {
      await this.processNewBlocks(blockNumber);
    });

    // Process historical blocks
    await this.processHistoricalBlocks(fromBlock);
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (!this.isMonitoring) {
      return;
    }

    this.isMonitoring = false;

    if (this.provider) {
      this.provider.removeAllListeners('block');
    }

    console.log('Monitoring stopped');
  }

  /**
   * Register callback for new trades
   * @param callback - Function to call when a trade is detected
   */
  onNewTrade(callback: TradeCallback): void {
    this.onTradeCallbacks.push(callback);
  }

  /**
   * Register callback for errors
   * @param callback - Function to call when an error occurs
   */
  onError(callback: ErrorCallback): void {
    this.onErrorCallbacks.push(callback);
  }

  /**
   * Remove all callbacks
   */
  removeAllCallbacks(): void {
    this.onTradeCallbacks = [];
    this.onErrorCallbacks = [];
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async processHistoricalBlocks(fromBlock: number): Promise<void> {
    if (!this.provider) return;

    try {
      const latestBlock = await this.provider.getBlockNumber();
      const batchSize = 1000; // Process in batches

      for (let block = fromBlock; block <= latestBlock; block += batchSize) {
        const toBlock = Math.min(block + batchSize - 1, latestBlock);
        await this.processBlockRange(block, toBlock);
      }
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      this.onErrorCallbacks.forEach((callback) => callback(errorObj));
    }
  }

  private async processNewBlocks(blockNumber: number): Promise<void> {
    if (!this.isMonitoring || !this.provider) return;

    try {
      const fromBlock = this.lastProcessedBlock + 1;
      if (fromBlock <= blockNumber) {
        await this.processBlockRange(fromBlock, blockNumber);
        this.lastProcessedBlock = blockNumber;
      }
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      this.onErrorCallbacks.forEach((callback) => callback(errorObj));
    }
  }

  private async processBlockRange(fromBlock: number, toBlock: number): Promise<void> {
    if (!this.provider) return;

    try {
      // Create filters for all tracked wallets
      const walletAddresses = Array.from(this.trackedWallets);

      for (const contractAddress of this.monitoringContracts) {
        const isCtfExchange = contractAddress.toLowerCase() === POLYMARKET_CONTRACTS.CTF_EXCHANGE.toLowerCase() ||
                              contractAddress.toLowerCase() === POLYMARKET_CONTRACTS.CTF_EXCHANGE_OLD.toLowerCase();

        if (isCtfExchange) {
          // Filter for OrderFilled events (maker or taker is tracked wallet)
          const orderFilledFilterMaker = {
            address: contractAddress,
            topics: [
              ORDER_FILLED_EVENT_TOPIC,
              null, // orderHash
              walletAddresses.map((addr) => ethers.zeroPadValue(addr, 32)), // maker (tracked wallets)
            ],
            fromBlock,
            toBlock,
          };

          const orderFilledFilterTaker = {
            address: contractAddress,
            topics: [
              ORDER_FILLED_EVENT_TOPIC,
              null, // orderHash
              null, // maker (any)
              walletAddresses.map((addr) => ethers.zeroPadValue(addr, 32)), // taker (tracked wallets)
            ],
            fromBlock,
            toBlock,
          };

          // Filter for OrdersMatched events (takerOrderMaker is tracked wallet)
          const ordersMatchedFilter = {
            address: contractAddress,
            topics: [
              ORDERS_MATCHED_EVENT_TOPIC,
              null, // takerOrderHash
              walletAddresses.map((addr) => ethers.zeroPadValue(addr, 32)), // takerOrderMaker (tracked wallets)
            ],
            fromBlock,
            toBlock,
          };

          // Get events
          const [orderFilledEventsMaker, orderFilledEventsTaker, ordersMatchedEvents] = await Promise.all([
            this.provider.getLogs(orderFilledFilterMaker as any).catch(() => []),
            this.provider.getLogs(orderFilledFilterTaker as any).catch(() => []),
            this.provider.getLogs(ordersMatchedFilter as any).catch(() => []),
          ]);

          // Combine and deduplicate OrderFilled events
          const allOrderFilledEvents = [...orderFilledEventsMaker, ...orderFilledEventsTaker];
          const uniqueOrderFilledEvents = Array.from(
            new Map(allOrderFilledEvents.map((e, idx) => [e.transactionHash + idx, e])).values()
          );

          // Process OrderFilled events
          for (const event of uniqueOrderFilledEvents) {
            await this.parseTradeEvent(event, 'OrderFilled', contractAddress);
          }

          // Process OrdersMatched events
          for (const event of ordersMatchedEvents) {
            await this.parseTradeEvent(event, 'OrdersMatched', contractAddress);
          }
        } else {
          // For CTF contract, filter TransferSingle events
          const transferFilterFrom = {
            address: contractAddress,
            topics: [
              TRANSFER_SINGLE_EVENT_TOPIC,
              null, // operator
              walletAddresses.map((addr) => ethers.zeroPadValue(addr, 32)), // from (tracked wallets)
            ],
            fromBlock,
            toBlock,
          };

          const transferFilterTo = {
            address: contractAddress,
            topics: [
              TRANSFER_SINGLE_EVENT_TOPIC,
              null, // operator
              null, // from (any)
              walletAddresses.map((addr) => ethers.zeroPadValue(addr, 32)), // to (tracked wallets)
            ],
            fromBlock,
            toBlock,
          };

          const [transferEventsFrom, transferEventsTo] = await Promise.all([
            this.provider.getLogs(transferFilterFrom as any).catch(() => []),
            this.provider.getLogs(transferFilterTo as any).catch(() => []),
          ]);

          // Combine and deduplicate
          const allTransferEvents = [...transferEventsFrom, ...transferEventsTo];
          const uniqueTransferEvents = Array.from(
            new Map(allTransferEvents.map((e, idx) => [e.transactionHash + idx, e])).values()
          );

          // Process TransferSingle events (these indicate token movements, might be trades)
          for (const event of uniqueTransferEvents) {
            await this.parseTradeEvent(event, 'TransferSingle', contractAddress);
          }
        }
      }
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      console.error(`Error processing blocks ${fromBlock}-${toBlock}:`, errorObj);
      this.onErrorCallbacks.forEach((callback) => callback(errorObj));
    }
  }

  private async parseTradeEvent(
    event: ethers.Log,
    eventName: string,
    contractAddress: string
  ): Promise<void> {
    try {
      if (!event.topics || event.topics.length < 2) {
        return;
      }

      let walletAddress: string | null = null;
      let decoded: any = null;

      // Decode event using ABI
      try {
        if (eventName === 'OrderFilled') {
          decoded = this.ctfExchangeInterface.parseLog({
            topics: event.topics as string[],
            data: event.data,
          });

          if (decoded) {
            const maker = decoded.args.maker.toLowerCase();
            const taker = decoded.args.taker.toLowerCase();

            // Check if maker or taker is a tracked wallet
            if (this.trackedWallets.has(maker)) {
              walletAddress = decoded.args.maker;
            } else if (this.trackedWallets.has(taker)) {
              walletAddress = decoded.args.taker;
            } else {
              return; // Not a tracked wallet
            }
          }
        } else if (eventName === 'OrdersMatched') {
          decoded = this.ctfExchangeInterface.parseLog({
            topics: event.topics as string[],
            data: event.data,
          });

          if (decoded) {
            const takerOrderMaker = decoded.args.takerOrderMaker.toLowerCase();

            if (this.trackedWallets.has(takerOrderMaker)) {
              walletAddress = decoded.args.takerOrderMaker;
            } else {
              return; // Not a tracked wallet
            }
          }
        } else if (eventName === 'TransferSingle') {
          decoded = this.ctfInterface.parseLog({
            topics: event.topics as string[],
            data: event.data,
          });

          if (decoded) {
            const from = decoded.args.from.toLowerCase();
            const to = decoded.args.to.toLowerCase();

            // Check if from or to is a tracked wallet (and not zero address)
            if (from !== ethers.ZeroAddress && this.trackedWallets.has(from)) {
              walletAddress = decoded.args.from;
            } else if (to !== ethers.ZeroAddress && this.trackedWallets.has(to)) {
              walletAddress = decoded.args.to;
            } else {
              return; // Not a tracked wallet or zero address transfer
            }
          }
        }
      } catch (parseError) {
        console.warn(`Failed to parse event ${eventName}:`, parseError);
        return;
      }

      if (!walletAddress || !decoded) {
        return;
      }

      // Get block info for timestamp
      if (!this.provider) return;
      const block = await this.provider.getBlock(event.blockNumber);
      const timestamp = block?.timestamp || Math.floor(Date.now() / 1000);

      // Extract trade information based on event type
      let tokenID = '0';
      let price = '0';
      let size = '0';
      let side: 'BUY' | 'SELL' = 'BUY';

      if (eventName === 'OrderFilled') {
        // For OrderFilled, determine which asset the wallet is trading
        const makerAssetId = decoded.args.makerAssetId.toString();
        const takerAssetId = decoded.args.takerAssetId.toString();
        const makerAmount = decoded.args.makerAmountFilled.toString();
        const takerAmount = decoded.args.takerAmountFilled.toString();

        const isMaker = walletAddress.toLowerCase() === decoded.args.maker.toLowerCase();

        if (isMaker) {
          // Maker is selling makerAssetId, receiving takerAssetId
          tokenID = makerAssetId;
          size = makerAmount;
          // Price calculation: takerAmount / makerAmount
          if (makerAmount !== '0') {
            price = (BigInt(takerAmount) * BigInt(1e18) / BigInt(makerAmount)).toString();
          }
          side = 'SELL';
        } else {
          // Taker is buying takerAssetId, paying makerAssetId
          tokenID = takerAssetId;
          size = takerAmount;
          // Price calculation: makerAmount / takerAmount
          if (takerAmount !== '0') {
            price = (BigInt(makerAmount) * BigInt(1e18) / BigInt(takerAmount)).toString();
          }
          side = 'BUY';
        }
      } else if (eventName === 'OrdersMatched') {
        const takerAssetId = decoded.args.takerAssetId.toString();
        const takerAmountFilled = decoded.args.takerAmountFilled.toString();
        const makerAmountFilled = decoded.args.makerAmountFilled.toString();

        tokenID = takerAssetId;
        size = takerAmountFilled;
        // Price calculation: makerAmount / takerAmount
        if (takerAmountFilled !== '0') {
          price = (BigInt(makerAmountFilled) * BigInt(1e18) / BigInt(takerAmountFilled)).toString();
        }
        side = 'BUY'; // Taker is buying
      } else if (eventName === 'TransferSingle') {
        // TransferSingle indicates token movement, but we don't have price info
        tokenID = decoded.args.id.toString();
        size = decoded.args.value.toString();
        // Determine side based on from/to
        const isFrom = walletAddress.toLowerCase() === decoded.args.from.toLowerCase();
        side = isFrom ? 'SELL' : 'BUY';
        price = '0'; // Price unknown from transfer event
      }

      const trade: DetectedTrade = {
        walletAddress,
        tokenID,
        assetID: tokenID,
        price,
        size,
        side,
        timestamp,
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        eventName,
      };

      // Call all registered callbacks
      this.onTradeCallbacks.forEach((callback) => callback(trade));
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      console.error(`Error parsing trade event:`, errorObj);
      this.onErrorCallbacks.forEach((callback) => callback(errorObj));
    }
  }

}

// ============================================================================
// Default Export
// ============================================================================

export default OnChainMonitor;

