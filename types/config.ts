// ============================================================================
// Configuration Types and Utilities
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Configuration Schema
// ============================================================================

export type CopyStrategy = 'exact' | 'scaled' | 'percentage' | 'adaptive';

export type TradeDetectionMethod = 
  | 'on-chain' 
  | 'subgraph' 
  | 'on-chain-position' 
  | 'market-channel';

export interface RiskLimits {
  maxPositionSize: number; // In USD
  maxOrderValue: number; // In USD
  maxDailyLoss: number; // In USD
  maxSlippage?: number; // For adaptive copy (e.g., 0.02 = 2%)
}

export interface MarketFilters {
  whitelistMarkets?: string[]; // Condition IDs or Token IDs
  blacklistMarkets?: string[]; // Condition IDs or Token IDs
  minMarketLiquidity?: number; // Minimum liquidity in USD
}

export interface TradeDetectionConfig {
  method: TradeDetectionMethod;
  rpcUrl?: string; // For on-chain monitoring
  subgraphUrl?: string; // For subgraph
  balancePollingInterval?: number; // For on-chain position tracking (in seconds)
  enabled: boolean;
}

export interface CopyTradingConfig {
  trackedWallets: string[]; // Wallet addresses to track
  copyStrategy: CopyStrategy;
  scaleFactor?: number; // For scaled copy (e.g., 0.5 = 50%)
  percentageOfBalance?: number; // For percentage copy (e.g., 0.1 = 10%)
  riskLimits: RiskLimits;
  filters?: MarketFilters;
  tradeDetection: TradeDetectionConfig;
}

// ============================================================================
// Configuration Validation
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate configuration object
 */
export function validateConfig(config: Partial<CopyTradingConfig>): ValidationResult {
  const errors: string[] = [];

  // Required fields
  if (!config.trackedWallets || !Array.isArray(config.trackedWallets)) {
    errors.push('trackedWallets must be an array');
  } else if (config.trackedWallets.length === 0) {
    errors.push('trackedWallets must contain at least one wallet address');
  } else {
    // Validate wallet addresses
    config.trackedWallets.forEach((wallet, index) => {
      if (typeof wallet !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
        errors.push(`trackedWallets[${index}] must be a valid Ethereum address`);
      }
    });
  }

  if (!config.copyStrategy) {
    errors.push('copyStrategy is required');
  } else if (!['exact', 'scaled', 'percentage', 'adaptive'].includes(config.copyStrategy)) {
    errors.push('copyStrategy must be one of: exact, scaled, percentage, adaptive');
  }

  // Strategy-specific validations
  if (config.copyStrategy === 'scaled') {
    if (config.scaleFactor === undefined || config.scaleFactor === null) {
      errors.push('scaleFactor is required for scaled copy strategy');
    } else if (config.scaleFactor <= 0 || config.scaleFactor > 1) {
      errors.push('scaleFactor must be between 0 and 1');
    }
  }

  if (config.copyStrategy === 'percentage') {
    if (config.percentageOfBalance === undefined || config.percentageOfBalance === null) {
      errors.push('percentageOfBalance is required for percentage copy strategy');
    } else if (config.percentageOfBalance <= 0 || config.percentageOfBalance > 1) {
      errors.push('percentageOfBalance must be between 0 and 1');
    }
  }

  if (config.copyStrategy === 'adaptive') {
    if (!config.riskLimits?.maxSlippage) {
      errors.push('maxSlippage is required for adaptive copy strategy');
    } else if (config.riskLimits.maxSlippage < 0 || config.riskLimits.maxSlippage > 1) {
      errors.push('maxSlippage must be between 0 and 1');
    }
  }

  // Risk limits validation
  if (!config.riskLimits) {
    errors.push('riskLimits is required');
  } else {
    if (typeof config.riskLimits.maxPositionSize !== 'number' || config.riskLimits.maxPositionSize <= 0) {
      errors.push('riskLimits.maxPositionSize must be a positive number');
    }
    if (typeof config.riskLimits.maxOrderValue !== 'number' || config.riskLimits.maxOrderValue <= 0) {
      errors.push('riskLimits.maxOrderValue must be a positive number');
    }
    if (typeof config.riskLimits.maxDailyLoss !== 'number' || config.riskLimits.maxDailyLoss <= 0) {
      errors.push('riskLimits.maxDailyLoss must be a positive number');
    }
  }

  // Trade detection validation
  if (!config.tradeDetection) {
    errors.push('tradeDetection is required');
  } else {
    if (!config.tradeDetection.method) {
      errors.push('tradeDetection.method is required');
    } else if (!['on-chain', 'subgraph', 'on-chain-position', 'market-channel'].includes(config.tradeDetection.method)) {
      errors.push('tradeDetection.method must be one of: on-chain, subgraph, on-chain-position, market-channel');
    }

    if (typeof config.tradeDetection.enabled !== 'boolean') {
      errors.push('tradeDetection.enabled must be a boolean');
    }

    if (config.tradeDetection.method === 'on-chain' || config.tradeDetection.method === 'on-chain-position') {
      if (!config.tradeDetection.rpcUrl && !process.env.RPC_URL) {
        errors.push('tradeDetection.rpcUrl or RPC_URL env variable is required for on-chain methods');
      }
    }

    if (config.tradeDetection.method === 'subgraph') {
      if (!config.tradeDetection.subgraphUrl) {
        errors.push('tradeDetection.subgraphUrl is required for subgraph method');
      }
    }

    if (config.tradeDetection.method === 'on-chain-position') {
      if (config.tradeDetection.balancePollingInterval !== undefined) {
        if (typeof config.tradeDetection.balancePollingInterval !== 'number' || config.tradeDetection.balancePollingInterval <= 0) {
          errors.push('tradeDetection.balancePollingInterval must be a positive number');
        }
      }
    }
  }

  // Filters validation (optional)
  if (config.filters) {
    if (config.filters.whitelistMarkets && !Array.isArray(config.filters.whitelistMarkets)) {
      errors.push('filters.whitelistMarkets must be an array');
    }
    if (config.filters.blacklistMarkets && !Array.isArray(config.filters.blacklistMarkets)) {
      errors.push('filters.blacklistMarkets must be an array');
    }
    if (config.filters.minMarketLiquidity !== undefined) {
      if (typeof config.filters.minMarketLiquidity !== 'number' || config.filters.minMarketLiquidity < 0) {
        errors.push('filters.minMarketLiquidity must be a non-negative number');
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ============================================================================
// Configuration Loading
// ============================================================================

/**
 * Load configuration from JSON file
 */
export function loadConfigFromFile(filePath: string): CopyTradingConfig {
  try {
    const fullPath = path.resolve(filePath);
    const fileContent = fs.readFileSync(fullPath, 'utf-8');
    const config = JSON.parse(fileContent) as Partial<CopyTradingConfig>;

    // Merge with environment variables
    const mergedConfig = mergeWithEnv(config);

    // Validate
    const validation = validateConfig(mergedConfig);
    if (!validation.valid) {
      throw new Error(`Invalid configuration: ${validation.errors.join(', ')}`);
    }

    return mergedConfig as CopyTradingConfig;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to load configuration from ${filePath}: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Load configuration from environment variables
 * Note: Only RPC_URL is read from env, other configs should come from JSON file
 */
export function loadConfigFromEnv(): Partial<CopyTradingConfig> {
  // Only load RPC_URL from environment
  const config: Partial<CopyTradingConfig> = {
    tradeDetection: {
      method: 'on-chain',
      rpcUrl: process.env.RPC_URL,
      enabled: true,
    },
  };

  return config;
}

/**
 * Merge configuration with environment variables (only RPC_URL from env)
 */
function mergeWithEnv(config: Partial<CopyTradingConfig>): Partial<CopyTradingConfig> {
  const merged: Partial<CopyTradingConfig> = { ...config };

  // Only override RPC_URL from environment if present
  if (process.env.RPC_URL) {
    if (!merged.tradeDetection) {
      merged.tradeDetection = {
        method: 'on-chain',
        enabled: true,
      };
    }
    merged.tradeDetection.rpcUrl = process.env.RPC_URL;
  }

  return merged;
}

/**
 * Get default configuration
 */
export function getDefaultConfig(): CopyTradingConfig {
  return {
    trackedWallets: [],
    copyStrategy: 'exact',
    riskLimits: {
      maxPositionSize: 1000,
      maxOrderValue: 500,
      maxDailyLoss: 100,
    },
    tradeDetection: {
      method: 'on-chain',
      enabled: true,
    },
  };
}

/**
 * Load configuration with fallback order:
 * 1. JSON file (required, configFilePath or default './config.json')
 * 2. Merge RPC_URL from environment variables
 * 3. Default config (if JSON file not found)
 */
export function loadConfig(configFilePath?: string): CopyTradingConfig {
  const filePath = configFilePath || './config.json';
  
  try {
    // Try to load from JSON file
    const config = loadConfigFromFile(filePath);
    // Merge RPC_URL from env if present
    const mergedConfig = mergeWithEnv(config);
    
    // Validate merged config
    const validation = validateConfig(mergedConfig);
    if (!validation.valid) {
      throw new Error(`Invalid configuration: ${validation.errors.join(', ')}`);
    }
    
    return mergedConfig as CopyTradingConfig;
  } catch (error) {
    // If file not found, try to use defaults with env RPC_URL
    if (error instanceof Error && error.message.includes('ENOENT')) {
      console.warn(`Config file ${filePath} not found, using defaults with RPC_URL from env`);
      const defaultConfig = getDefaultConfig();
      const mergedConfig = mergeWithEnv(defaultConfig);
      return mergedConfig as CopyTradingConfig;
    }
    
    // Re-throw other errors
    throw error;
  }
}

// ============================================================================
// Configuration Adapters
// ============================================================================

/**
 * Convert full CopyTradingConfig to engine-specific config
 * (for backward compatibility with copyTradingEngine.ts)
 */
export function toEngineConfig(
  config: CopyTradingConfig
): {
  copyStrategy: CopyStrategy;
  scaleFactor?: number;
  percentageOfBalance?: number;
  riskLimits: RiskLimits;
  filters?: MarketFilters;
} {
  return {
    copyStrategy: config.copyStrategy,
    scaleFactor: config.scaleFactor,
    percentageOfBalance: config.percentageOfBalance,
    riskLimits: config.riskLimits,
    filters: config.filters,
  };
}

/**
 * Get wallet-specific config from main config
 * (for backward compatibility with walletMonitor.ts)
 */
export function getWalletConfig(
  config: CopyTradingConfig,
  walletAddress: string
): {
  enabled?: boolean;
  copyStrategy?: CopyStrategy;
  scaleFactor?: number;
  percentageOfBalance?: number;
  maxSlippage?: number;
} {
  // For now, return global config values
  // In the future, this could support per-wallet overrides
  return {
    enabled: config.tradeDetection.enabled,
    copyStrategy: config.copyStrategy,
    scaleFactor: config.scaleFactor,
    percentageOfBalance: config.percentageOfBalance,
    maxSlippage: config.riskLimits.maxSlippage,
  };
}

