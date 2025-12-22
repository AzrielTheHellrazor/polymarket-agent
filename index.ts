import { loadConfig, validateConfig, toEngineConfig } from './types/config';
import WalletMonitor from './copyTrading/walletMonitor';
import { CopyTradingEngine } from './copyTrading/copyTradingEngine';
import { createOrderService } from './clob/orderService';

async function main() {
  console.log('🚀 Starting Polymarket Copy Trading Bot...\n');

  const config = loadConfig('./config.json');
  const validation = validateConfig(config);
  if (!validation.valid) {
    console.error('❌ Configuration errors:');
    validation.errors.forEach(error => console.error(`   - ${error}`));
    process.exit(1);
  }
  console.log('✅ Configuration loaded and validated\n');

  const requiredEnvVars = ['RPC_URL', 'PRIVATE_KEY', 'POLYMARKET_API_KEY', 'POLYMARKET_SECRET_KEY', 'POLYMARKET_PASSPHRASE'];
  const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
  if (missingEnvVars.length > 0) {
    console.error('❌ Missing required environment variables:');
    missingEnvVars.forEach(varName => console.error(`   - ${varName}`));
    process.exit(1);
  }

  if (process.env.FUNDER_ADDRESS) {
    console.log(`✅ FUNDER_ADDRESS: ${process.env.FUNDER_ADDRESS}\n`);
  }

  console.log('👀 Initializing Wallet Monitor...');
  const walletMonitor = new WalletMonitor(config.tradeDetection.rpcUrl || process.env.RPC_URL);
  walletMonitor.setDetectionMethod(config.tradeDetection.method);
  console.log(`   Detection method: ${config.tradeDetection.method}`);

  console.log('   Loading tracked wallets from trackedWallets.json...');
  await walletMonitor.loadWalletsFromFile('trackedWallets.json');
  const trackedWallets = walletMonitor.getTrackedWallets();
  if (trackedWallets.length === 0) {
    console.warn('⚠️  No wallets found in trackedWallets.json');
  } else {
    console.log(`   ✓ Loaded ${trackedWallets.length} wallet(s)`);
    trackedWallets.forEach(wallet => console.log(`   ✓ ${wallet}`));
  }
  console.log('✅ Wallet Monitor initialized\n');

  console.log('📦 Initializing Order Service...');
  const normalApiCreds = {
    key: process.env.POLYMARKET_API_KEY!,
    secret: process.env.POLYMARKET_SECRET_KEY!,
    passphrase: process.env.POLYMARKET_PASSPHRASE!,
  };

  const builderApiCreds = (process.env.POLY_BUILDER_API_KEY && 
                           (process.env.POLY_BUILDER_SECRET || process.env.POLY_BUILDER_SECRET_KEY) && 
                           process.env.POLY_BUILDER_PASSPHRASE) ? {
    key: process.env.POLY_BUILDER_API_KEY,
    secret: process.env.POLY_BUILDER_SECRET || process.env.POLY_BUILDER_SECRET_KEY || '',
    passphrase: process.env.POLY_BUILDER_PASSPHRASE,
  } : undefined;

  const orderService = await createOrderService(
    process.env.PRIVATE_KEY!,
    process.env.FUNDER_ADDRESS,
    process.env.FUNDER_ADDRESS ? 2 : 1,
    normalApiCreds,
    builderApiCreds
  );
  console.log('✅ Order Service initialized\n');

  console.log('⚙️  Initializing Copy Trading Engine...');
  const copyEngine = new CopyTradingEngine(
    orderService,
    toEngineConfig(config),
    process.env.FUNDER_ADDRESS,
    config.tradeDetection.rpcUrl
  );
  console.log(`   Copy strategy: ${config.copyStrategy}`);
  console.log(`   Risk limits: maxPosition=${config.riskLimits.maxPositionSize}, maxOrder=${config.riskLimits.maxOrderValue}, maxDailyLoss=${config.riskLimits.maxDailyLoss}`);
  console.log('✅ Copy Trading Engine initialized\n');

  console.log('🔗 Setting up trade handlers...');
  walletMonitor.onNewTrade(async (trade, sourceWallet) => {
    console.log(`\n📊 New trade detected from ${sourceWallet}:`);
    console.log(`   Token ID: ${trade.tokenID}, Side: ${trade.side}, Size: ${trade.size}, Price: ${trade.price}`);

    const orderPlaced = await copyEngine.processTrade(trade, sourceWallet);
    if (orderPlaced) {
      console.log('✅ Trade processed and ORDER PLACED successfully');
    } else {
      console.log('⚠️  Trade processed but NO ORDER PLACED (filtered by risk controls)');
    }
  });

  walletMonitor.onError((error) => {
    console.error('❌ Wallet Monitor error:', error);
  });
  console.log('✅ Trade handlers set up\n');

  if (config.tradeDetection.enabled) {
    console.log('▶️  Starting trade monitoring...');
    await walletMonitor.startMonitoring();
    console.log('✅ Copy trading bot is now running!\n');
    console.log('📡 Monitoring wallets for trades...');
    console.log('   Press Ctrl+C to stop\n');
  } else {
    console.log('⚠️  Trade detection is disabled in configuration');
  }

  process.on('SIGINT', () => {
    console.log('\n\n🛑 Shutting down...');
    walletMonitor.stopMonitoring();
    console.log('✅ Bot stopped gracefully');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n\n🛑 Shutting down...');
    walletMonitor.stopMonitoring();
    console.log('✅ Bot stopped gracefully');
    process.exit(0);
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error('❌ Unhandled error:', error);
    process.exit(1);
  });
}

export default main;
