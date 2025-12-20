// ============================================================================
// Polymarket Copy Trading Bot - Main Entry Point
// ============================================================================

import { loadConfig, validateConfig, toEngineConfig, getWalletConfig } from './types/config';
import WalletMonitor from './copyTrading/walletMonitor';
import { CopyTradingEngine } from './copyTrading/copyTradingEngine';
import { createOrderService } from './clob/orderService';

/**
 * Main function to start the copy trading bot
 */
async function main() {
  try {
    console.log('🚀 Starting Polymarket Copy Trading Bot...\n');

    // 1. Load configuration
    console.log('📋 Loading configuration...');
    const config = loadConfig('./config.json');
    
    // Validate configuration
    const validation = validateConfig(config);
    if (!validation.valid) {
      console.error('❌ Configuration errors:');
      validation.errors.forEach(error => console.error(`   - ${error}`));
      process.exit(1);
    }
    console.log('✅ Configuration loaded and validated\n');

    // 2. Check required environment variables
    const requiredEnvVars = [
      'RPC_URL',
      'PRIVATE_KEY',
      'POLYMARKET_API_KEY',
      'POLYMARKET_SECRET_KEY',
      'POLYMARKET_PASSPHRASE',
    ];

    const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
    if (missingEnvVars.length > 0) {
      console.error('❌ Missing required environment variables:');
      missingEnvVars.forEach(varName => console.error(`   - ${varName}`));
      process.exit(1);
    }
    
    // FUNDER_ADDRESS is optional but recommended
    if (!process.env.FUNDER_ADDRESS) {
      console.warn('⚠️  FUNDER_ADDRESS not set. This is your Polymarket smart contract wallet address.');
      console.warn('   You can find it on Polymarket profile (below your profile picture).');
      console.warn('   If using Magic Link (email login), this is required.\n');
    } else {
      console.log(`✅ FUNDER_ADDRESS: ${process.env.FUNDER_ADDRESS}\n`);
    }
    console.log('✅ All required environment variables are set\n');

    // 3. Initialize WalletMonitor
    console.log('👀 Initializing Wallet Monitor...');
    const walletMonitor = new WalletMonitor(
      config.tradeDetection.rpcUrl || process.env.RPC_URL
    );
    
    // Set detection method
    walletMonitor.setDetectionMethod(config.tradeDetection.method);
    console.log(`   Detection method: ${config.tradeDetection.method}`);
    
    // Add tracked wallets
    console.log(`   Adding ${config.trackedWallets.length} tracked wallet(s)...`);
    for (const wallet of config.trackedWallets) {
      const walletConfig = getWalletConfig(config, wallet);
      walletMonitor.addWallet(wallet, walletConfig);
      console.log(`   ✓ ${wallet}`);
    }
    console.log('✅ Wallet Monitor initialized\n');

    // 4. Initialize OrderService
    console.log('📦 Initializing Order Service...');
    const orderService = await createOrderService(
      process.env.PRIVATE_KEY!,
      process.env.FUNDER_ADDRESS, // Optional funder address
      1, // signatureType (1 = Magic/Email Login)
      {
        key: process.env.POLYMARKET_API_KEY!,
        secret: process.env.POLYMARKET_SECRET_KEY!,
        passphrase: process.env.POLYMARKET_PASSPHRASE!,
      },
      'https://clob.polymarket.com', // host
      137 // Polygon chain ID
    );
    console.log('✅ Order Service initialized\n');

    // 5. Initialize CopyTradingEngine
    console.log('⚙️  Initializing Copy Trading Engine...');
    const engineConfig = toEngineConfig(config);
    const copyEngine = new CopyTradingEngine(
      orderService,
      engineConfig,
      process.env.FUNDER_ADDRESS,
      config.tradeDetection.rpcUrl
    );
    console.log(`   Copy strategy: ${config.copyStrategy}`);
    console.log(`   Risk limits: maxPosition=${config.riskLimits.maxPositionSize}, maxOrder=${config.riskLimits.maxOrderValue}, maxDailyLoss=${config.riskLimits.maxDailyLoss}`);
    console.log('✅ Copy Trading Engine initialized\n');

    // 6. Set up trade handler
    console.log('🔗 Setting up trade handlers...');
    walletMonitor.onNewTrade(async (trade, sourceWallet) => {
      console.log(`\n📊 New trade detected from ${sourceWallet}:`);
      console.log(`   Token ID: ${trade.tokenID}`);
      console.log(`   Side: ${trade.side}`);
      console.log(`   Size: ${trade.size}`);
      console.log(`   Price: ${trade.price}`);
      
      try {
        await copyEngine.processTrade(trade, sourceWallet);
        console.log('✅ Trade processed successfully');
      } catch (error) {
        console.error('❌ Error processing trade:', error);
      }
    });

    walletMonitor.onError((error) => {
      console.error('❌ Wallet Monitor error:', error);
    });
    console.log('✅ Trade handlers set up\n');

    // 7. Start monitoring
    if (config.tradeDetection.enabled) {
      console.log('▶️  Starting trade monitoring...');
      await walletMonitor.startMonitoring();
      console.log('✅ Copy trading bot is now running!\n');
      console.log('📡 Monitoring wallets for trades...');
      console.log('   Press Ctrl+C to stop\n');
    } else {
      console.log('⚠️  Trade detection is disabled in configuration');
      console.log('   Set tradeDetection.enabled to true to start monitoring');
    }

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n\n🛑 Shutting down...');
      walletMonitor.stopMonitoring();
      console.log('✅ Bot stopped gracefully');
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('\n\n🛑 Shutting down...');
      walletMonitor.stopMonitoring();
      console.log('✅ Bot stopped gracefully');
      process.exit(0);
    });

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

// Start the bot
if (require.main === module) {
  main().catch((error) => {
    console.error('❌ Unhandled error:', error);
    process.exit(1);
  });
}

export default main;
