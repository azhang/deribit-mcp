# Deribit MCP Server

An MCP (Model Context Protocol) server that provides access to Deribit's public API endpoints for cryptocurrency market data.

## Features

This MCP server exposes the following tools for accessing Deribit market data:

### Single-Instrument Tools
- **getTicker** - Get current ticker information (prices, volume, bid/ask spreads)
- **getOrderBook** - Retrieve order book with bids and asks
- **getIndexPrice** - Get current index price for a currency
- **getOptionsChain** - Get complete options chain with real-time greeks (WebSocket) ⚡
- **getInstruments** - List available trading instruments
- **getLastTrades** - Fetch recent trade history
- **getCurrencies** - Get all available currencies
- **getExpirations** - Get available expiration dates for instruments
- **getFundingRate** - Get current funding rate for perpetual contracts
- **getFundingRateHistory** - Get historical funding rate data
- **getBookSummaryByInstrument** - Get detailed summary for a specific instrument
- **getTradingviewChartData** - Get OHLCV chart data

### Multi-Instrument Tools (Batch Queries)
- **getTickers** - Get ticker data for multiple instruments (single WebSocket) ⚡
- **getOrderBooks** - Get order books for multiple instruments (parallel)
- **getIndexPrices** - Get index prices for multiple indices (parallel)
- **getOptionsChains** - Get options chains for multiple expiries (single WebSocket) ⚡

### Volatility & Analytics
- **getVolatilityIndexData** - Get DVOL volatility index data
- **getHistoricalVolatility** - Get historical volatility calculations
- **getCombos** - Get combo instruments (multi-leg strategies)
- **getBookSummaryByCurrency** - Summary of all instruments for a currency
- **getDeliveryPrices** - Historical delivery/settlement prices

### Architecture

This server uses a **hybrid HTTP + WebSocket approach**:
- **HTTP (REST)** for simple queries and instrument discovery
- **WebSocket** for real-time options data with greeks and live updates

## Installation

```bash
# Clone the repository
cd deribit-mcp

# Install dependencies
npm install
```

## Usage

The server supports two modes:
- **stdio** - For local use with any MCP client
- **Cloudflare Workers** - For remote deployment with global edge network

### Local stdio mode

The stdio mode runs the MCP server as a local process that Claude Desktop spawns and communicates with directly via stdin/stdout. This is the simplest way to use the server locally.

1. Open Claude Desktop settings and click "Edit Config" or manually edit:
   - **MacOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

2. Add this configuration:
```json
{
  "mcpServers": {
    "deribit": {
      "command": "node",
      "args": [
        "/absolute/path/to/deribit-mcp/src/stdio.js"
      ]
    }
  }
}
```

3. Replace `/absolute/path/to/deribit-mcp` with the actual path to this project
4. Restart Claude Desktop

**Example with absolute path:**
```json
{
  "mcpServers": {
    "deribit": {
      "command": "node",
      "args": [
        "/Users/yourname/projects/deribit-mcp/src/stdio.js"
      ]
    }
  }
}
```

### Remote via Cloudflare Workers

The remote mode connects to an MCP server running on Cloudflare Workers via HTTP/SSE. This allows you to access the server from anywhere and share it across multiple clients.

**For local development:**

1. Start the dev server: `npm run dev`
2. Edit your Claude Desktop config:
```json
{
  "mcpServers": {
    "deribit-remote": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "http://localhost:8787/sse"
      ]
    }
  }
}
```

3. Restart Claude Desktop

**For production deployment:**

1. Deploy to Cloudflare Workers (see Deployment section below)
2. Edit your Claude Desktop config:
```json
{
  "mcpServers": {
    "deribit-remote": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://deribit.mcp.x.zip/sse"
      ]
    }
  }
}
```
or `"https://deribit-mcp.<your-subdomain>.workers.dev/sse"`

3. Replace `<your-subdomain>` with your Cloudflare Workers subdomain
4. Restart Claude Desktop

## Deployment

### Local Testing (stdio mode)

Run the stdio server locally for testing:

```bash
npm run stdio
```

### Local Testing (Workers dev mode)

Run the Cloudflare Workers development server:

```bash
npm run dev
```

Server will be available at `http://localhost:8787`

To connect from Claude Desktop, use the `/sse` endpoint:
```
http://localhost:8787/sse
```

### Cloudflare Workers

Deploy to Cloudflare for global edge deployment with automatic CI/CD via GitHub Actions.

**Required Secrets (one-time setup):**

1. Get your Cloudflare credentials:
   - Go to [Cloudflare Dashboard](https://dash.cloudflare.com/profile/api-tokens)
   - Click "Create Token" → Use "Edit Cloudflare Workers" template
   - Copy your API token
   - Find your Account ID in the Workers dashboard URL or sidebar

2. Add secrets to your GitHub repository:
   - Go to Settings → Secrets and variables → Actions
   - Add **`CLOUDFLARE_API_TOKEN`** - Your API token from step 1
   - Add **`CLOUDFLARE_ACCOUNT_ID`** - Your Account ID from step 1

3. Deploy:
   ```bash
   # Automatic deployment via GitHub Actions on push to main
   git push origin main

   # Or manual deployment
   npm run deploy
   ```

**How it works:**
- Pushes to `main` branch automatically deploy to production
- Pull requests automatically create preview deployments
- Your server will be available at: `https://deribit-mcp.<your-subdomain>.workers.dev`

**Configuration:**
- Edit `wrangler.toml` to customize your deployment
- See `.github/workflows/deploy.yml` for CI/CD pipeline

### With MCP Inspector

For interactive debugging and testing:

**stdio mode:**
```bash
npx @modelcontextprotocol/inspector node src/stdio.js
```

## Available Tools

### getOptionsChain ⚡

Get complete options chain for a specific expiry with real-time greeks, prices, volumes, and open interest. Returns data in CSV format for easy table viewing.

**Uses WebSocket for efficient real-time data.**

**Parameters:**
- `currency` (required): **Settlement currency** for the options. Valid values: BTC, ETH, USDC, USDT, EURR
  - Use `"USDC"` for USDC-settled options (ETH_USDC, SOL_USDC, AVAX_USDC, etc.)
  - Use `"BTC"` for BTC-settled options (ETH, SOL, etc.)
  - Use `"ETH"` for ETH-settled options
- `expiry` (required): Expiry date in format "9OCT25", "27MAR25", or "DDMMMYY"
- `minStrike` (optional): Minimum strike price filter
- `maxStrike` (optional): Maximum strike price filter

**Examples:**

For USDC-settled ETH options (ETH_USDC):
```json
{
  "currency": "USDC",
  "expiry": "31OCT25",
  "minStrike": 4000,
  "maxStrike": 5000
}
```

For BTC-settled ETH options (ETH):
```json
{
  "currency": "BTC",
  "expiry": "27MAR26"
}
```

**Output Format (CSV):**
```csv
# Currency: USDC
# Expiry: 31OCT25
# Timestamp: 1759922575385
# Underlying: 4494.76
# Index: 4495.25
strike,type,instrument_name,mark_price,bid_price,ask_price,bid_amount,ask_amount,last_price,volume_24h,open_interest,delta,gamma,vega,theta,rho,mark_iv,bid_iv,ask_iv
4000,call,ETH_USDC-31OCT25-4000-C,495.42,494.0,497.0,75.0,50.0,495.0,23.4,102.5,0.9901,0.0001,0.02,-0.85,0.012,45.2,44.8,46.1
4000,put,ETH_USDC-31OCT25-4000-P,0.18,0.1,0.3,100.0,80.0,0.2,10.5,45.0,-0.0099,0.0001,0.02,-0.05,-0.001,45.2,44.5,46.5
...
```

**How it works:**
1. Fetches all option instruments via HTTP `get_instruments`
2. Filters by expiry date
3. Subscribes to all instruments via WebSocket
4. Waits for initial ticker snapshots with greeks
5. Returns formatted CSV table

### getTicker
Get real-time ticker information for any Deribit instrument.

**Parameters:**
- `instrumentName` (required): Instrument name (e.g., "BTC-PERPETUAL", "ETH-25OCT24-3000-C")

**Example:**
```json
{
  "instrumentName": "BTC-PERPETUAL"
}
```

### getOrderBook
Retrieve the current order book showing bids and asks.

**Parameters:**
- `instrumentName` (required): Instrument name
- `depth` (optional): Order book depth

**Example:**
```json
{
  "instrumentName": "BTC-PERPETUAL",
  "depth": 5
}
```

### getInstruments
List all available trading instruments for a currency. Returns CSV format.

**Parameters:**
- `currency` (required): Currency symbol (e.g., "BTC", "ETH", "SOL")
- `kind` (optional): Instrument type ("future", "option", "spot", "future_combo", "option_combo")
- `expired` (optional): Include expired instruments (default: false)

**Example:**
```json
{
  "currency": "BTC",
  "kind": "future"
}
```

### getLastTrades
Get recent trade history for an instrument.

**Parameters:**
- `instrumentName` (required): Instrument name
- `count` (optional): Number of trades (default: 10, max: 1000)
- `includeOld` (optional): Include old trades (default: false)

**Example:**
```json
{
  "instrumentName": "ETH-PERPETUAL",
  "count": 50
}
```

### getCurrencies
Get all available currencies with their properties.

**Parameters:** None

### getIndexPrice
Get the current index price calculated from multiple exchanges.

**Parameters:**
- `indexName` (required): Index name (e.g., "btc_usd", "eth_usd", "sol_usd")

**Example:**
```json
{
  "indexName": "btc_usd"
}
```

### getExpirations
Get available expiration dates for instruments. Much more efficient than calling getInstruments to find expirations. Returns CSV format.

**Parameters:**
- `currency` (required): Currency symbol: BTC, ETH, USDC, USDT, 'any' for all, or 'grouped' for all grouped by currency
- `kind` (required): Instrument kind: 'future', 'option', or 'any'
- `currencyPair` (optional): Optional currency pair filter (e.g., 'eth_usdc', 'btc_usd', 'sol_usdc')

**Example:**
```json
{
  "currency": "ETH",
  "kind": "option"
}
```

### getTickers ⚡
Get ticker data for multiple instruments using a single WebSocket connection. Much more efficient than calling `getTicker` multiple times.

**Uses a single WebSocket connection for all instruments.**

**Parameters:**
- `instrumentNames` (required): Array of instrument names

**Example:**
```json
{
  "instrumentNames": ["BTC-PERPETUAL", "ETH-PERPETUAL", "SOL-PERPETUAL"]
}
```

**Output:** JSON object with instrument names as keys and ticker data as values.

### getOrderBooks
Get order books for multiple instruments using parallel HTTP requests.

**Parameters:**
- `instrumentNames` (required): Array of instrument names
- `depth` (optional): Order book depth

**Example:**
```json
{
  "instrumentNames": ["BTC-PERPETUAL", "ETH-PERPETUAL"],
  "depth": 5
}
```

**Output:** JSON object with instrument names as keys and order book data as values.

### getIndexPrices
Get index prices for multiple indices using parallel HTTP requests.

**Parameters:**
- `indexNames` (required): Array of index names

**Example:**
```json
{
  "indexNames": ["btc_usd", "eth_usd", "sol_usd"]
}
```

**Output:** JSON object with index names as keys and price data as values.

### getOptionsChains ⚡
Get options chains for multiple expiries using a single WebSocket connection. Extremely efficient for getting data across multiple expiry dates.

**Uses a single WebSocket connection for all instruments across all expiries.**

**Parameters:**
- `currency` (required): Currency symbol (e.g., "BTC", "ETH", "USDC")
- `expiries` (required): Array of expiry dates in format "9OCT25" or "DDMMMYY"
- `minStrike` (optional): Minimum strike price filter
- `maxStrike` (optional): Maximum strike price filter

**Example:**
```json
{
  "currency": "BTC",
  "expiries": ["10OCT25", "17OCT25", "24OCT25"],
  "minStrike": 100000,
  "maxStrike": 130000
}
```

**Output:** Text with CSV data for each expiry, separated by headers.

### getVolatilityIndexData
Get the current Deribit Volatility Index (DVOL) data, which represents the 30-day implied volatility.

**Parameters:**
- `currency` (required): Currency symbol (e.g., "BTC", "ETH")

**Example:**
```json
{
  "currency": "BTC"
}
```

**Output:** JSON object with DVOL level, changes, and timestamp.

### getHistoricalVolatility
Get historical realized volatility data for a currency.

**Parameters:**
- `currency` (required): Currency symbol (e.g., "BTC", "ETH")

**Example:**
```json
{
  "currency": "ETH"
}
```

**Output:** JSON array with historical volatility calculations at different time periods.

### getCombos
Get available combo instruments (multi-leg strategies like spreads, straddles, etc.).

**Parameters:**
- `currency` (required): Currency symbol (e.g., "BTC", "ETH")

**Example:**
```json
{
  "currency": "BTC"
}
```

**Output:** JSON array of combo instruments with their components and properties.

### getFundingRate
Get the current and predicted funding rates for perpetual contracts.

**Parameters:**
- `instrumentName` (required): The perpetual instrument name (e.g., "BTC-PERPETUAL")

**Example:**
```json
{
  "instrumentName": "ETH-PERPETUAL"
}
```

**Output:** JSON object with current funding rate, predicted rate, and funding timestamps.

### getFundingRateHistory
Get historical funding rate data for analyzing funding rate trends over time.

**Parameters:**
- `instrumentName` (required): The perpetual instrument name (e.g., "BTC-PERPETUAL")
- `startTimestamp` (optional): Start time in UNIX milliseconds
- `endTimestamp` (optional): End time in UNIX milliseconds

**Example:**
```json
{
  "instrumentName": "BTC-PERPETUAL",
  "startTimestamp": 1704067200000,
  "endTimestamp": 1704153600000
}
```

**Output:** JSON array with historical funding rate data points including timestamps and rates.

### getDeliveryPrices
Get historical delivery/settlement prices for futures and options.

**Parameters:**
- `indexName` (required): Index name (e.g., "btc_usd", "eth_usd")
- `offset` (optional): Offset for pagination
- `count` (optional): Number of results to return

**Example:**
```json
{
  "indexName": "btc_usd",
  "count": 10
}
```

**Output:** JSON object with historical delivery prices and dates.

### getBookSummaryByCurrency
Get a summary of all instruments for a currency, including best bid/ask, 24h volume, and more.

**Parameters:**
- `currency` (required): Currency symbol (e.g., "BTC", "ETH")
- `kind` (optional): Instrument kind filter ("future", "option", "spot")

**Example:**
```json
{
  "currency": "BTC",
  "kind": "future"
}
```

**Output:** JSON array with summary data for all matching instruments.

### getBookSummaryByInstrument
Get detailed book summary for a specific instrument including best bid/ask, volume, mark price, and more.

**Parameters:**
- `instrumentName` (required): The instrument name

**Example:**
```json
{
  "instrumentName": "BTC-PERPETUAL"
}
```

**Output:** JSON object with detailed summary for the instrument.

### getTradingviewChartData
Get TradingView-compatible OHLCV (candlestick) chart data.

**Parameters:**
- `instrumentName` (required): The instrument name
- `resolution` (required): Chart resolution - one of: 1, 3, 5, 10, 15, 30, 60, 120, 180, 360, 720, 1D
- `startTimestamp` (required): Start time in UNIX milliseconds
- `endTimestamp` (required): End time in UNIX milliseconds

**Example:**
```json
{
  "instrumentName": "BTC-PERPETUAL",
  "resolution": "60",
  "startTimestamp": 1704067200000,
  "endTimestamp": 1704153600000
}
```

**Output:** JSON object with OHLCV data arrays (open, high, low, close, volume, timestamps).

## Development

```bash
# Install dependencies
npm install

# Run stdio server (for Claude Desktop testing)
npm run stdio

# Run Workers dev server (for Cloudflare Workers testing)
npm run dev

# Deploy to Cloudflare Workers
npm run deploy
```

## API Reference

This server uses Deribit's public API v2. For detailed API documentation, visit:
https://docs.deribit.com/

## Architecture

- **Runtime**: Node.js 18+ (local), Cloudflare Workers (production)
- **Transport**:
  - stdio (local with any MCP client)
  - SSE (Server-Sent Events) for remote MCP via `mcp-remote` client
  - Uses Cloudflare Durable Objects with `McpAgent` class from `agents` package
- **API Protocol**: JSON-RPC 2.0 over HTTP (REST) and WebSocket to Deribit
- **Data Format**: JSON (most tools) and CSV (instruments, expirations, options chain)
- **Packages**:
  - `@modelcontextprotocol/sdk` - MCP protocol implementation
  - `agents` - Cloudflare's Agents SDK with McpAgent
  - `zod` - Schema validation

## License

MIT
