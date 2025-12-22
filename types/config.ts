import * as fs from 'fs';
import * as path from 'path';

export type CopyStrategy = 'exact' | 'scaled' | 'percentage' | 'adaptive';
export type TradeDetectionMethod = 'on-chain' | 'subgraph' | 'on-chain-position' | 'market-channel';

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

export interface TradeDetectionConfig {
  method: TradeDetectionMethod;
  rpcUrl?: string;
  subgraphUrl?: string;
  balancePollingInterval?: number;
  enabled: boolean;
}

export interface CopyTradingConfig {
  copyStrategy: CopyStrategy;
  scaleFactor?: number;
  percentageOfBalance?: number;
  riskLimits: RiskLimits;
  filters?: MarketFilters;
  tradeDetection: TradeDetectionConfig;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateConfig(config: Partial<CopyTradingConfig>): ValidationResult {
  const errors: string[] = [];

  if (!config.copyStrategy) {
    errors.push('copyStrategy is required');
  } else if (!['exact', 'scaled', 'percentage', 'adaptive'].includes(config.copyStrategy)) {
    errors.push('copyStrategy must be one of: exact, scaled, percentage, adaptive');
  }

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
    if ((config.tradeDetection.method === 'on-chain' || config.tradeDetection.method === 'on-chain-position') && !config.tradeDetection.rpcUrl && !process.env.RPC_URL) {
      errors.push('tradeDetection.rpcUrl or RPC_URL env variable is required for on-chain methods');
    }
    if (config.tradeDetection.method === 'subgraph' && !config.tradeDetection.subgraphUrl) {
      errors.push('tradeDetection.subgraphUrl is required for subgraph method');
    }
  }

  if (config.filters) {
    if (config.filters.whitelistMarkets && !Array.isArray(config.filters.whitelistMarkets)) {
      errors.push('filters.whitelistMarkets must be an array');
    }
    if (config.filters.blacklistMarkets && !Array.isArray(config.filters.blacklistMarkets)) {
      errors.push('filters.blacklistMarkets must be an array');
    }
    if (config.filters.minMarketLiquidity !== undefined && (typeof config.filters.minMarketLiquidity !== 'number' || config.filters.minMarketLiquidity < 0)) {
      errors.push('filters.minMarketLiquidity must be a non-negative number');
    }
  }

  return { valid: errors.length === 0, errors };
}

export function loadConfigFromFile(filePath: string): CopyTradingConfig {
  const fullPath = path.resolve(filePath);
  const fileContent = fs.readFileSync(fullPath, 'utf-8');
  const config = JSON.parse(fileContent) as Partial<CopyTradingConfig>;
  const mergedConfig = mergeWithEnv(config);
  const validation = validateConfig(mergedConfig);
  if (!validation.valid) {
    throw new Error(`Invalid configuration: ${validation.errors.join(', ')}`);
  }
  return mergedConfig as CopyTradingConfig;
}

function mergeWithEnv(config: Partial<CopyTradingConfig>): Partial<CopyTradingConfig> {
  const merged: Partial<CopyTradingConfig> = { ...config };
  if (process.env.RPC_URL) {
    if (!merged.tradeDetection) {
      merged.tradeDetection = { method: 'on-chain', enabled: true };
    }
    merged.tradeDetection.rpcUrl = process.env.RPC_URL;
  }
  return merged;
}

export function getDefaultConfig(): CopyTradingConfig {
  return {
    copyStrategy: 'exact',
    riskLimits: { maxPositionSize: 1000, maxOrderValue: 500, maxDailyLoss: 100 },
    tradeDetection: { method: 'on-chain', enabled: true },
  };
}

export function loadConfig(configFilePath?: string): CopyTradingConfig {
  const filePath = configFilePath || './config.json';
  try {
    const config = loadConfigFromFile(filePath);
    const mergedConfig = mergeWithEnv(config);
    const validation = validateConfig(mergedConfig);
    if (!validation.valid) {
      throw new Error(`Invalid configuration: ${validation.errors.join(', ')}`);
    }
    return mergedConfig as CopyTradingConfig;
  } catch (error) {
    if (error instanceof Error && error.message.includes('ENOENT')) {
      console.warn(`Config file ${filePath} not found, using defaults with RPC_URL from env`);
      const defaultConfig = getDefaultConfig();
      const mergedConfig = mergeWithEnv(defaultConfig);
      return mergedConfig as CopyTradingConfig;
    }
    throw error;
  }
}

export function toEngineConfig(config: CopyTradingConfig) {
  return {
    copyStrategy: config.copyStrategy,
    scaleFactor: config.scaleFactor,
    percentageOfBalance: config.percentageOfBalance,
    riskLimits: config.riskLimits,
    filters: config.filters,
  };
}

export function getWalletConfig(config: CopyTradingConfig, walletAddress: string) {
  return {
    enabled: config.tradeDetection.enabled,
    copyStrategy: config.copyStrategy,
    scaleFactor: config.scaleFactor,
    percentageOfBalance: config.percentageOfBalance,
    maxSlippage: config.riskLimits.maxSlippage,
  };
}
