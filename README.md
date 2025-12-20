# Polymarket Copy Trading Bot

An automated copy trading bot for Polymarket that monitors specific wallets and automatically copies their trades with configurable strategies and risk controls.

## Features

- 🔍 **Real-time Wallet Monitoring** - Track multiple wallets for trade detection
- 📊 **Multiple Copy Strategies** - Exact, Scaled, Percentage, and Adaptive copy strategies
- 🛡️ **Risk Management** - Configurable position limits, order value limits, and daily loss limits
- 🎯 **Market Filtering** - Whitelist/blacklist markets and minimum liquidity requirements
- ⚡ **On-Chain Detection** - Real-time trade detection via blockchain event monitoring
- 📈 **Order Management** - Automated order placement and management via Polymarket CLOB API
- ⚙️ **Flexible Configuration** - JSON-based configuration with environment variable support

## Prerequisites

- Node.js 18+ or Bun runtime
- TypeScript 5+
- Polymarket account with API credentials
- Polygon RPC endpoint (for on-chain monitoring)

## Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd polymarket-agent
```

2. Install dependencies:

```bash
bun install
```

or with npm:

```bash
npm install
```

3. Set up environment variables:

```bash
cp .env.example .env
```

Edit `.env` and add your credentials:

```env
# Required
RPC_URL=https://polygon-rpc.com
PRIVATE_KEY=0x...
POLYMARKET_API_KEY=your_api_key
POLYMARKET_SECRET_KEY=your_secret_key
POLYMARKET_PASSPHRASE=your_passphrase

# Optional
FUNDER_ADDRESS=0x...  # Your Polymarket smart contract wallet address
```

4. Configure the bot:

```bash
cp config.example.json config.json
```

Edit `config.json` with your settings:

```json
{
  "trackedWallets": ["0x..."],
  "copyStrategy": "scaled",
  "scaleFactor": 0.01,
  "riskLimits": {
    "maxPositionSize": 10,
    "maxOrderValue": 5,
    "maxDailyLoss": 2
  },
  "tradeDetection": {
    "method": "on-chain",
    "enabled": true
  }
}
```

## Usage

### Start the Bot

```bash
bun run index.ts
```

or with npm:

```bash
npm start
```

### Configuration

The bot uses `config.json` for all settings except sensitive credentials (which go in `.env`):

#### Copy Strategies

- **exact**: Copy trades at exact same size
- **scaled**: Copy trades with a scale factor (e.g., 0.01 = 1%)
- **percentage**: Use a percentage of your balance per trade
- **adaptive**: Adapt to market price with slippage control

#### Risk Limits

- `maxPositionSize`: Maximum total position size in USD
- `maxOrderValue`: Maximum value per order in USD
- `maxDailyLoss`: Maximum daily loss limit in USD
- `maxSlippage`: Maximum slippage tolerance (for adaptive strategy)

#### Market Filters

- `whitelistMarkets`: Only copy trades from these markets
- `blacklistMarkets`: Exclude these markets
- `minMarketLiquidity`: Minimum market liquidity in USD

#### Trade Detection

- `method`: Detection method (`on-chain`, `subgraph`, `on-chain-position`, `market-channel`)
- `rpcUrl`: RPC endpoint (can also be set in `.env`)
- `enabled`: Enable/disable trade detection

## Project Structure

```
polymarket-agent/
├── index.ts                    # Main entry point
├── config.json                 # Bot configuration
├── config.example.json         # Configuration template
├── trackedWallets.json         # Tracked wallet addresses
├── types/
│   └── config.ts              # Configuration types and utilities
├── copyTrading/
│   ├── walletMonitor.ts       # Wallet monitoring orchestrator
│   ├── copyTradingEngine.ts   # Copy trading logic and risk controls
│   └── onchainMonitor.ts      # On-chain event monitoring
├── clob/
│   ├── restService.ts         # CLOB REST API client
│   ├── orderService.ts        # Order management
│   └── websocket/
│       ├── marketChannel.ts   # Market data WebSocket
│       └── userChannel.ts     # User data WebSocket
└── gamma/
    ├── marketService.ts       # Market discovery
    └── profileService.ts      # Profile and trade history
```

## How It Works

1. **Wallet Monitoring**: The bot monitors specified wallet addresses for trades
2. **Trade Detection**: Trades are detected via on-chain event monitoring
3. **Risk Assessment**: Each trade is evaluated against risk limits and filters
4. **Order Calculation**: Copy order parameters are calculated based on the selected strategy
5. **Order Execution**: Orders are placed via Polymarket CLOB API
6. **Position Tracking**: Positions and daily statistics are tracked

## Example: Small Balance Testing

For testing with a small balance (e.g., $10):

```json
{
  "copyStrategy": "scaled",
  "scaleFactor": 0.01,
  "riskLimits": {
    "maxPositionSize": 10,
    "maxOrderValue": 5,
    "maxDailyLoss": 2
  }
}
```

This configuration will:

- Copy trades at 1% of the original size
- Limit each order to maximum $5
- Stop trading if daily loss exceeds $2

## Environment Variables

### Required

- `RPC_URL`: Polygon RPC endpoint URL
- `PRIVATE_KEY`: Your wallet private key
- `POLYMARKET_API_KEY`: Polymarket API key
- `POLYMARKET_SECRET_KEY`: Polymarket API secret
- `POLYMARKET_PASSPHRASE`: Polymarket API passphrase

### Optional

- `FUNDER_ADDRESS`: Your Polymarket smart contract wallet address (found on your Polymarket profile)

## API Documentation

- [Polymarket CLOB API](https://docs.polymarket.com/developers/CLOB)
- [Polymarket Gamma API](https://docs.polymarket.com/developers/gamma-markets-api)
- [Polymarket WebSocket](https://docs.polymarket.com/developers/CLOB/websocket)

## Risk Warning

⚠️ **This bot trades real funds. Use at your own risk.**

- Always test with small amounts first
- Monitor the bot regularly
- Set appropriate risk limits
- Understand the markets you're trading
- Gas fees will reduce your balance over time

## Troubleshooting

### RPC Timeout Errors

If you see timeout errors, try:

- Using a different RPC endpoint
- Increasing timeout settings
- Using a paid RPC service (Alchemy, Infura, etc.)

### Order Failures

Common causes:

- Insufficient balance
- Market liquidity too low
- Order size below minimum
- Invalid token ID

### No Trades Detected

Check:

- Wallet addresses are correct
- RPC endpoint is working
- Contracts are subscribed correctly
- Trade detection is enabled

## Development

### Running Tests

```bash
bun test
```

### Type Checking

```bash
bun run tsc --noEmit
```

### Building

```bash
bun build
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT

## Disclaimer

This software is provided "as is" without warranty of any kind. Trading cryptocurrencies and prediction markets involves substantial risk of loss. The authors and contributors are not responsible for any losses incurred from using this software.
