# Deribit MCP Server

An MCP (Model Context Protocol) server that provides access to Deribit's public API endpoints for cryptocurrency market data.

## Features

This MCP server exposes the following tools for accessing Deribit market data:

- **get_options_chain** - Get complete options chain with real-time greeks (WebSocket) ⚡
- **get_ticker** - Get current ticker information (prices, volume, bid/ask spreads)
- **get_order_book** - Retrieve order book with bids and asks
- **get_instruments** - List available trading instruments
- **get_last_trades** - Fetch recent trade history
- **get_currencies** - Get all available currencies
- **get_index_price** - Get current index price for a currency

### Architecture

This server uses a **hybrid HTTP + WebSocket approach**:
- **HTTP (REST)** for simple queries and instrument discovery
- **WebSocket** for real-time options data with greeks and live updates

## Installation

```bash
# Clone the repository
cd deribit-mcp

# Install with uv
uv sync
```

## Usage

### With Claude Desktop

Add this to your Claude Desktop configuration file:

**MacOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "deribit": {
      "command": "uv",
      "args": [
        "--directory",
        "/absolute/path/to/deribit-mcp",
        "run",
        "deribit-mcp"
      ]
    }
  }
}
```

Replace `/absolute/path/to/deribit-mcp` with the actual path to this project.

### With MCP Inspector

For testing and debugging:

```bash
npx @modelcontextprotocol/inspector uv --directory /path/to/deribit-mcp run deribit-mcp
```

## Available Tools

### get_options_chain ⚡

Get complete options chain for a specific expiry with real-time greeks, prices, volumes, and open interest. Returns data in CSV format for easy table viewing.

**Uses WebSocket for efficient real-time data.**

**Parameters:**
- `currency` (required): **Settlement currency** for the options. Valid values: BTC, ETH, USDC, USDT, EURR
  - Use `"USDC"` for USDC-settled options (ETH_USDC, SOL_USDC, AVAX_USDC, etc.)
  - Use `"BTC"` for BTC-settled options (ETH, SOL, etc.)
  - Use `"ETH"` for ETH-settled options
- `expiry` (required): Expiry date in format "9OCT25", "27MAR25", or "DDMMMYY"
- `min_strike` (optional): Minimum strike price filter
- `max_strike` (optional): Maximum strike price filter

**Examples:**

For USDC-settled ETH options (ETH_USDC):
```json
{
  "currency": "USDC",
  "expiry": "9OCT25",
  "min_strike": 4000,
  "max_strike": 5000
}
```

For BTC-settled ETH options (ETH):
```json
{
  "currency": "BTC",
  "expiry": "27MAR25"
}
```

**Output Format (CSV):**
```csv
# Currency: USDC
# Expiry: 9OCT25
# Timestamp: 1759922575385
# Underlying: 4494.76
# Index: 4495.25
strike,type,instrument_name,mark_price,bid_price,ask_price,bid_amount,ask_amount,last_price,volume_24h,open_interest,delta,gamma,vega,theta,rho,mark_iv,bid_iv,ask_iv
4000,call,ETH_USDC-9OCT25-4000-C,495.42,494.0,497.0,75.0,50.0,495.0,23.4,102.5,0.9901,0.0001,0.02,-0.85,0.012,45.2,44.8,46.1
4000,put,ETH_USDC-9OCT25-4000-P,0.18,0.1,0.3,100.0,80.0,0.2,10.5,45.0,-0.0099,0.0001,0.02,-0.05,-0.001,45.2,44.5,46.5
...
```

**How it works:**
1. Fetches all option instruments via HTTP `get_instruments`
2. Filters by expiry date
3. Subscribes to all instruments via WebSocket
4. Waits for initial ticker snapshots with greeks
5. Returns formatted CSV table

### get_ticker
Get real-time ticker information for any Deribit instrument.

**Parameters:**
- `instrument_name` (required): Instrument name (e.g., "BTC-PERPETUAL", "ETH-25OCT24-3000-C")

**Example:**
```json
{
  "instrument_name": "BTC-PERPETUAL"
}
```

### get_order_book
Retrieve the current order book showing bids and asks.

**Parameters:**
- `instrument_name` (required): Instrument name
- `depth` (optional): Order book depth

**Example:**
```json
{
  "instrument_name": "BTC-PERPETUAL",
  "depth": 5
}
```

### get_instruments
List all available trading instruments for a currency.

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

### get_last_trades
Get recent trade history for an instrument.

**Parameters:**
- `instrument_name` (required): Instrument name
- `count` (optional): Number of trades (default: 10, max: 1000)
- `include_old` (optional): Include old trades (default: false)

**Example:**
```json
{
  "instrument_name": "ETH-PERPETUAL",
  "count": 50
}
```

### get_currencies
Get all available currencies with their properties.

**Parameters:** None

### get_index_price
Get the current index price calculated from multiple exchanges.

**Parameters:**
- `index_name` (required): Index name (e.g., "btc_usd", "eth_usd", "sol_usd")

**Example:**
```json
{
  "index_name": "btc_usd"
}
```

## API Reference

This server uses Deribit's public API v2. For detailed API documentation, visit:
https://docs.deribit.com/

## Development

```bash
# Install dependencies
uv sync

# Run the server
uv run deribit-mcp

# Run tests (if added)
uv run pytest
```

## License

MIT
