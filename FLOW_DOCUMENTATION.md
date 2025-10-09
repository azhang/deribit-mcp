# Deribit Options Chain Fetching Flow

This document describes the architecture and data flow for efficiently fetching options chain data from Deribit. This pattern can be reused for other projects that need to fetch real-time options data.

## Overview

The implementation uses a **hybrid HTTP + WebSocket approach** to efficiently fetch complete options chains with real-time data including greeks (delta, gamma, vega, theta, rho).

## Why Hybrid Approach?

### HTTP (REST) for:
- **Discovery**: Getting list of available instruments
- **Simple queries**: One-off data requests
- **Metadata**: Currencies, index prices, etc.

### WebSocket for:
- **Real-time data**: Live ticker updates with greeks
- **Efficiency**: Single connection for multiple instruments
- **Lower latency**: Sub-second updates
- **Bulk data**: Subscribe to 50+ instruments in one call

## Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    Options Chain Request                     │
│              (currency: USDC, expiry: 9OCT25)                │
│                                                              │
│  Note: currency is the SETTLEMENT currency                   │
│  - USDC for ETH_USDC, SOL_USDC, etc.                        │
│  - BTC for BTC-settled options                               │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 1: HTTP - Get Instruments List                        │
│  GET /public/get_instruments?currency=USDC&kind=option      │
│                                                              │
│  Returns: All USDC-settled option instruments               │
│  Example: [                                                  │
│    {instrument_name: "ETH_USDC-9OCT25-4000-C", ...},       │
│    {instrument_name: "ETH_USDC-9OCT25-4000-P", ...},       │
│    {instrument_name: "SOL_USDC-9OCT25-100-C", ...},        │
│    ...                                                       │
│  ]                                                           │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 2: Filter by Expiry                                   │
│  Parse instrument names using regex pattern:                │
│  CURRENCY-EXPIRY-STRIKE-TYPE                                │
│                                                              │
│  Filter for expiry = "9OCT25"                               │
│  Result: [                                                   │
│    "ETH_USDC-9OCT25-4000-C",                                │
│    "ETH_USDC-9OCT25-4000-P",                                │
│    "ETH_USDC-9OCT25-4100-C",                                │
│    ...                                                       │
│  ]                                                           │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 3: WebSocket - Connect & Handshake                    │
│  wss://www.deribit.com/ws/api/v2                            │
│                                                              │
│  Send:                                                       │
│  1. public/set_heartbeat (interval: 10s)                    │
│  2. public/hello (client info)                              │
│                                                              │
│  Purpose: Keep connection alive & announce client           │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 4: WebSocket - Subscribe to Tickers                   │
│  Send: public/subscribe                                      │
│  {                                                           │
│    "channels": [                                             │
│      "incremental_ticker.ETH_USDC-9OCT25-4000-C",          │
│      "incremental_ticker.ETH_USDC-9OCT25-4000-P",          │
│      ...                                                     │
│    ]                                                         │
│  }                                                           │
│                                                              │
│  Can subscribe to 50+ instruments in single call            │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 5: WebSocket - Receive Snapshot Data                  │
│  Receive: subscription notifications                         │
│  {                                                           │
│    "method": "subscription",                                 │
│    "params": {                                               │
│      "channel": "incremental_ticker.ETH_USDC-9OCT25-4000-C",│
│      "data": {                                               │
│        "type": "snapshot",     // First message             │
│        "timestamp": 1759922575385,                          │
│        "mark_price": 495.42,                                │
│        "best_bid_price": 494.0,                             │
│        "best_ask_price": 497.0,                             │
│        "underlying_price": 4494.76,                         │
│        "index_price": 4495.25,                              │
│        "greeks": {                                           │
│          "delta": 0.9901,                                    │
│          "gamma": 0.0001,                                    │
│          "vega": 0.02,                                       │
│          "theta": -0.85,                                     │
│          "rho": 0.012                                        │
│        },                                                    │
│        "open_interest": 102.5,                              │
│        "stats": {"volume": 23.4, ...},                      │
│        ...                                                   │
│      }                                                       │
│    }                                                         │
│  }                                                           │
│                                                              │
│  Wait for all snapshots (timeout: 10s)                      │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 6: Build CSV Table                                    │
│  Group data by strike price                                 │
│  Format as CSV with:                                         │
│  - Header comments (metadata)                                │
│  - Column headers                                            │
│  - One row per option (calls and puts)                      │
│                                                              │
│  Result:                                                     │
│  # Currency: USDC                                            │
│  # Expiry: 9OCT25                                            │
│  # Underlying: 4494.76                                       │
│  strike,type,mark_price,delta,gamma,vega,...                │
│  4000,call,495.42,0.9901,0.0001,0.02,...                   │
│  4000,put,0.18,-0.0099,0.0001,0.02,...                     │
└─────────────────────────────────────────────────────────────┘
```

## Important: Currency Parameter

The `currency` parameter in the API refers to the **settlement currency**, not the underlying asset:

- **USDC**: Returns USDC-settled options (ETH_USDC, SOL_USDC, AVAX_USDC, etc.)
- **BTC**: Returns BTC-settled options (ETH, SOL, etc. - settled in BTC)
- **ETH**: Returns ETH-settled options

Example:
- To get `ETH_USDC-9OCT25-4000-C` options, use `currency=USDC`
- To get `ETH-27MAR25-4000-C` options (BTC-settled), use `currency=BTC`

## Key Implementation Details

### 1. Instrument Name Parsing

```javascript
// Pattern: CURRENCY-EXPIRY-STRIKE-TYPE
// Examples:
//   BTC-27MAR25-50000-C (BTC-settled BTC option)
//   ETH_USDC-9OCT25-4000-P (USDC-settled ETH option)
//   SOL_USDC-15DEC25-100-C (USDC-settled SOL option)

const pattern = /^([A-Z_]+)-(\d{1,2}[A-Z]{3}\d{2})-(\d+(?:\.\d+)?)-([CP])$/;
```

### 2. WebSocket Message Correlation

Each JSON-RPC call has a unique ID for response matching:

```javascript
{
    "jsonrpc": "2.0",
    "id": 42,              // Request ID
    "method": "public/subscribe",
    "params": {...}
}

// Response will have same ID
{
    "jsonrpc": "2.0",
    "id": 42,              // Matches request
    "result": [...]
}
```

### 3. Subscription vs RPC Messages

Two types of messages on WebSocket:

**RPC Response** (has "id"):
```json
{"jsonrpc": "2.0", "id": 5, "result": [...]}
```

**Subscription Notification** (has "method"):
```json
{
    "jsonrpc": "2.0",
    "method": "subscription",
    "params": {
        "channel": "incremental_ticker.ETH-PERPETUAL",
        "data": {...}
    }
}
```

### 4. Snapshot vs Change Messages

First message is full snapshot:
```json
{
    "data": {
        "type": "snapshot",  // Full data
        "mark_price": 495.42,
        "delta": 0.99,
        ...
    }
}
```

Subsequent messages are incremental:
```json
{
    "data": {
        "type": "change",    // Only changed fields
        "mark_price": 495.50,  // Updated price
        // Other unchanged fields omitted
    }
}
```

### 5. CSV Format for Options

CSV is ideal for options chain because:
- Natural tabular structure
- Easy to parse and display
- Compact for large chains (50+ strikes)
- Header comments provide metadata

```csv
# Metadata as comments
# Currency: ETH_USDC
# Underlying: 4494.76

# CSV headers
strike,type,instrument_name,mark_price,bid_price,ask_price,...

# Data rows (one per option)
4000,call,ETH_USDC-9OCT25-4000-C,495.42,494.0,497.0,...
4000,put,ETH_USDC-9OCT25-4000-P,0.18,0.1,0.3,...
```

## Reusability

This pattern can be adapted for other exchanges or projects by:

1. **Modifying the HTTP discovery step** - Adapt to your exchange's instrument list endpoint
2. **Adjusting the parsing logic** - Change instrument name parsing to match format
3. **Updating WebSocket channels** - Use your exchange's subscription channel format
4. **Customizing output format** - Keep CSV or switch to JSON/DataFrame

## Performance Characteristics

- **Connection time**: ~500ms for WebSocket handshake
- **Subscription**: Can subscribe to 100+ instruments in one call
- **Data arrival**: All snapshots typically arrive within 1-2 seconds
- **Update frequency**: Up to 1 update per second per instrument
- **Bandwidth**: Efficient - only changed fields sent after initial snapshot

## Error Handling

Key error scenarios:

1. **Missing instruments**: Return empty result with message
2. **Snapshot timeout**: Timeout after 10s if data doesn't arrive
3. **Connection loss**: Reconnect and resubscribe automatically
4. **Invalid expiry format**: Parse error with helpful message

## Code Structure

```
src/
├── ws-client.js       # WebSocket connection & message routing
│   ├── connect()      # Establish connection & handshake
│   ├── subscribeTickers()    # Subscribe to instruments
│   └── waitForSnapshots()   # Wait for data
│
├── options.js         # Parsing & CSV building
│   ├── parseInstrumentName()      # Extract strike/expiry
│   ├── filterInstrumentsByExpiry()  # Filter instruments
│   └── buildOptionsChainCSV()    # Format as CSV
│
├── deribit.js         # Main client (orchestration)
│   └── getOptionsChain()  # Combines HTTP + WS
│
├── index.js           # Cloudflare Workers entry point
└── stdio.js           # stdio server for local testing
```

## Example Usage

```javascript
import { DeribitClient } from './deribit.js';

async function main() {
    const client = new DeribitClient();

    // Get options chain as CSV
    const csv = await client.getOptionsChain(
        "USDC",      // Settlement currency
        "31OCT25",   // Expiry
        4000,        // Min strike
        5000         // Max strike
    );

    console.log(csv);
    // # Currency: USDC
    // # Expiry: 31OCT25
    // strike,type,mark_price,delta,gamma,...
    // 4000,call,495.42,0.99,0.0001,...
    // ...

    await client.close();
}
```

## References

- **Deribit API Docs**: https://docs.deribit.com/
- **WebSocket Endpoint**: `wss://www.deribit.com/ws/api/v2`
- **Test Endpoint**: `wss://test.deribit.com/ws/api/v2`
- **WEBSOCKET_FLOW.json**: Real captured WebSocket message sequence
