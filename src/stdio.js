#!/usr/bin/env node
/**
 * Local stdio server for testing with MCP clients
 * Run with: node src/stdio.js
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { DeribitClient } from './deribit.js';

// Global client instance
let client = null;

function getClient() {
  if (client === null) {
    client = new DeribitClient();
  }
  return client;
}

// Tool definitions
const TOOLS = [
  {
    name: 'get_ticker',
    description: 'Get current ticker information for a Deribit instrument. Returns prices, volume, bid/ask spreads, and other market data.',
    inputSchema: {
      type: 'object',
      properties: {
        instrument_name: {
          type: 'string',
          description: "The instrument name (e.g., 'BTC-PERPETUAL', 'ETH-25OCT24-3000-C')"
        }
      },
      required: ['instrument_name']
    }
  },
  {
    name: 'get_order_book',
    description: 'Get the current order book for a Deribit instrument. Shows bids and asks at different price levels.',
    inputSchema: {
      type: 'object',
      properties: {
        instrument_name: {
          type: 'string',
          description: "The instrument name (e.g., 'BTC-PERPETUAL')"
        },
        depth: {
          type: 'number',
          description: 'Order book depth (optional, varies by instrument type)'
        }
      },
      required: ['instrument_name']
    }
  },
  {
    name: 'get_instruments',
    description: 'Get a list of available trading instruments for a specific currency. Can filter by instrument kind (future, option, spot, etc.). Returns CSV format.',
    inputSchema: {
      type: 'object',
      properties: {
        currency: {
          type: 'string',
          description: "Currency symbol (e.g., 'BTC', 'ETH', 'USDC')"
        },
        kind: {
          type: 'string',
          enum: ['future', 'option', 'spot', 'future_combo', 'option_combo'],
          description: 'Instrument kind (optional)'
        },
        expired: {
          type: 'boolean',
          description: 'Include expired instruments (default: false)'
        }
      },
      required: ['currency']
    }
  },
  {
    name: 'get_last_trades',
    description: 'Get recent trade history for a Deribit instrument. Includes trade prices, sizes, and timestamps.',
    inputSchema: {
      type: 'object',
      properties: {
        instrument_name: {
          type: 'string',
          description: "The instrument name (e.g., 'BTC-PERPETUAL')"
        },
        count: {
          type: 'number',
          description: 'Number of trades to retrieve (default: 10, max: 1000)'
        },
        include_old: {
          type: 'boolean',
          description: 'Include old trades (default: false)'
        }
      },
      required: ['instrument_name']
    }
  },
  {
    name: 'get_currencies',
    description: 'Get a list of all available currencies on Deribit. Includes their properties and trading information.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'get_index_price',
    description: 'Get the current index price for a currency pair. The index price is calculated from multiple exchanges.',
    inputSchema: {
      type: 'object',
      properties: {
        index_name: {
          type: 'string',
          description: "Index name (e.g., 'btc_usd', 'eth_usd', 'sol_usd')"
        }
      },
      required: ['index_name']
    }
  },
  {
    name: 'get_expirations',
    description: 'Get available expiration dates for instruments. Much more efficient than calling getInstruments to find expirations. Returns CSV format.',
    inputSchema: {
      type: 'object',
      properties: {
        currency: {
          type: 'string',
          description: "Currency symbol: BTC, ETH, USDC, USDT, 'any' for all, or 'grouped' for all grouped by currency"
        },
        kind: {
          type: 'string',
          enum: ['future', 'option', 'any'],
          description: 'Instrument kind'
        },
        currency_pair: {
          type: 'string',
          description: "Optional currency pair filter (e.g., 'eth_usdc', 'btc_usd', 'sol_usdc')"
        }
      },
      required: ['currency', 'kind']
    }
  },
  {
    name: 'get_options_chain',
    description: 'Get complete options chain for a specific expiry with real-time greeks. Returns data in CSV format for easy table viewing. Uses WebSocket for efficient real-time data. Includes prices, volumes, open interest, delta, gamma, vega, theta, rho, and IV.',
    inputSchema: {
      type: 'object',
      properties: {
        currency: {
          type: 'string',
          description: "Settlement currency: 'BTC' for BTC-settled options (e.g., ETH-9OCT25-4000-C), 'USDC' for USDC-settled options (e.g., ETH_USDC-9OCT25-4000-C, SOL_USDC-...). Valid values: BTC, ETH, USDC, USDT, EURR"
        },
        expiry: {
          type: 'string',
          description: "Expiry date in format like '9OCT25', '27MAR25', or 'DDMMMYY'"
        },
        min_strike: {
          type: 'number',
          description: 'Optional minimum strike price to filter results'
        },
        max_strike: {
          type: 'number',
          description: 'Optional maximum strike price to filter results'
        }
      },
      required: ['currency', 'expiry']
    }
  }
];

// Tool handler
async function handleToolCall(name, args) {
  const client = getClient();

  console.error(`[DEBUG] Tool call: ${name} with args:`, JSON.stringify(args));

  try {
    switch (name) {
      case 'get_ticker':
        return JSON.stringify(await client.getTicker(args.instrument_name), null, 2);

      case 'get_order_book':
        return JSON.stringify(
          await client.getOrderBook(args.instrument_name, args.depth || null),
          null,
          2
        );

      case 'get_instruments':
        return await client.getInstruments(
          args.currency,
          args.kind || null,
          args.expired || false
        );

      case 'get_last_trades':
        return JSON.stringify(
          await client.getLastTradesByInstrument(
            args.instrument_name,
            args.count || null,
            args.include_old || false
          ),
          null,
          2
        );

      case 'get_currencies':
        return JSON.stringify(await client.getCurrencies(), null, 2);

      case 'get_index_price':
        return JSON.stringify(await client.getIndexPrice(args.index_name), null, 2);

      case 'get_expirations':
        return await client.getExpirations(
          args.currency,
          args.kind,
          args.currency_pair || null
        );

      case 'get_options_chain':
        return await client.getOptionsChain(
          args.currency,
          args.expiry,
          args.min_strike || null,
          args.max_strike || null
        );

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    console.error(`[ERROR] ${name} failed:`, error);
    return `Error: ${error.message}`;
  }
}

// Create MCP server
const server = new Server(
  {
    name: 'deribit-mcp',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register handlers
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => ({
  content: [
    {
      type: 'text',
      text: await handleToolCall(request.params.name, request.params.arguments || {}),
    },
  ],
}));

// Start stdio server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Deribit MCP stdio server running');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
