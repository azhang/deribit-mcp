/**
 * MCP server for Deribit public API - Cloudflare Workers implementation
 */

import { WorkerEntrypoint } from 'cloudflare:workers';
import { ProxyToSelf } from 'workers-mcp';
import { DeribitClient } from './deribit.js';

export default class DeribitMCP extends WorkerEntrypoint {
  #client = null;

  getClient() {
    if (this.#client === null) {
      this.#client = new DeribitClient();
    }
    return this.#client;
  }

  /**
   * Get current ticker information for a Deribit instrument.
   * Returns prices, volume, bid/ask spreads, and other market data.
   */
  async getTicker(instrumentName) {
    try {
      const result = await this.getClient().getTicker(instrumentName);
      return JSON.stringify(result, null, 2);
    } catch (error) {
      return `Error: ${error.message}`;
    }
  }

  /**
   * Get the current order book for a Deribit instrument.
   * Shows bids and asks at different price levels.
   */
  async getOrderBook(instrumentName, depth = null) {
    try {
      const result = await this.getClient().getOrderBook(instrumentName, depth);
      return JSON.stringify(result, null, 2);
    } catch (error) {
      return `Error: ${error.message}`;
    }
  }

  /**
   * Get a list of available trading instruments for a specific currency.
   * Can filter by instrument kind (future, option, spot, etc.). Returns CSV format.
   */
  async getInstruments(currency, kind = null, expired = false) {
    try {
      return await this.getClient().getInstruments(currency, kind, expired);
    } catch (error) {
      return `Error: ${error.message}`;
    }
  }

  /**
   * Get recent trade history for a Deribit instrument.
   * Includes trade prices, sizes, and timestamps.
   */
  async getLastTrades(instrumentName, count = null, includeOld = false) {
    try {
      const result = await this.getClient().getLastTradesByInstrument(
        instrumentName,
        count,
        includeOld
      );
      return JSON.stringify(result, null, 2);
    } catch (error) {
      return `Error: ${error.message}`;
    }
  }

  /**
   * Get a list of all available currencies on Deribit.
   * Includes their properties and trading information.
   */
  async getCurrencies() {
    try {
      const result = await this.getClient().getCurrencies();
      return JSON.stringify(result, null, 2);
    } catch (error) {
      return `Error: ${error.message}`;
    }
  }

  /**
   * Get the current index price for a currency pair.
   * The index price is calculated from multiple exchanges.
   */
  async getIndexPrice(indexName) {
    try {
      const result = await this.getClient().getIndexPrice(indexName);
      return JSON.stringify(result, null, 2);
    } catch (error) {
      return `Error: ${error.message}`;
    }
  }

  /**
   * Get available expiration dates for instruments.
   * Much more efficient than calling getInstruments to find expirations. Returns CSV format.
   */
  async getExpirations(currency, kind, currencyPair = null) {
    try {
      return await this.getClient().getExpirations(currency, kind, currencyPair);
    } catch (error) {
      return `Error: ${error.message}`;
    }
  }

  /**
   * Get complete options chain for a specific expiry with real-time greeks.
   * Returns data in CSV format for easy table viewing. Uses WebSocket for efficient real-time data.
   * Includes prices, volumes, open interest, delta, gamma, vega, theta, rho, and IV.
   */
  async getOptionsChain(currency, expiry, minStrike = null, maxStrike = null) {
    try {
      return await this.getClient().getOptionsChain(currency, expiry, minStrike, maxStrike);
    } catch (error) {
      return `Error: ${error.message}`;
    }
  }

  async fetch(request) {
    return new ProxyToSelf(this).fetch(request);
  }
}
