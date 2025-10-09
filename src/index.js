/**
 * MCP server for Deribit public API - Cloudflare Workers implementation
 * Uses the modern McpAgent pattern with Durable Objects
 */

import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DeribitClient } from './deribit.js';

/**
 * Deribit MCP Agent
 * Provides tools for accessing Deribit's public API endpoints
 */
export class DeribitMCP extends McpAgent {
  server = new McpServer({
    name: "Deribit Market Data",
    version: "0.2.0",
  });

  #client = null;

  getClient() {
    if (this.#client === null) {
      this.#client = new DeribitClient();
    }
    return this.#client;
  }

  async init() {
    // Get current ticker information for a Deribit instrument
    this.server.tool(
      "get_ticker",
      {
        instrument_name: z.string().describe("The instrument name (e.g., 'BTC-PERPETUAL', 'ETH-29MAR24-3000-C')"),
      },
      async ({ instrument_name }) => {
        try {
          const result = await this.getClient().getTicker(instrument_name);
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
          };
        }
      }
    );

    // Get the current order book for a Deribit instrument
    this.server.tool(
      "get_order_book",
      {
        instrument_name: z.string().describe("The instrument name"),
        depth: z.number().optional().describe("Order book depth (optional)"),
      },
      async ({ instrument_name, depth }) => {
        try {
          const result = await this.getClient().getOrderBook(instrument_name, depth || null);
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
          };
        }
      }
    );

    // Get a list of available trading instruments for a specific currency
    this.server.tool(
      "get_instruments",
      {
        currency: z.string().describe("Currency symbol (e.g., 'BTC', 'ETH')"),
        kind: z.string().optional().describe("Instrument kind: 'future', 'option', 'spot', etc. (optional)"),
        expired: z.boolean().optional().describe("Include expired instruments (default: false)"),
      },
      async ({ currency, kind, expired }) => {
        try {
          const result = await this.getClient().getInstruments(
            currency,
            kind || null,
            expired || false
          );
          return {
            content: [{ type: "text", text: result }],
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
          };
        }
      }
    );

    // Get recent trade history for a Deribit instrument
    this.server.tool(
      "get_last_trades",
      {
        instrument_name: z.string().describe("The instrument name"),
        count: z.number().optional().describe("Number of trades to retrieve (optional)"),
        include_old: z.boolean().optional().describe("Include old trades (default: false)"),
      },
      async ({ instrument_name, count, include_old }) => {
        try {
          const result = await this.getClient().getLastTradesByInstrument(
            instrument_name,
            count || null,
            include_old || false
          );
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
          };
        }
      }
    );

    // Get a list of all available currencies on Deribit
    this.server.tool(
      "get_currencies",
      {},
      async () => {
        try {
          const result = await this.getClient().getCurrencies();
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
          };
        }
      }
    );

    // Get the current index price for a currency pair
    this.server.tool(
      "get_index_price",
      {
        index_name: z.string().describe("Index name (e.g., 'btc_usd', 'eth_usd')"),
      },
      async ({ index_name }) => {
        try {
          const result = await this.getClient().getIndexPrice(index_name);
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
          };
        }
      }
    );

    // Get available expiration dates for instruments
    this.server.tool(
      "get_expirations",
      {
        currency: z.string().describe("Currency symbol (e.g., 'BTC', 'ETH')"),
        kind: z.string().describe("Instrument kind (e.g., 'future', 'option')"),
        currency_pair: z.string().optional().describe("Currency pair filter (optional)"),
      },
      async ({ currency, kind, currency_pair }) => {
        try {
          const result = await this.getClient().getExpirations(
            currency,
            kind,
            currency_pair || null
          );
          return {
            content: [{ type: "text", text: result }],
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
          };
        }
      }
    );

    // Get complete options chain for a specific expiry with real-time greeks
    this.server.tool(
      "get_options_chain",
      {
        currency: z.string().describe("Currency symbol (e.g., 'BTC', 'ETH')"),
        expiry: z.string().describe("Expiry date in format like '9OCT25' or '29MAR24'"),
        min_strike: z.number().optional().describe("Minimum strike price filter (optional)"),
        max_strike: z.number().optional().describe("Maximum strike price filter (optional)"),
      },
      async ({ currency, expiry, min_strike, max_strike }) => {
        try {
          const result = await this.getClient().getOptionsChain(
            currency,
            expiry,
            min_strike || null,
            max_strike || null
          );
          return {
            content: [{ type: "text", text: result }],
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
          };
        }
      }
    );
  }
}

// Worker fetch handler
export default {
  fetch(request, env, ctx) {
    const url = new URL(request.url);

    // SSE endpoint for MCP protocol
    if (url.pathname === "/sse" || url.pathname === "/sse/message") {
      return DeribitMCP.serveSSE("/sse").fetch(request, env, ctx);
    }

    // HTTP endpoint for MCP protocol
    if (url.pathname === "/mcp") {
      return DeribitMCP.serve("/mcp").fetch(request, env, ctx);
    }

    return new Response("Deribit MCP Server - use /sse or /mcp endpoints", {
      status: 404,
      headers: { "Content-Type": "text/plain" }
    });
  },
};
