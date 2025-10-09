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
    version: "0.4.0",
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

    // Get ticker information for multiple instruments using a single WebSocket connection
    this.server.tool(
      "get_tickers",
      {
        instrument_names: z.array(z.string()).describe("Array of instrument names (e.g., ['BTC-PERPETUAL', 'ETH-PERPETUAL'])"),
      },
      async ({ instrument_names }) => {
        try {
          const result = await this.getClient().getTickers(instrument_names);
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

    // Get index prices for multiple indices
    this.server.tool(
      "get_index_prices",
      {
        index_names: z.array(z.string()).describe("Array of index names (e.g., ['btc_usd', 'eth_usd'])"),
      },
      async ({ index_names }) => {
        try {
          const result = await this.getClient().getIndexPrices(index_names);
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

    // Get order books for multiple instruments
    this.server.tool(
      "get_order_books",
      {
        instrument_names: z.array(z.string()).describe("Array of instrument names"),
        depth: z.number().optional().describe("Order book depth (optional)"),
      },
      async ({ instrument_names, depth }) => {
        try {
          const result = await this.getClient().getOrderBooks(instrument_names, depth || null);
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

    // Get options chains for multiple expiries using a single WebSocket connection
    this.server.tool(
      "get_options_chains",
      {
        currency: z.string().describe("Currency symbol (e.g., 'BTC', 'ETH')"),
        expiries: z.array(z.string()).describe("Array of expiry dates in format like '9OCT25' or '29MAR24'"),
        min_strike: z.number().optional().describe("Minimum strike price filter (optional)"),
        max_strike: z.number().optional().describe("Maximum strike price filter (optional)"),
      },
      async ({ currency, expiries, min_strike, max_strike }) => {
        try {
          const result = await this.getClient().getOptionsChains(
            currency,
            expiries,
            min_strike || null,
            max_strike || null
          );
          // Format result with clear separators between expiries
          let output = '';
          for (const [expiry, csv] of Object.entries(result)) {
            output += `\n=== ${expiry} ===\n${csv}\n`;
          }
          return {
            content: [{ type: "text", text: output }],
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
          };
        }
      }
    );

    // Get volatility index (DVOL) data
    this.server.tool(
      "get_volatility_index_data",
      {
        currency: z.string().describe("Currency symbol (e.g., 'BTC', 'ETH')"),
      },
      async ({ currency }) => {
        try {
          const result = await this.getClient().getVolatilityIndexData(currency);
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

    // Get historical volatility
    this.server.tool(
      "get_historical_volatility",
      {
        currency: z.string().describe("Currency symbol (e.g., 'BTC', 'ETH')"),
      },
      async ({ currency }) => {
        try {
          const result = await this.getClient().getHistoricalVolatility(currency);
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

    // Get combo instruments
    this.server.tool(
      "get_combos",
      {
        currency: z.string().describe("Currency symbol (e.g., 'BTC', 'ETH')"),
      },
      async ({ currency }) => {
        try {
          const result = await this.getClient().getCombos(currency);
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

    // Get funding rate for perpetual contracts
    this.server.tool(
      "get_funding_rate",
      {
        instrument_name: z.string().describe("The instrument name (e.g., 'BTC-PERPETUAL')"),
      },
      async ({ instrument_name }) => {
        try {
          const result = await this.getClient().getFundingRate(instrument_name);
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

    // Get historical funding rate data
    this.server.tool(
      "get_funding_rate_history",
      {
        instrument_name: z.string().describe("The instrument name (e.g., 'BTC-PERPETUAL')"),
        start_timestamp: z.number().optional().describe("Start time (UNIX timestamp in milliseconds)"),
        end_timestamp: z.number().optional().describe("End time (UNIX timestamp in milliseconds)"),
      },
      async ({ instrument_name, start_timestamp, end_timestamp }) => {
        try {
          const result = await this.getClient().getFundingRateHistory(
            instrument_name,
            start_timestamp || null,
            end_timestamp || null
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

    // Get historical delivery prices
    this.server.tool(
      "get_delivery_prices",
      {
        index_name: z.string().describe("Index name (e.g., 'btc_usd', 'eth_usd')"),
        offset: z.number().optional().describe("Offset for pagination (optional)"),
        count: z.number().optional().describe("Number of results to return (optional)"),
      },
      async ({ index_name, offset, count }) => {
        try {
          const result = await this.getClient().getDeliveryPrices(
            index_name,
            offset || null,
            count || null
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

    // Get book summary for all instruments of a currency
    this.server.tool(
      "get_book_summary_by_currency",
      {
        currency: z.string().describe("Currency symbol (e.g., 'BTC', 'ETH')"),
        kind: z.string().optional().describe("Instrument kind: 'future', 'option', 'spot', etc. (optional)"),
      },
      async ({ currency, kind }) => {
        try {
          const result = await this.getClient().getBookSummaryByCurrency(
            currency,
            kind || null
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

    // Get book summary for a specific instrument
    this.server.tool(
      "get_book_summary_by_instrument",
      {
        instrument_name: z.string().describe("The instrument name"),
      },
      async ({ instrument_name }) => {
        try {
          const result = await this.getClient().getBookSummaryByInstrument(instrument_name);
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

    // Get TradingView chart data (OHLCV)
    this.server.tool(
      "get_tradingview_chart_data",
      {
        instrument_name: z.string().describe("The instrument name"),
        resolution: z.string().describe("Chart resolution (1, 3, 5, 10, 15, 30, 60, 120, 180, 360, 720, 1D)"),
        start_timestamp: z.number().describe("Start time (UNIX timestamp in milliseconds)"),
        end_timestamp: z.number().describe("End time (UNIX timestamp in milliseconds)"),
      },
      async ({ instrument_name, resolution, start_timestamp, end_timestamp }) => {
        try {
          const result = await this.getClient().getTradingviewChartData(
            instrument_name,
            resolution,
            start_timestamp,
            end_timestamp
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
