/**
 * Test TOON format encoding with sample Deribit-like data
 */
import { encode } from '@toon-format/toon';

// Sample ticker data (similar to what Deribit returns)
const tickerData = {
  timestamp: 1732377600000,
  stats: {
    volume_usd: 123456789.50,
    volume: 2500.75,
    price_change: 2.5,
    low: 95000.00,
    high: 98500.50
  },
  state: "open",
  settlement_price: 96875.25,
  open_interest: 150000.5,
  min_price: 95125.00,
  max_price: 98375.75,
  mark_price: 97250.50,
  last_price: 97125.00,
  instrument_name: "BTC-PERPETUAL",
  index_price: 97200.00,
  funding_8h: 0.0001,
  estimated_delivery_price: 97200.00,
  current_funding: 0.00005,
  best_bid_price: 97100.00,
  best_bid_amount: 50.5,
  best_ask_price: 97150.00,
  best_ask_amount: 75.25
};

// Sample order book data
const orderBookData = {
  timestamp: 1732377600000,
  instrument_name: "BTC-PERPETUAL",
  change_id: 123456789,
  bids: [
    [97100.00, 50.5],
    [97095.00, 100.25],
    [97090.00, 75.75]
  ],
  asks: [
    [97150.00, 75.25],
    [97155.00, 125.5],
    [97160.00, 200.0]
  ]
};

// Sample options chain-like data (array of instruments)
const instrumentsData = {
  instruments: [
    { id: 1, name: "BTC-25JAN25-100000-C", strike: 100000, type: "call", expiration: "2025-01-25" },
    { id: 2, name: "BTC-25JAN25-100000-P", strike: 100000, type: "put", expiration: "2025-01-25" },
    { id: 3, name: "BTC-25JAN25-95000-C", strike: 95000, type: "call", expiration: "2025-01-25" },
    { id: 4, name: "BTC-25JAN25-95000-P", strike: 95000, type: "put", expiration: "2025-01-25" }
  ]
};

console.log("=== TOON Format Examples ===\n");

console.log("1. Ticker Data (JSON):");
console.log(JSON.stringify(tickerData, null, 2));
console.log("\n1. Ticker Data (TOON):");
console.log(encode(tickerData));

console.log("\n\n2. Order Book Data (JSON):");
console.log(JSON.stringify(orderBookData, null, 2));
console.log("\n2. Order Book Data (TOON):");
console.log(encode(orderBookData));

console.log("\n\n3. Instruments Array Data (JSON):");
console.log(JSON.stringify(instrumentsData, null, 2));
console.log("\n3. Instruments Array Data (TOON):");
console.log(encode(instrumentsData));

console.log("\n\n=== Token Count Comparison ===");
// Rough estimate (actual tokenization varies by model)
const jsonTokens = {
  ticker: JSON.stringify(tickerData).length / 4,
  orderBook: JSON.stringify(orderBookData).length / 4,
  instruments: JSON.stringify(instrumentsData).length / 4
};

const toonTokens = {
  ticker: encode(tickerData).length / 4,
  orderBook: encode(orderBookData).length / 4,
  instruments: encode(instrumentsData).length / 4
};

console.log(`Ticker: JSON ~${Math.round(jsonTokens.ticker)} tokens, TOON ~${Math.round(toonTokens.ticker)} tokens (${Math.round((1 - toonTokens.ticker/jsonTokens.ticker) * 100)}% reduction)`);
console.log(`Order Book: JSON ~${Math.round(jsonTokens.orderBook)} tokens, TOON ~${Math.round(toonTokens.orderBook)} tokens (${Math.round((1 - toonTokens.orderBook/jsonTokens.orderBook) * 100)}% reduction)`);
console.log(`Instruments: JSON ~${Math.round(jsonTokens.instruments)} tokens, TOON ~${Math.round(toonTokens.instruments)} tokens (${Math.round((1 - toonTokens.instruments/jsonTokens.instruments) * 100)}% reduction)`);
