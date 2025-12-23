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

const POLYMARKET_CONTRACTS = {
  CTF_EXCHANGE: '0xC5d563A36AE78145C45a50134d48A1215220f80a',
  CTF: '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045',
  CTF_EXCHANGE_OLD: '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E',
  USDC_CONTRACT: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
} as const;

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

const ORDER_FILLED_EVENT_TOPIC = ethers.id('OrderFilled(bytes32,address,address,uint256,uint256,uint256,uint256,uint256)');
const ORDERS_MATCHED_EVENT_TOPIC = ethers.id('OrdersMatched(bytes32,address,uint256,uint256,uint256,uint256)');
const TRANSFER_SINGLE_EVENT_TOPIC = ethers.id('TransferSingle(address,address,address,uint256,uint256)');

export class OnChainMonitor {
  private provider: ethers.Provider | null = null;
  private trackedWallets: Set<string> = new Set();
  private isMonitoring: boolean = false;
  private monitoringContracts: string[] = [];
  private lastProcessedBlock: number = 0;
  private ctfExchangeInterface: ethers.Interface;
  private ctfInterface: ethers.Interface;
  private onTradeCallbacks: TradeCallback[] = [];
  private onErrorCallbacks: ErrorCallback[] = [];

  constructor(rpcUrl?: string) {
    const url = rpcUrl || process.env.RPC_URL;
    if (!url) {
      throw new Error('RPC URL is required. Provide it in constructor or set RPC_URL environment variable.');
    }
    this.provider = new ethers.JsonRpcProvider(url);
    this.ctfExchangeInterface = new ethers.Interface(CTF_EXCHANGE_ABI);
    this.ctfInterface = new ethers.Interface(CTF_ABI);
  }

  async loadTrackedWallets(filePath: string = 'trackedWallets.json'): Promise<void> {
    const file = Bun.file(filePath);
    const content = await file.text();
    const data = JSON.parse(content);

    if (data.wallets && Array.isArray(data.wallets)) {
      this.trackedWallets.clear();
      data.wallets.forEach((wallet: string) => {
        if (ethers.isAddress(wallet)) {
          this.trackedWallets.add(wallet.toLowerCase());
        }
      });
    } else {
      throw new Error('Invalid trackedWallets.json format. Expected { "wallets": [...] }');
    }
  }

  addTrackedWallets(addresses: string[]): void {
    addresses.forEach((address) => {
      if (ethers.isAddress(address)) {
        this.trackedWallets.add(address.toLowerCase());
      }
    });
    console.log(`Now tracking ${this.trackedWallets.size} wallet(s)`);
  }

  removeTrackedWallets(addresses: string[]): void {
    addresses.forEach((address) => {
      this.trackedWallets.delete(address.toLowerCase());
    });
    console.log(`Now tracking ${this.trackedWallets.size} wallet(s)`);
  }

  getTrackedWallets(): string[] {
    return Array.from(this.trackedWallets);
  }

  subscribeToPolymarketContracts(contractAddresses?: string[]): void {
    if (contractAddresses && contractAddresses.length > 0) {
      this.monitoringContracts = contractAddresses;
    } else {
      this.monitoringContracts = [
        POLYMARKET_CONTRACTS.CTF_EXCHANGE,
        POLYMARKET_CONTRACTS.CTF_EXCHANGE_OLD,
      ];
    }
  }

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

    if (this.isMonitoring) return;

    this.isMonitoring = true;

    if (!fromBlock) {
      const latestBlock = await this.provider.getBlockNumber();
      fromBlock = Math.max(0, latestBlock - 1000);
    }

    this.lastProcessedBlock = fromBlock;
    console.log(`Starting monitoring from block ${fromBlock}`);

    this.provider.on('block', async (blockNumber) => {
      await this.processNewBlocks(blockNumber);
    });

    await this.processHistoricalBlocks(fromBlock);
  }

  stopMonitoring(): void {
    if (!this.isMonitoring) return;

    this.isMonitoring = false;
    if (this.provider) {
      this.provider.removeAllListeners('block');
    }
    console.log('Monitoring stopped');
  }

  onNewTrade(callback: TradeCallback): void {
    this.onTradeCallbacks.push(callback);
  }

  onError(callback: ErrorCallback): void {
    this.onErrorCallbacks.push(callback);
  }

  removeAllCallbacks(): void {
    this.onTradeCallbacks = [];
    this.onErrorCallbacks = [];
  }

  private async processHistoricalBlocks(fromBlock: number): Promise<void> {
    if (!this.provider) return;

    const latestBlock = await this.provider.getBlockNumber();
    const batchSize = 1000;

    for (let block = fromBlock; block <= latestBlock; block += batchSize) {
      const toBlock = Math.min(block + batchSize - 1, latestBlock);
      await this.processBlockRange(block, toBlock);
    }
  }

  private async processNewBlocks(blockNumber: number): Promise<void> {
    if (!this.isMonitoring || !this.provider) return;

    const fromBlock = this.lastProcessedBlock + 1;
    if (fromBlock <= blockNumber) {
      await this.processBlockRange(fromBlock, blockNumber);
      this.lastProcessedBlock = blockNumber;
    }
  }

  private async processBlockRange(fromBlock: number, toBlock: number): Promise<void> {
    if (!this.provider) return;

    const walletAddresses = Array.from(this.trackedWallets);

    for (const contractAddress of this.monitoringContracts) {
      const isCtfExchange = contractAddress.toLowerCase() === POLYMARKET_CONTRACTS.CTF_EXCHANGE.toLowerCase() ||
                            contractAddress.toLowerCase() === POLYMARKET_CONTRACTS.CTF_EXCHANGE_OLD.toLowerCase();

      if (isCtfExchange) {
        const orderFilledFilterMaker = {
          address: contractAddress,
          topics: [
            ORDER_FILLED_EVENT_TOPIC,
            null,
            walletAddresses.map((addr) => ethers.zeroPadValue(addr, 32)),
          ],
          fromBlock,
          toBlock,
        };

        const orderFilledFilterTaker = {
          address: contractAddress,
          topics: [
            ORDER_FILLED_EVENT_TOPIC,
            null,
            null,
            walletAddresses.map((addr) => ethers.zeroPadValue(addr, 32)),
          ],
          fromBlock,
          toBlock,
        };

        const ordersMatchedFilter = {
          address: contractAddress,
          topics: [
            ORDERS_MATCHED_EVENT_TOPIC,
            null,
            walletAddresses.map((addr) => ethers.zeroPadValue(addr, 32)),
          ],
          fromBlock,
          toBlock,
        };

        const [orderFilledEventsMaker, orderFilledEventsTaker, ordersMatchedEvents] = await Promise.all([
          this.provider.getLogs(orderFilledFilterMaker as any).catch(() => []),
          this.provider.getLogs(orderFilledFilterTaker as any).catch(() => []),
          this.provider.getLogs(ordersMatchedFilter as any).catch(() => []),
        ]);

        const allOrderFilledEvents = [...orderFilledEventsMaker, ...orderFilledEventsTaker];
        const uniqueOrderFilledEvents = Array.from(
          new Map(allOrderFilledEvents.map((e, idx) => [e.transactionHash + idx, e])).values()
        );

        for (const event of uniqueOrderFilledEvents) {
          await this.parseTradeEvent(event, 'OrderFilled', contractAddress);
        }

        for (const event of ordersMatchedEvents) {
          await this.parseTradeEvent(event, 'OrdersMatched', contractAddress);
        }
      } else {
        const transferFilterFrom = {
          address: contractAddress,
          topics: [
            TRANSFER_SINGLE_EVENT_TOPIC,
            null,
            walletAddresses.map((addr) => ethers.zeroPadValue(addr, 32)),
          ],
          fromBlock,
          toBlock,
        };

        const transferFilterTo = {
          address: contractAddress,
          topics: [
            TRANSFER_SINGLE_EVENT_TOPIC,
            null,
            null,
            walletAddresses.map((addr) => ethers.zeroPadValue(addr, 32)),
          ],
          fromBlock,
          toBlock,
        };

        const [transferEventsFrom, transferEventsTo] = await Promise.all([
          this.provider.getLogs(transferFilterFrom as any).catch(() => []),
          this.provider.getLogs(transferFilterTo as any).catch(() => []),
        ]);

        const allTransferEvents = [...transferEventsFrom, ...transferEventsTo];
        const uniqueTransferEvents = Array.from(
          new Map(allTransferEvents.map((e, idx) => [e.transactionHash + idx, e])).values()
        );

        for (const event of uniqueTransferEvents) {
          await this.parseTradeEvent(event, 'TransferSingle', contractAddress);
        }
      }
    }
  }

  private async parseTradeEvent(event: ethers.Log, eventName: string, contractAddress: string): Promise<void> {
    if (!event.topics || event.topics.length < 2) return;

    let walletAddress: string | null = null;
    let decoded: any = null;

    try {
      if (eventName === 'OrderFilled') {
        decoded = this.ctfExchangeInterface.parseLog({
          topics: event.topics as string[],
          data: event.data,
        });

        if (decoded) {
          const maker = decoded.args.maker.toLowerCase();
          const taker = decoded.args.taker.toLowerCase();
          if (this.trackedWallets.has(maker)) {
            walletAddress = decoded.args.maker;
          } else if (this.trackedWallets.has(taker)) {
            walletAddress = decoded.args.taker;
          } else {
            return;
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
            return;
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
          if (from !== ethers.ZeroAddress && this.trackedWallets.has(from)) {
            walletAddress = decoded.args.from;
          } else if (to !== ethers.ZeroAddress && this.trackedWallets.has(to)) {
            walletAddress = decoded.args.to;
          } else {
            return;
          }
        }
      }
    } catch {
      return;
    }

    if (!walletAddress || !decoded) return;

    if (!this.provider) return;
    const block = await this.provider.getBlock(event.blockNumber);
    const timestamp = block?.timestamp || Math.floor(Date.now() / 1000);

    let tokenID = '0';
    let price = '0';
    let size = '0';
    let side: 'BUY' | 'SELL' = 'BUY';

    if (eventName === 'OrderFilled') {
      const makerAssetId = decoded.args.makerAssetId.toString();
      const takerAssetId = decoded.args.takerAssetId.toString();
      const makerAmount = decoded.args.makerAmountFilled.toString();
      const takerAmount = decoded.args.takerAmountFilled.toString();
      const isMaker = walletAddress.toLowerCase() === decoded.args.maker.toLowerCase();

      if (isMaker) {
        tokenID = makerAssetId;
        size = makerAmount;
        if (makerAmount !== '0') {
          price = (BigInt(takerAmount) * BigInt(1e18) / BigInt(makerAmount)).toString();
        }
        side = 'SELL';
      } else {
        tokenID = takerAssetId;
        size = takerAmount;
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
      if (takerAmountFilled !== '0') {
        price = (BigInt(makerAmountFilled) * BigInt(1e18) / BigInt(takerAmountFilled)).toString();
      }
      side = 'BUY';
    } else if (eventName === 'TransferSingle') {
      tokenID = decoded.args.id.toString();
      size = decoded.args.value.toString();
      const isFrom = walletAddress.toLowerCase() === decoded.args.from.toLowerCase();
      side = isFrom ? 'SELL' : 'BUY';
      price = '0';
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

    this.onTradeCallbacks.forEach((callback) => callback(trade));
  }
}

export default OnChainMonitor;
