import OnChainMonitor, { type DetectedTrade } from './onchainMonitor';
import { ethers } from 'ethers';

export type DetectionMethod = 'on-chain' | 'subgraph' | 'on-chain-position' | 'market-channel';

export interface WalletConfig {
  enabled?: boolean;
  copyStrategy?: 'exact' | 'scaled' | 'percentage' | 'adaptive';
  scaleFactor?: number;
  percentageOfBalance?: number;
  maxSlippage?: number;
}

export type TradeCallback = (trade: DetectedTrade, sourceWallet: string) => void;
export type ErrorCallback = (error: Error) => void;

export class WalletMonitor {
  private onChainMonitor: OnChainMonitor | null = null;
  private trackedWallets: Map<string, WalletConfig> = new Map();
  private detectionMethod: DetectionMethod = 'on-chain';
  private isMonitoring: boolean = false;
  private onTradeCallbacks: TradeCallback[] = [];
  private onErrorCallbacks: ErrorCallback[] = [];

  constructor(rpcUrl?: string) {
    const url = rpcUrl || process.env.RPC_URL;
    if (url) {
      this.onChainMonitor = new OnChainMonitor(url);
      this.setupOnChainMonitorCallbacks();
    }
  }

  addWallet(address: string, config?: WalletConfig): void {
    if (!ethers.isAddress(address)) {
      throw new Error(`Invalid wallet address: ${address}`);
    }
    const normalizedAddress = address.toLowerCase();
    this.trackedWallets.set(normalizedAddress, { enabled: true, ...config });
    if (this.onChainMonitor) {
      this.onChainMonitor.addTrackedWallets([address]);
    }
  }

  removeWallet(address: string): void {
    const normalizedAddress = address.toLowerCase();
    if (this.trackedWallets.delete(normalizedAddress)) {
      if (this.onChainMonitor) {
        this.onChainMonitor.removeTrackedWallets([address]);
      }
    }
  }

  async loadWalletsFromFile(filePath: string = 'trackedWallets.json'): Promise<void> {
    if (!this.onChainMonitor) {
      throw new Error('OnChainMonitor not initialized. RPC URL required.');
    }
    await this.onChainMonitor.loadTrackedWallets(filePath);
    const loadedWallets = this.onChainMonitor.getTrackedWallets();
    loadedWallets.forEach((address) => {
      if (!this.trackedWallets.has(address.toLowerCase())) {
        this.trackedWallets.set(address.toLowerCase(), { enabled: true });
      }
    });
  }

  async startMonitoring(fromBlock?: number): Promise<void> {
    if (this.isMonitoring) return;
    if (this.trackedWallets.size === 0) {
      throw new Error('No wallets to monitor. Add wallets first.');
    }
    if (this.detectionMethod === 'on-chain') {
      if (!this.onChainMonitor) {
        throw new Error('OnChainMonitor not initialized. RPC URL required for on-chain detection.');
      }
      await this.onChainMonitor.startMonitoring(fromBlock);
      this.isMonitoring = true;
      console.log('Wallet monitoring started (on-chain method)');
    } else {
      throw new Error(`Detection method "${this.detectionMethod}" not yet implemented`);
    }
  }

  stopMonitoring(): void {
    if (!this.isMonitoring) return;
    if (this.detectionMethod === 'on-chain' && this.onChainMonitor) {
      this.onChainMonitor.stopMonitoring();
    }
    this.isMonitoring = false;
    console.log('Wallet monitoring stopped');
  }

  setDetectionMethod(method: DetectionMethod): void {
    if (this.isMonitoring) {
      throw new Error('Cannot change detection method while monitoring is active. Stop monitoring first.');
    }
    this.detectionMethod = method;
  }

  getDetectionMethod(): DetectionMethod {
    return this.detectionMethod;
  }

  onNewTrade(callback: TradeCallback): void {
    this.onTradeCallbacks.push(callback);
  }

  onError(callback: ErrorCallback): void {
    this.onErrorCallbacks.push(callback);
  }

  getTrackedWallets(): string[] {
    return Array.from(this.trackedWallets.keys());
  }

  getWalletConfig(address: string): WalletConfig | undefined {
    return this.trackedWallets.get(address.toLowerCase());
  }

  updateWalletConfig(address: string, config: Partial<WalletConfig>): void {
    const normalizedAddress = address.toLowerCase();
    const currentConfig = this.trackedWallets.get(normalizedAddress);
    if (currentConfig) {
      this.trackedWallets.set(normalizedAddress, { ...currentConfig, ...config });
    } else {
      throw new Error(`Wallet not found: ${address}`);
    }
  }

  removeAllCallbacks(): void {
    this.onTradeCallbacks = [];
    this.onErrorCallbacks = [];
    if (this.onChainMonitor) {
      this.onChainMonitor.removeAllCallbacks();
    }
  }

  getMonitoringStatus(): boolean {
    return this.isMonitoring;
  }

  private setupOnChainMonitorCallbacks(): void {
    if (!this.onChainMonitor) return;

    this.onChainMonitor.onNewTrade((trade: DetectedTrade) => {
      const walletAddress = trade.walletAddress.toLowerCase();
      const config = this.trackedWallets.get(walletAddress);
      if (!config || config.enabled === false) return;

      this.onTradeCallbacks.forEach((callback) => {
        callback(trade, trade.walletAddress);
      });
    });

    this.onChainMonitor.onError((error: Error) => {
      this.onErrorCallbacks.forEach((callback) => callback(error));
    });
  }
}

export default WalletMonitor;
