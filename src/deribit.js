/**
 * Deribit API client for public endpoints.
 *
 * Supports both HTTP and WebSocket protocols:
 * - HTTP for simple request/response queries
 * - WebSocket for real-time subscriptions and options chain data
 */

import { WebSocketClient } from './ws-client.js';
import { filterInstrumentsByExpiry, buildOptionsChainCSV } from './options.js';

export class DeribitClient {
  constructor(baseUrl = 'https://www.deribit.com/api/v2') {
    this.baseUrl = baseUrl;
    this.wsClient = null;
  }

  /**
   * Close both HTTP and WebSocket clients.
   */
  async close() {
    if (this.wsClient) {
      await this.wsClient.close();
    }
  }

  /**
   * Make a call to the Deribit REST API.
   *
   * @param {string} method - The API method to call (e.g., "ticker")
   * @param {Object} params - Optional parameters for the method
   * @returns {Promise<any>} The result from the API response
   * @throws {Error} If the API returns an error
   */
  async _call(method, params = {}) {
    const url = new URL(`${this.baseUrl}/public/${method}`);

    // Add query parameters
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, value);
      }
    }

    // Retry logic for network issues
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch(url.toString(), {
          headers: {
            'User-Agent': 'deribit-mcp/0.1.0'
          }
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        if (data.error) {
          const error = data.error;
          throw new Error(`API Error ${error.code}: ${error.message}`);
        }

        return data.result;
      } catch (error) {
        console.error(`[Attempt ${attempt}/3] Fetch failed:`, error.message);
        lastError = error;

        // Only retry on network errors, not API errors
        if (error.message.includes('API Error') || attempt === 3) {
          throw error;
        }

        // Wait before retrying (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, 500 * attempt));
      }
    }

    throw lastError;
  }

  /**
   * Get ticker information for an instrument.
   *
   * @param {string} instrumentName - The instrument name (e.g., "BTC-PERPETUAL")
   * @returns {Promise<Object>} Ticker data including prices, volume, and other market info
   */
  async getTicker(instrumentName) {
    return await this._call('ticker', { instrument_name: instrumentName });
  }

  /**
   * Get the order book for an instrument.
   *
   * @param {string} instrumentName - The instrument name (e.g., "BTC-PERPETUAL")
   * @param {number} [depth] - Optional order book depth
   * @returns {Promise<Object>} Order book data with bids and asks
   */
  async getOrderBook(instrumentName, depth = null) {
    const params = { instrument_name: instrumentName };
    if (depth !== null) {
      params.depth = depth;
    }
    return await this._call('get_order_book', params);
  }

  /**
   * Internal method to get raw instruments list.
   *
   * @param {string} currency - Currency symbol (e.g., "BTC", "ETH")
   * @param {string} [kind] - Optional instrument kind
   * @param {boolean} [expired=false] - Whether to include expired instruments
   * @returns {Promise<Array>} List of instrument data
   */
  async _getInstrumentsRaw(currency, kind = null, expired = false) {
    const params = { currency, expired };
    if (kind !== null) {
      params.kind = kind;
    }
    return await this._call('get_instruments', params);
  }

  /**
   * Get available instruments for a currency.
   *
   * @param {string} currency - Currency symbol (e.g., "BTC", "ETH")
   * @param {string} [kind] - Optional instrument kind
   * @param {boolean} [expired=false] - Whether to include expired instruments
   * @returns {Promise<string>} CSV string with essential instrument fields
   */
  async getInstruments(currency, kind = null, expired = false) {
    const instruments = await this._getInstrumentsRaw(currency, kind, expired);

    if (!instruments || instruments.length === 0) {
      return 'instrument_name\n';
    }

    let header, rows;

    // For options, include option-specific fields
    if (kind === 'option') {
      header = 'instrument_name,kind,strike,option_type,expiration_timestamp,is_active,settlement_currency';
      rows = [header];
      for (const inst of instruments) {
        rows.push(
          `${inst.instrument_name},${inst.kind},${inst.strike || ''},${inst.option_type || ''},` +
          `${inst.expiration_timestamp},${inst.is_active},${inst.settlement_currency}`
        );
      }
    } else {
      // For futures/spots, simpler format
      header = 'instrument_name,kind,expiration_timestamp,is_active,settlement_currency';
      rows = [header];
      for (const inst of instruments) {
        rows.push(
          `${inst.instrument_name},${inst.kind},${inst.expiration_timestamp || ''},` +
          `${inst.is_active},${inst.settlement_currency}`
        );
      }
    }

    return rows.join('\n');
  }

  /**
   * Get recent trades for an instrument.
   *
   * @param {string} instrumentName - The instrument name
   * @param {number} [count] - Number of trades to retrieve
   * @param {boolean} [includeOld=false] - Whether to include old trades
   * @returns {Promise<Object>} Trade data
   */
  async getLastTradesByInstrument(instrumentName, count = null, includeOld = false) {
    const params = { instrument_name: instrumentName, include_old: includeOld };
    if (count !== null) {
      params.count = count;
    }
    return await this._call('get_last_trades_by_instrument', params);
  }

  /**
   * Get all available currencies.
   *
   * @returns {Promise<Array>} List of currency data
   */
  async getCurrencies() {
    return await this._call('get_currencies');
  }

  /**
   * Get the current index price.
   *
   * @param {string} indexName - Index name (e.g., "btc_usd")
   * @returns {Promise<Object>} Index price data
   */
  async getIndexPrice(indexName) {
    return await this._call('get_index_price', { index_name: indexName });
  }

  /**
   * Get available expiration dates for instruments.
   *
   * @param {string} currency - Currency symbol
   * @param {string} kind - Instrument kind
   * @param {string} [currencyPair] - Optional currency pair filter
   * @returns {Promise<string>} CSV string with expirations
   */
  async getExpirations(currency, kind, currencyPair = null) {
    const params = { currency, kind };
    if (currencyPair !== null) {
      params.currency_pair = currencyPair;
    }

    const result = await this._call('get_expirations', params);

    const rows = ['currency,kind,expiration'];

    if (!result) {
      return rows.join('\n');
    }

    // Check if first value is a dict (grouped format) or list (any format)
    const firstValue = Object.values(result)[0];

    if (typeof firstValue === 'object' && !Array.isArray(firstValue)) {
      // Grouped format: {currency: {kind: [expirations]}}
      for (const [curr, kinds] of Object.entries(result)) {
        for (const [k, expirations] of Object.entries(kinds)) {
          for (const expiry of expirations) {
            rows.push(`${curr},${k},${expiry}`);
          }
        }
      }
    } else {
      // "any" format: {kind: [expirations]}
      for (const [k, expirations] of Object.entries(result)) {
        for (const expiry of expirations) {
          rows.push(`any,${k},${expiry}`);
        }
      }
    }

    return rows.join('\n');
  }

  /**
   * Get complete options chain data for a specific expiry.
   *
   * @param {string} currency - Currency symbol
   * @param {string} expiry - Expiry date in format "9OCT25"
   * @param {number} [minStrike] - Optional minimum strike filter
   * @param {number} [maxStrike] - Optional maximum strike filter
   * @returns {Promise<string>} CSV formatted string
   */
  async getOptionsChain(currency, expiry, minStrike = null, maxStrike = null) {
    // Step 1: Get all option instruments for this currency (HTTP)
    const instruments = await this._getInstrumentsRaw(currency, 'option', false);

    // Step 2: Filter instruments by expiry date
    const instrumentNames = filterInstrumentsByExpiry(instruments, expiry);

    if (instrumentNames.length === 0) {
      return `# No instruments found for ${currency} expiry ${expiry}\n`;
    }

    // Step 3: Connect WebSocket if not already connected
    if (this.wsClient === null) {
      // Convert HTTP URL to WebSocket URL
      let wsUrl = this.baseUrl.replace('https://', 'wss://').replace('http://', 'ws://');
      if (!wsUrl.endsWith('/ws/api/v2')) {
        wsUrl = wsUrl.replace(/\/api\/v2.*$/, '/ws/api/v2');
      }

      this.wsClient = new WebSocketClient(wsUrl);
      await this.wsClient.connect();
    }

    // Step 4: Subscribe and get ticker snapshots (WebSocket)
    const tickerData = await this.wsClient.getTickerSnapshots(instrumentNames);

    // Step 5: Build CSV from ticker data
    const csvOutput = buildOptionsChainCSV(
      tickerData,
      currency,
      expiry,
      minStrike,
      maxStrike
    );

    return csvOutput;
  }
}
