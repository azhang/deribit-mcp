/**
 * Deribit API client for public endpoints.
 *
 * Supports both HTTP and WebSocket protocols:
 * - HTTP for simple request/response queries
 * - WebSocket for real-time subscriptions and options chain data
 */

import { WebSocketClient } from './ws-client.js';
import { filterInstrumentsByExpiry, assertSingleUnderlying, buildOptionsChainCSV } from './options.js';
import { encode } from '@toon-format/toon';

export class DeribitClient {
  constructor(baseUrl = 'https://www.deribit.com/api/v2', clientId = null, clientSecret = null) {
    this.baseUrl = baseUrl;
    this.wsClient = null;
    // Simple in-memory cache with TTL
    this.cache = new Map();
    this.cacheTTL = 2000; // 2 second cache for market data

    // Authentication credentials for Basic Auth
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  /**
   * Create Basic Auth header (base64 encoded client_id:client_secret)
   * Used for all HTTP requests to avoid /public/auth endpoint which can get 429 rate limited
   */
  _createBasicAuthHeader() {
    if (!this.clientId || !this.clientSecret) {
      throw new Error('Client ID and Client Secret are required for Basic Auth');
    }
    const credentials = `${this.clientId}:${this.clientSecret}`;
    const base64Credentials = btoa(credentials);
    return `Basic ${base64Credentials}`;
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
   * Make a call to the Deribit REST API with caching.
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

    const urlString = url.toString();

    // Check cache first
    const cached = this.cache.get(urlString);
    if (cached && Date.now() < cached.expiry) {
      return cached.data;
    }

    // Prepare headers
    const headers = {
      'User-Agent': 'deribit-mcp/0.4.0'
    };

    // Use Basic Auth for all HTTP requests to avoid /public/auth endpoint
    if (this.clientId && this.clientSecret) {
      headers['Authorization'] = this._createBasicAuthHeader();
    }

    // Retry logic for network issues
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch(urlString, { headers });

        if (!response.ok) {
          // Don't retry on rate limits - throw immediately with helpful message
          if (response.status === 429) {
            const authTip = !this.clientId ?
              "\n\n💡 TIP: Use 'set_deribit_credentials' to authenticate. Authenticated requests have much higher rate limits and won't hit this error." :
              "\n\n⚠️  You are authenticated but still being rate limited. This may indicate an issue with your credentials or Deribit's rate limits.";
            throw new Error(`Rate limited by Deribit API (429) on endpoint: /public/${method}. Cloudflare Workers share IP addresses, causing frequent rate limits on public endpoints.${authTip}`);
          }
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        if (data.error) {
          const error = data.error;
          throw new Error(`API Error ${error.code}: ${error.message}`);
        }

        // Cache the result
        this.cache.set(urlString, {
          data: data.result,
          expiry: Date.now() + this.cacheTTL
        });

        return data.result;
      } catch (error) {
        console.error(`[Attempt ${attempt}/3] Fetch failed:`, error.message);
        lastError = error;

        // Don't retry on rate limits or API errors
        if (error.message.includes('Rate limited') || error.message.includes('API Error') || attempt === 3) {
          throw error;
        }

        // Wait before retrying (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, 500 * attempt));
      }
    }

    throw lastError;
  }

  /**
   * Make a call to a private Deribit API endpoint
   * @param {string} method - The API method to call (e.g., "get_account_summary")
   * @param {Object} params - Parameters for the method
   * @returns {Promise<any>} The result from the API response
   */
  async _callPrivate(method, params = {}) {
    const url = new URL(`${this.baseUrl}/private/${method}`);

    // Add parameters
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, value);
      }
    }

    const urlString = url.toString();

    // Prepare headers with Basic Auth
    const headers = {
      'User-Agent': 'deribit-mcp/0.4.0'
    };

    // Use Basic Auth for all HTTP requests to avoid /public/auth endpoint
    if (this.clientId && this.clientSecret) {
      headers['Authorization'] = this._createBasicAuthHeader();
    }

    try {
      const response = await fetch(urlString, { headers });

      if (!response.ok) {

        if (response.status === 429) {
          throw new Error(`Rate limited by Deribit API (429) on endpoint: /private/${method}. Please try again in a few seconds.`);
        }

        // Log the response body for debugging 400 errors
        const errorText = await response.text();
        console.error(`HTTP ${response.status} response:`, errorText);
        throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
      }

      const data = await response.json();

      if (data.error) {
        const error = data.error;
        throw new Error(`API Error ${error.code}: ${error.message}`);
      }

      return data.result;
    } catch (error) {
      console.error(`Private API call failed:`, error.message);
      throw error;
    }
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
   * @returns {Promise<string>} TOON formatted string with instrument data
   */
  async getInstruments(currency, kind = null, expired = false) {
    const instruments = await this._getInstrumentsRaw(currency, kind, expired);

    if (!instruments || instruments.length === 0) {
      return encode({ instruments: [] });
    }

    // Build array of instrument objects with relevant fields
    const instrumentList = [];

    // For options, include option-specific fields
    if (kind === 'option') {
      for (const inst of instruments) {
        instrumentList.push({
          instrument_name: inst.instrument_name,
          kind: inst.kind,
          strike: inst.strike || '',
          option_type: inst.option_type || '',
          expiration_timestamp: inst.expiration_timestamp,
          is_active: inst.is_active,
          settlement_currency: inst.settlement_currency
        });
      }
    } else {
      // For futures/spots, simpler format
      for (const inst of instruments) {
        instrumentList.push({
          instrument_name: inst.instrument_name,
          kind: inst.kind,
          expiration_timestamp: inst.expiration_timestamp || '',
          is_active: inst.is_active,
          settlement_currency: inst.settlement_currency
        });
      }
    }

    return encode({ instruments: instrumentList });
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
   * Get ticker information for multiple instruments using a single WebSocket connection.
   *
   * @param {Array<string>} instrumentNames - Array of instrument names
   * @returns {Promise<Object>} Dictionary mapping instrument name to ticker data
   */
  async getTickers(instrumentNames) {
    // Connect WebSocket if not already connected
    if (this.wsClient === null) {
      let wsUrl = this.baseUrl.replace('https://', 'wss://').replace('http://', 'ws://');
      if (!wsUrl.endsWith('/ws/api/v2')) {
        wsUrl = wsUrl.replace(/\/api\/v2.*$/, '/ws/api/v2');
      }

      this.wsClient = new WebSocketClient(wsUrl, this.clientId, this.clientSecret);
      await this.wsClient.connect();
    }

    try {
      // Subscribe and get ticker snapshots
      return await this.wsClient.getTickerSnapshots(instrumentNames);
    } finally {
      // Clean up: unsubscribe from the streams
      await this.wsClient.unsubscribeTickers(instrumentNames);
    }
  }

  /**
   * Get index prices for multiple indices using a single WebSocket connection.
   *
   * @param {Array<string>} indexNames - Array of index names (e.g., ["btc_usd", "eth_usd"])
   * @returns {Promise<Object>} Dictionary mapping index name to price data
   */
  async getIndexPrices(indexNames) {
    const results = {};

    // Make parallel HTTP requests for each index
    await Promise.all(
      indexNames.map(async (indexName) => {
        try {
          results[indexName] = await this.getIndexPrice(indexName);
        } catch (error) {
          results[indexName] = { error: error.message };
        }
      })
    );

    return results;
  }

  /**
   * Get order books for multiple instruments.
   *
   * @param {Array<string>} instrumentNames - Array of instrument names
   * @param {number} [depth] - Optional order book depth
   * @returns {Promise<Object>} Dictionary mapping instrument name to order book data
   */
  async getOrderBooks(instrumentNames, depth = null) {
    const results = {};

    // Make parallel HTTP requests for each instrument
    await Promise.all(
      instrumentNames.map(async (instrumentName) => {
        try {
          results[instrumentName] = await this.getOrderBook(instrumentName, depth);
        } catch (error) {
          results[instrumentName] = { error: error.message };
        }
      })
    );

    return results;
  }

  /**
   * Get options chains for multiple expiries using a single WebSocket connection.
   *
   * @param {string} currency - Currency symbol
   * @param {Array<string>} expiries - Array of expiry dates (e.g., ["9OCT25", "16OCT25"])
   * @param {number} [minStrike] - Optional minimum strike filter
   * @param {number} [maxStrike] - Optional maximum strike filter
   * @param {string} [underlying] - Underlying coin; required when the settlement currency covers several (e.g. USDC)
   * @returns {Promise<Object>} Dictionary mapping expiry to CSV string
   */
  async getOptionsChains(currency, expiries, minStrike = null, maxStrike = null, underlying = null) {
    // Step 1: Get all option instruments for this currency (HTTP)
    const instruments = await this._getInstrumentsRaw(currency, 'option', false);

    // Step 2: Filter instruments by all expiry dates and collect all instrument names
    const allInstrumentNames = [];
    const expiryToInstruments = {};

    for (const expiry of expiries) {
      const instrumentNames = filterInstrumentsByExpiry(instruments, expiry, underlying);
      expiryToInstruments[expiry] = instrumentNames;
      allInstrumentNames.push(...instrumentNames);
    }
    assertSingleUnderlying(allInstrumentNames, currency);

    if (allInstrumentNames.length === 0) {
      const results = {};
      for (const expiry of expiries) {
        results[expiry] = `# No instruments found for ${currency}${underlying ? ` ${underlying}` : ''} expiry ${expiry}\n`;
      }
      return results;
    }

    // Step 3: Connect WebSocket if not already connected
    if (this.wsClient === null) {
      let wsUrl = this.baseUrl.replace('https://', 'wss://').replace('http://', 'ws://');
      if (!wsUrl.endsWith('/ws/api/v2')) {
        wsUrl = wsUrl.replace(/\/api\/v2.*$/, '/ws/api/v2');
      }

      this.wsClient = new WebSocketClient(wsUrl, this.clientId, this.clientSecret);
      await this.wsClient.connect();
    }

    try {
      // Step 4: Subscribe and get ticker snapshots for ALL instruments at once (WebSocket)
      const allTickerData = await this.wsClient.getTickerSnapshots(allInstrumentNames);

      // Step 5: Build CSV for each expiry from the combined ticker data
      const results = {};
      for (const expiry of expiries) {
        const instrumentNames = expiryToInstruments[expiry];

        // Filter ticker data for this expiry
        const tickerData = {};
        for (const name of instrumentNames) {
          if (allTickerData[name]) {
            tickerData[name] = allTickerData[name];
          }
        }

        results[expiry] = buildOptionsChainCSV(
          tickerData,
          currency,
          expiry,
          minStrike,
          maxStrike
        );
      }

      return results;
    } finally {
      // Clean up: unsubscribe from all the streams
      await this.wsClient.unsubscribeTickers(allInstrumentNames);
    }
  }

  /**
   * Get available expiration dates for instruments.
   *
   * @param {string} currency - Currency symbol
   * @param {string} kind - Instrument kind
   * @param {string} [currencyPair] - Optional currency pair filter
   * @returns {Promise<string>} TOON formatted string with expiration data
   */
  async getExpirations(currency, kind, currencyPair = null) {
    const params = { currency, kind };
    if (currencyPair !== null) {
      params.currency_pair = currencyPair;
    }

    const result = await this._call('get_expirations', params);

    const expirationsList = [];

    if (!result) {
      return encode({ expirations: expirationsList });
    }

    // Check if first value is a dict (grouped format) or list (any format)
    const firstValue = Object.values(result)[0];

    if (typeof firstValue === 'object' && !Array.isArray(firstValue)) {
      // Grouped format: {currency: {kind: [expirations]}}
      for (const [curr, kinds] of Object.entries(result)) {
        for (const [k, expirations] of Object.entries(kinds)) {
          for (const expiry of expirations) {
            expirationsList.push({
              currency: curr,
              kind: k,
              expiration: expiry
            });
          }
        }
      }
    } else {
      // "any" format: {kind: [expirations]}
      for (const [k, expirations] of Object.entries(result)) {
        for (const expiry of expirations) {
          expirationsList.push({
            currency: 'any',
            kind: k,
            expiration: expiry
          });
        }
      }
    }

    return encode({ expirations: expirationsList });
  }

  /**
   * Get complete options chain data for a specific expiry.
   *
   * @param {string} currency - Currency symbol
   * @param {string} expiry - Expiry date in format "9OCT25"
   * @param {number} [minStrike] - Optional minimum strike filter
   * @param {number} [maxStrike] - Optional maximum strike filter
   * @param {string} [underlying] - Underlying coin; required when the settlement currency covers several (e.g. USDC)
   * @returns {Promise<string>} CSV formatted string
   */
  async getOptionsChain(currency, expiry, minStrike = null, maxStrike = null, underlying = null) {
    // Step 1: Get all option instruments for this currency (HTTP)
    const instruments = await this._getInstrumentsRaw(currency, 'option', false);

    // Step 2: Filter instruments by expiry date
    const instrumentNames = filterInstrumentsByExpiry(instruments, expiry, underlying);

    if (instrumentNames.length === 0) {
      return `# No instruments found for ${currency}${underlying ? ` ${underlying}` : ''} expiry ${expiry}\n`;
    }
    assertSingleUnderlying(instrumentNames, currency);

    // Step 3: Connect WebSocket if not already connected
    if (this.wsClient === null) {
      // Convert HTTP URL to WebSocket URL
      let wsUrl = this.baseUrl.replace('https://', 'wss://').replace('http://', 'ws://');
      if (!wsUrl.endsWith('/ws/api/v2')) {
        wsUrl = wsUrl.replace(/\/api\/v2.*$/, '/ws/api/v2');
      }

      this.wsClient = new WebSocketClient(wsUrl, this.clientId, this.clientSecret);
      await this.wsClient.connect();
    }

    try {
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
    } finally {
      // Clean up: unsubscribe from the streams
      await this.wsClient.unsubscribeTickers(instrumentNames);
    }
  }

  /**
   * Get volatility index (DVOL) data.
   *
   * @param {string} currency - Currency symbol (e.g., "BTC", "ETH")
   * @param {number} startTimestamp - Start timestamp in milliseconds
   * @param {number} endTimestamp - End timestamp in milliseconds
   * @param {string} resolution - Resolution in minutes (e.g., "60")
   * @returns {Promise<Object>} Volatility index data including current level and changes
   */
  async getVolatilityIndexData(currency, startTimestamp, endTimestamp, resolution) {
    return await this._call('get_volatility_index_data', {
      currency,
      start_timestamp: startTimestamp,
      end_timestamp: endTimestamp,
      resolution
    });
  }

  /**
   * Get historical volatility for a currency.
   *
   * @param {string} currency - Currency symbol (e.g., "BTC", "ETH")
   * @returns {Promise<Object>} Historical volatility data
   */
  async getHistoricalVolatility(currency) {
    return await this._call('get_historical_volatility', { currency });
  }

  /**
   * Get combo instruments (multi-leg strategies).
   *
   * @param {string} currency - Currency symbol (e.g., "BTC", "ETH")
   * @returns {Promise<Array>} List of combo instruments
   */
  async getCombos(currency) {
    return await this._call('get_combos', { currency });
  }

  /**
   * Get funding rate for perpetual contracts over a time period.
   *
   * @param {string} instrumentName - The instrument name (e.g., "BTC-PERPETUAL")
   * @param {number} startTimestamp - Start timestamp in milliseconds
   * @param {number} endTimestamp - End timestamp in milliseconds
   * @returns {Promise<Object>} Funding rate data for the specified period
   */
  async getFundingRate(instrumentName, startTimestamp, endTimestamp) {
    return await this._call('get_funding_rate_value', {
      instrument_name: instrumentName,
      start_timestamp: startTimestamp,
      end_timestamp: endTimestamp
    });
  }

  /**
   * Get historical funding rate data for perpetual contracts.
   *
   * @param {string} instrumentName - The instrument name (e.g., "BTC-PERPETUAL")
   * @param {number} [startTimestamp] - Start timestamp in milliseconds
   * @param {number} [endTimestamp] - End timestamp in milliseconds
   * @returns {Promise<Array>} Array of historical funding rate data points
   */
  async getFundingRateHistory(instrumentName, startTimestamp = null, endTimestamp = null) {
    const params = { instrument_name: instrumentName };
    if (startTimestamp !== null) {
      params.start_timestamp = startTimestamp;
    }
    if (endTimestamp !== null) {
      params.end_timestamp = endTimestamp;
    }
    return await this._call('get_funding_rate_history', params);
  }

  /**
   * Get historical delivery prices for futures.
   *
   * @param {string} indexName - Index name (e.g., "btc_usd", "eth_usd")
   * @param {number} [offset] - Offset for pagination
   * @param {number} [count] - Number of results to return
   * @returns {Promise<Object>} Historical delivery price data
   */
  async getDeliveryPrices(indexName, offset = null, count = null) {
    const params = { index_name: indexName };
    if (offset !== null) {
      params.offset = offset;
    }
    if (count !== null) {
      params.count = count;
    }
    return await this._call('get_delivery_prices', params);
  }

  /**
   * Get book summary for all instruments of a currency.
   *
   * @param {string} currency - Currency symbol (e.g., "BTC", "ETH")
   * @param {string} [kind] - Optional instrument kind filter
   * @returns {Promise<Array>} Summary data for all instruments including best bid/ask, volume, etc.
   */
  async getBookSummaryByCurrency(currency, kind = null) {
    const params = { currency };
    if (kind !== null) {
      params.kind = kind;
    }
    return await this._call('get_book_summary_by_currency', params);
  }

  /**
   * Get detailed book summary for a specific instrument.
   *
   * @param {string} instrumentName - The instrument name
   * @returns {Promise<Object>} Detailed summary including best bid/ask, volume, mark price, etc.
   */
  async getBookSummaryByInstrument(instrumentName) {
    return await this._call('get_book_summary_by_instrument', { instrument_name: instrumentName });
  }

  /**
   * Get TradingView-compatible chart data (OHLCV).
   *
   * @param {string} instrumentName - The instrument name
   * @param {string} resolution - Chart resolution (1, 3, 5, 10, 15, 30, 60, 120, 180, 360, 720, 1D)
   * @param {number} startTimestamp - Start time (UNIX timestamp in milliseconds)
   * @param {number} endTimestamp - End time (UNIX timestamp in milliseconds)
   * @returns {Promise<Object>} OHLCV chart data
   */
  async getTradingviewChartData(instrumentName, resolution, startTimestamp, endTimestamp) {
    return await this._call('get_tradingview_chart_data', {
      instrument_name: instrumentName,
      resolution,
      start_timestamp: startTimestamp,
      end_timestamp: endTimestamp
    });
  }

  // ===== PRIVATE API METHODS (Require Authentication) =====

  /**
   * Get account summary for a specific currency (requires authentication)
   * @param {string} currency - Currency (BTC, ETH, USDC, etc.)
   * @param {boolean} extended - Include additional fields
   * @returns {Promise<Object>} Account summary data
   */
  async getAccountSummary(currency, extended = true) {
    return await this._callPrivate('get_account_summary', { currency, extended });
  }

  /**
   * Get current positions (requires authentication)
   * @param {string} currency - Currency (BTC, ETH, USDC, etc.)
   * @param {string} kind - Instrument kind (future, option, spot, or omit for all)
   * @returns {Promise<Array>} Array of position data
   */
  async getPositions(currency, kind = null) {
    const params = { currency };
    if (kind) {
      params.kind = kind;
    }
    return await this._callPrivate('get_positions', params);
  }

  /**
   * Get open orders (requires authentication)
   * @param {string} currency - Currency (BTC, ETH, USDC, etc.)
   * @param {string} kind - Instrument kind (future, option, spot, or omit for all)
   * @param {string} type - Order type (limit, market, stop_limit, stop_market, or omit for all)
   * @returns {Promise<Array>} Array of open orders
   */
  async getOpenOrders(currency = null, kind = null, type = null) {
    const params = {};
    if (currency) params.currency = currency;
    if (kind) params.kind = kind;
    if (type) params.type = type;

    const endpoint = currency ? 'get_open_orders_by_currency' : 'get_open_orders';
    return await this._callPrivate(endpoint, params);
  }

  /**
   * Place an order (requires authentication)
   * WARNING: This places real orders on the exchange!
   * @param {Object} orderParams - Order parameters
   * @returns {Promise<Object>} Order result
   */
  async placeOrder(orderParams) {
    // Required: instrument_name, amount, type (limit/market)
    // For limit orders: also need price
    // Optional: label, reduce_only, post_only, etc.
    return await this._callPrivate('buy', orderParams); // or 'sell'
  }

  /**
   * Buy an instrument (requires authentication)
   * @param {string} instrumentName - The instrument to buy
   * @param {number} amount - Amount in contracts or currency
   * @param {string} type - Order type (limit, market, stop_limit, stop_market)
   * @param {number} price - Limit price (required for limit orders)
   * @param {Object} additionalParams - Additional order parameters
   * @returns {Promise<Object>} Order result
   */
  async buy(instrumentName, amount, type = 'limit', price = null, additionalParams = {}) {
    const params = {
      instrument_name: instrumentName,
      amount,
      type,
      ...additionalParams
    };
    if (type === 'limit' || type === 'stop_limit') {
      if (!price) throw new Error('Price is required for limit orders');
      params.price = price;
    }
    return await this._callPrivate('buy', params);
  }

  /**
   * Sell an instrument (requires authentication)
   * @param {string} instrumentName - The instrument to sell
   * @param {number} amount - Amount in contracts or currency
   * @param {string} type - Order type (limit, market, stop_limit, stop_market)
   * @param {number} price - Limit price (required for limit orders)
   * @param {Object} additionalParams - Additional order parameters
   * @returns {Promise<Object>} Order result
   */
  async sell(instrumentName, amount, type = 'limit', price = null, additionalParams = {}) {
    const params = {
      instrument_name: instrumentName,
      amount,
      type,
      ...additionalParams
    };
    if (type === 'limit' || type === 'stop_limit') {
      if (!price) throw new Error('Price is required for limit orders');
      params.price = price;
    }
    return await this._callPrivate('sell', params);
  }

  /**
   * Cancel an order (requires authentication)
   * @param {string} orderId - The order ID to cancel
   * @returns {Promise<Object>} Cancellation result
   */
  async cancelOrder(orderId) {
    return await this._callPrivate('cancel', { order_id: orderId });
  }

  /**
   * Cancel all orders (requires authentication)
   * @param {string} currency - Optional currency filter
   * @param {string} kind - Optional instrument kind filter
   * @param {string} type - Optional order type filter
   * @returns {Promise<number>} Number of cancelled orders
   */
  async cancelAllOrders(currency = null, kind = null, type = null) {
    const params = {};
    if (currency) params.currency = currency;
    if (kind) params.kind = kind;
    if (type) params.type = type;

    const endpoint = currency ? 'cancel_all_by_currency' : 'cancel_all';
    return await this._callPrivate(endpoint, params);
  }

  /**
   * Get order history (requires authentication)
   * @param {string} currency - Currency
   * @param {string} kind - Instrument kind (optional)
   * @param {number} count - Number of orders to retrieve
   * @param {number} offset - Offset for pagination
   * @returns {Promise<Array>} Array of historical orders
   */
  async getOrderHistory(currency, kind = null, count = 100, offset = 0) {
    const params = { currency, count, offset };
    if (kind) params.kind = kind;
    return await this._callPrivate('get_order_history_by_currency', params);
  }

  /**
   * Get user trades (requires authentication)
   * @param {string} currency - Currency
   * @param {string} kind - Instrument kind (optional)
   * @param {number} count - Number of trades to retrieve
   * @param {boolean} includeOld - Include old trades
   * @returns {Promise<Object>} Trade history
   */
  async getUserTrades(currency, kind = null, count = 100, includeOld = false) {
    const params = { currency, count, include_old: includeOld };
    if (kind) params.kind = kind;
    return await this._callPrivate('get_user_trades_by_currency', params);
  }

  /**
   * Get subaccounts (requires authentication)
   * @param {boolean} withPortfolio - Include portfolio info
   * @returns {Promise<Array>} List of subaccounts
   */
  async getSubaccounts(withPortfolio = false) {
    return await this._callPrivate('get_subaccounts', { with_portfolio: withPortfolio });
  }
}
