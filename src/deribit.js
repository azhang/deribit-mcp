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
  constructor(baseUrl = 'https://www.deribit.com/api/v2', clientId = null, clientSecret = null, accessToken = null, refreshToken = null) {
    this.baseUrl = baseUrl;
    this.wsClient = null;
    // Simple in-memory cache with TTL
    this.cache = new Map();
    this.cacheTTL = 2000; // 2 second cache for market data

    // Authentication credentials
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.tokenExpiry = null;
  }

  /**
   * Authenticate with Deribit API to get access token
   */
  async authenticate() {
    if (!this.clientId || !this.clientSecret) {
      throw new Error('Client ID and Client Secret are required for authentication');
    }

    // If we have a valid token, use it
    if (this.accessToken && this.tokenExpiry && this.tokenExpiry > Date.now()) {
      return this.accessToken;
    }

    // Try to refresh token if we have one
    if (this.refreshToken && this.tokenExpiry && this.tokenExpiry <= Date.now()) {
      try {
        await this.refreshAccessToken();
        return this.accessToken;
      } catch (error) {
        console.error('Token refresh failed, re-authenticating:', error.message);
      }
    }

    // Authenticate with client credentials
    const response = await fetch(
      `${this.baseUrl}/public/auth?` +
      `grant_type=client_credentials&` +
      `client_id=${encodeURIComponent(this.clientId)}&` +
      `client_secret=${encodeURIComponent(this.clientSecret)}`,
      {
        headers: {
          'User-Agent': 'deribit-mcp/0.4.0'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Authentication failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (data.error) {
      throw new Error(`Authentication error: ${data.error.message}`);
    }

    const result = data.result;
    this.accessToken = result.access_token;
    this.refreshToken = result.refresh_token;
    this.tokenExpiry = Date.now() + (result.expires_in * 1000) - 60000; // Expire 1 minute early

    return this.accessToken;
  }

  /**
   * Refresh the access token using the refresh token
   */
  async refreshAccessToken() {
    if (!this.refreshToken) {
      throw new Error('No refresh token available');
    }

    const response = await fetch(
      `${this.baseUrl}/public/auth?` +
      `grant_type=refresh_token&` +
      `refresh_token=${encodeURIComponent(this.refreshToken)}`,
      {
        headers: {
          'User-Agent': 'deribit-mcp/0.4.0'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (data.error) {
      throw new Error(`Token refresh error: ${data.error.message}`);
    }

    const result = data.result;
    this.accessToken = result.access_token;
    this.refreshToken = result.refresh_token;
    this.tokenExpiry = Date.now() + (result.expires_in * 1000) - 60000; // Expire 1 minute early

    return this.accessToken;
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

    // Retry logic for network issues
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch(urlString, {
          headers: {
            'User-Agent': 'deribit-mcp/0.4.0'
          }
        });

        if (!response.ok) {
          // Don't retry on rate limits - throw immediately with helpful message
          if (response.status === 429) {
            const authTip = !this.clientId ?
              "\n\n💡 TIP: Use 'set_deribit_credentials' to authenticate. Authenticated requests have much higher rate limits and won't hit this error." :
              "";
            throw new Error(`Rate limited by Deribit API (429). Cloudflare Workers share IP addresses, causing frequent rate limits on public endpoints.${authTip}`);
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
    // Ensure we have an access token
    await this.authenticate();

    const url = new URL(`${this.baseUrl}/private/${method}`);

    // Add access token and other parameters
    const allParams = {
      ...params,
      access_token: this.accessToken
    };

    for (const [key, value] of Object.entries(allParams)) {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, value);
      }
    }

    const urlString = url.toString();

    try {
      const response = await fetch(urlString, {
        headers: {
          'User-Agent': 'deribit-mcp/0.4.0'
        }
      });

      if (!response.ok) {
        // If we get 401, try to refresh token and retry once
        if (response.status === 401 && this.refreshToken) {
          console.log('Access token expired, refreshing...');
          await this.refreshAccessToken();
          // Update URL with new token
          url.searchParams.set('access_token', this.accessToken);
          const retryResponse = await fetch(url.toString(), {
            headers: {
              'User-Agent': 'deribit-mcp/0.4.0'
            }
          });
          if (!retryResponse.ok) {
            throw new Error(`HTTP error! status: ${retryResponse.status}`);
          }
          const retryData = await retryResponse.json();
          if (retryData.error) {
            throw new Error(`API Error ${retryData.error.code}: ${retryData.error.message}`);
          }
          return retryData.result;
        }

        if (response.status === 429) {
          throw new Error(`Rate limited by Deribit API. Please try again in a few seconds.`);
        }
        throw new Error(`HTTP error! status: ${response.status}`);
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

      this.wsClient = new WebSocketClient(wsUrl);
      await this.wsClient.connect();
    }

    // Subscribe and get ticker snapshots
    return await this.wsClient.getTickerSnapshots(instrumentNames);
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
   * @returns {Promise<Object>} Dictionary mapping expiry to CSV string
   */
  async getOptionsChains(currency, expiries, minStrike = null, maxStrike = null) {
    // Step 1: Get all option instruments for this currency (HTTP)
    const instruments = await this._getInstrumentsRaw(currency, 'option', false);

    // Step 2: Filter instruments by all expiry dates and collect all instrument names
    const allInstrumentNames = [];
    const expiryToInstruments = {};

    for (const expiry of expiries) {
      const instrumentNames = filterInstrumentsByExpiry(instruments, expiry);
      expiryToInstruments[expiry] = instrumentNames;
      allInstrumentNames.push(...instrumentNames);
    }

    if (allInstrumentNames.length === 0) {
      const results = {};
      for (const expiry of expiries) {
        results[expiry] = `# No instruments found for ${currency} expiry ${expiry}\n`;
      }
      return results;
    }

    // Step 3: Connect WebSocket if not already connected
    if (this.wsClient === null) {
      let wsUrl = this.baseUrl.replace('https://', 'wss://').replace('http://', 'ws://');
      if (!wsUrl.endsWith('/ws/api/v2')) {
        wsUrl = wsUrl.replace(/\/api\/v2.*$/, '/ws/api/v2');
      }

      this.wsClient = new WebSocketClient(wsUrl);
      await this.wsClient.connect();
    }

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

  /**
   * Get volatility index (DVOL) data.
   *
   * @param {string} currency - Currency symbol (e.g., "BTC", "ETH")
   * @returns {Promise<Object>} Volatility index data including current level and changes
   */
  async getVolatilityIndexData(currency) {
    return await this._call('get_volatility_index_data', { currency });
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
   * Get current funding rate for perpetual contracts.
   *
   * @param {string} instrumentName - The instrument name (e.g., "BTC-PERPETUAL")
   * @returns {Promise<Object>} Funding rate data including current, predicted, and historical rates
   */
  async getFundingRate(instrumentName) {
    return await this._call('get_funding_rate_value', { instrument_name: instrumentName });
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
