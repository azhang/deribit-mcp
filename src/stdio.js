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
    name: 'getTicker',
    description: 'Get current ticker information for a Deribit instrument. Returns prices, volume, bid/ask spreads, and other market data.',
    inputSchema: {
      type: 'object',
      properties: {
        instrumentName: {
          type: 'string',
          description: "The instrument name (e.g., 'BTC-PERPETUAL', 'ETH-25OCT24-3000-C')"
        }
      },
      required: ['instrumentName']
    }
  },
  {
    name: 'getOrderBook',
    description: 'Get the current order book for a Deribit instrument. Shows bids and asks at different price levels.',
    inputSchema: {
      type: 'object',
      properties: {
        instrumentName: {
          type: 'string',
          description: "The instrument name (e.g., 'BTC-PERPETUAL')"
        },
        depth: {
          type: 'number',
          description: 'Order book depth (optional, varies by instrument type)'
        }
      },
      required: ['instrumentName']
    }
  },
  {
    name: 'getInstruments',
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
    name: 'getLastTrades',
    description: 'Get recent trade history for a Deribit instrument. Includes trade prices, sizes, and timestamps.',
    inputSchema: {
      type: 'object',
      properties: {
        instrumentName: {
          type: 'string',
          description: "The instrument name (e.g., 'BTC-PERPETUAL')"
        },
        count: {
          type: 'number',
          description: 'Number of trades to retrieve (default: 10, max: 1000)'
        },
        includeOld: {
          type: 'boolean',
          description: 'Include old trades (default: false)'
        }
      },
      required: ['instrumentName']
    }
  },
  {
    name: 'getCurrencies',
    description: 'Get a list of all available currencies on Deribit. Includes their properties and trading information.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'getIndexPrice',
    description: 'Get the current index price for a currency pair. The index price is calculated from multiple exchanges.',
    inputSchema: {
      type: 'object',
      properties: {
        indexName: {
          type: 'string',
          description: "Index name (e.g., 'btc_usd', 'eth_usd', 'sol_usd')"
        }
      },
      required: ['indexName']
    }
  },
  {
    name: 'getExpirations',
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
        currencyPair: {
          type: 'string',
          description: "Optional currency pair filter (e.g., 'eth_usdc', 'btc_usd', 'sol_usdc')"
        }
      },
      required: ['currency', 'kind']
    }
  },
  {
    name: 'getOptionsChain',
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
        minStrike: {
          type: 'number',
          description: 'Optional minimum strike price to filter results'
        },
        maxStrike: {
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

  try {
    switch (name) {
      case 'getTicker':
        return JSON.stringify(await client.getTicker(args.instrumentName), null, 2);

      case 'getOrderBook':
        return JSON.stringify(
          await client.getOrderBook(args.instrumentName, args.depth || null),
          null,
          2
        );

      case 'getInstruments':
        return await client.getInstruments(
          args.currency,
          args.kind || null,
          args.expired || false
        );

      case 'getLastTrades':
        return JSON.stringify(
          await client.getLastTradesByInstrument(
            args.instrumentName,
            args.count || null,
            args.includeOld || false
          ),
          null,
          2
        );

      case 'getCurrencies':
        return JSON.stringify(await client.getCurrencies(), null, 2);

      case 'getIndexPrice':
        return JSON.stringify(await client.getIndexPrice(args.indexName), null, 2);

      case 'getExpirations':
        return await client.getExpirations(
          args.currency,
          args.kind,
          args.currencyPair || null
        );

      case 'getOptionsChain':
        return await client.getOptionsChain(
          args.currency,
          args.expiry,
          args.minStrike || null,
          args.maxStrike || null
        );

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
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
