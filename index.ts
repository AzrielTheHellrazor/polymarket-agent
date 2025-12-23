import { loadConfig, validateConfig, toEngineConfig } from './types/config';
import WalletMonitor from './copyTrading/walletMonitor';
import { CopyTradingEngine } from './copyTrading/copyTradingEngine';
import { createOrderService } from './clob/orderService';

async function main() {
  const config = loadConfig('./config.json');
  const validation = validateConfig(config);
  if (!validation.valid) {
    console.error('❌ Configuration errors:');
    validation.errors.forEach(error => console.error(`   - ${error}`));
    process.exit(1);
  }

  const requiredEnvVars = ['RPC_URL', 'PRIVATE_KEY'];
  const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
  if (missingEnvVars.length > 0) {
    console.error('❌ Missing required environment variables:');
    missingEnvVars.forEach(varName => console.error(`   - ${varName}`));
    process.exit(1);
  }
    console.log(`✅ FUNDER_ADDRESS: ${process.env.FUNDER_ADDRESS}\n`);

  const walletMonitor = new WalletMonitor(config.tradeDetection.rpcUrl || process.env.RPC_URL);
  walletMonitor.setDetectionMethod(config.tradeDetection.method);

  await walletMonitor.loadWalletsFromFile('trackedWallets.json');
  const trackedWallets = walletMonitor.getTrackedWallets();
  if (trackedWallets.length === 0) {
    console.warn('⚠️  No wallets found in trackedWallets.json');
  } else {
    console.log(`   ✓ Loaded ${trackedWallets.length} wallet(s)`);
    trackedWallets.forEach(wallet => console.log(`   ✓ ${wallet}`));
  }
  console.log('✅ Wallet Monitor initialized\n');

  const orderService = await createOrderService(
    process.env.PRIVATE_KEY!,
  );

  console.log('⚙️  Initializing Copy Trading Engine...');
  const copyEngine = new CopyTradingEngine(
    orderService,
    toEngineConfig(config),
    process.env.FUNDER_ADDRESS,
    config.tradeDetection.rpcUrl
  );
  console.log('✅ Copy Trading Engine initialized\n');

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

  if (config.tradeDetection.enabled) {
    console.log('▶️  Starting trade monitoring...');
    await walletMonitor.startMonitoring();
    console.log('✅ Copy trading bot is now running!');
    console.log('📡 Monitoring wallets for trades...');
  } else {
    console.log('⚠️  Trade detection is disabled in configuration');
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('❌ Unhandled error:', error);
    process.exit(1);
  });
}

export default main;
