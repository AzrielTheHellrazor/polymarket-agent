// ============================================================================
// Type Definitions
// ============================================================================

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

// ============================================================================
// Wallet Monitor Class
// ============================================================================

export class WalletMonitor {
  private onChainMonitor: OnChainMonitor | null = null;
  private trackedWallets: Map<string, WalletConfig> = new Map();
  private detectionMethod: DetectionMethod = 'on-chain';
  private isMonitoring: boolean = false;
  private rpcUrl: string | undefined;

  // Event callbacks
  private onTradeCallbacks: TradeCallback[] = [];
  private onErrorCallbacks: ErrorCallback[] = [];

  /**
   * Initialize Wallet Monitor
   * @param rpcUrl - RPC provider URL for on-chain monitoring
   */
  constructor(rpcUrl?: string) {
    this.rpcUrl = rpcUrl || process.env.RPC_URL;
    
    if (this.rpcUrl) {
      this.onChainMonitor = new OnChainMonitor(this.rpcUrl);
      this.setupOnChainMonitorCallbacks();
    }
  }

  /**
   * Add wallet to monitoring list
   * @param address - Wallet address to track
   * @param config - Optional wallet-specific configuration
   */
  addWallet(address: string, config?: WalletConfig): void {
    if (!ethers.isAddress(address)) {
      throw new Error(`Invalid wallet address: ${address}`);
    }

    const normalizedAddress = address.toLowerCase();
    this.trackedWallets.set(normalizedAddress, {
      enabled: true,
      ...config,
    });

    // Add to OnChainMonitor if available
    if (this.onChainMonitor) {
      this.onChainMonitor.addTrackedWallets([address]);
    }

    console.log(`Added wallet to monitoring: ${address}`);
  }

  /**
   * Remove wallet from monitoring list
   * @param address - Wallet address to remove
   */
  removeWallet(address: string): void {
    const normalizedAddress = address.toLowerCase();
    
    if (this.trackedWallets.delete(normalizedAddress)) {
      // Remove from OnChainMonitor if available
      if (this.onChainMonitor) {
        this.onChainMonitor.removeTrackedWallets([address]);
      }
      console.log(`Removed wallet from monitoring: ${address}`);
    }
  }

  /**
   * Load wallets from trackedWallets.json file
   * @param filePath - Path to trackedWallets.json file
   */
  async loadWalletsFromFile(filePath: string = 'trackedWallets.json'): Promise<void> {
    if (!this.onChainMonitor) {
      throw new Error('OnChainMonitor not initialized. RPC URL required.');
    }

    await this.onChainMonitor.loadTrackedWallets(filePath);

    // Get loaded wallets and add to our tracking map
    const loadedWallets = this.onChainMonitor.getTrackedWallets();
    loadedWallets.forEach((address) => {
      if (!this.trackedWallets.has(address.toLowerCase())) {
        this.trackedWallets.set(address.toLowerCase(), { enabled: true });
      }
    });
  }

  /**
   * Start monitoring wallets
   * @param fromBlock - Optional block number to start from
   */
  async startMonitoring(fromBlock?: number): Promise<void> {
    if (this.isMonitoring) {
      console.warn('Monitoring already started');
      return;
    }

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

  /**
   * Stop monitoring wallets
   */
  stopMonitoring(): void {
    if (!this.isMonitoring) {
      return;
    }

    if (this.detectionMethod === 'on-chain' && this.onChainMonitor) {
      this.onChainMonitor.stopMonitoring();
    }

    this.isMonitoring = false;
    console.log('Wallet monitoring stopped');
  }

  /**
   * Set trade detection method
   * @param method - Detection method to use
   */
  setDetectionMethod(method: DetectionMethod): void {
    if (this.isMonitoring) {
      throw new Error('Cannot change detection method while monitoring is active. Stop monitoring first.');
    }

    this.detectionMethod = method;
    console.log(`Detection method set to: ${method}`);
  }

  /**
   * Get current detection method
   */
  getDetectionMethod(): DetectionMethod {
    return this.detectionMethod;
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
   * Get list of tracked wallets
   */
  getTrackedWallets(): string[] {
    return Array.from(this.trackedWallets.keys());
  }

  /**
   * Get wallet configuration
   * @param address - Wallet address
   */
  getWalletConfig(address: string): WalletConfig | undefined {
    return this.trackedWallets.get(address.toLowerCase());
  }

  /**
   * Update wallet configuration
   * @param address - Wallet address
   * @param config - Updated configuration
   */
  updateWalletConfig(address: string, config: Partial<WalletConfig>): void {
    const normalizedAddress = address.toLowerCase();
    const currentConfig = this.trackedWallets.get(normalizedAddress);
    
    if (currentConfig) {
      this.trackedWallets.set(normalizedAddress, {
        ...currentConfig,
        ...config,
      });
      console.log(`Updated config for wallet: ${address}`);
    } else {
      throw new Error(`Wallet not found: ${address}`);
    }
  }

  /**
   * Remove all callbacks
   */
  removeAllCallbacks(): void {
    this.onTradeCallbacks = [];
    this.onErrorCallbacks = [];
    
    if (this.onChainMonitor) {
      this.onChainMonitor.removeAllCallbacks();
    }
  }

  /**
   * Get monitoring status
   */
  getMonitoringStatus(): boolean {
    return this.isMonitoring;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private setupOnChainMonitorCallbacks(): void {
    if (!this.onChainMonitor) return;

    this.onChainMonitor.onNewTrade((trade: DetectedTrade) => {
      const walletAddress = trade.walletAddress.toLowerCase();
      const config = this.trackedWallets.get(walletAddress);

      // Check if wallet is enabled
      if (!config || config.enabled === false) {
        return;
      }

      // Forward trade to registered callbacks
      this.onTradeCallbacks.forEach((callback) => {
        try {
          callback(trade, trade.walletAddress);
        } catch (error) {
          const errorObj = error instanceof Error ? error : new Error(String(error));
          this.onErrorCallbacks.forEach((errCallback) => errCallback(errorObj));
        }
      });
    });

    this.onChainMonitor.onError((error: Error) => {
      this.onErrorCallbacks.forEach((callback) => callback(error));
    });
  }
}

// ============================================================================
// Default Export
// ============================================================================

export default WalletMonitor;

