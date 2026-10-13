/**
 * WebSocket client for Deribit API real-time data.
 */

export class WebSocketClient {
  constructor(baseUrl = 'wss://www.deribit.com/ws/api/v2', clientId = null, clientSecret = null) {
    // Convert HTTP base URL to WebSocket if needed
    if (baseUrl.startsWith('http')) {
      baseUrl = baseUrl.replace('https://', 'wss://').replace('http://', 'ws://');
      if (!baseUrl.endsWith('/ws/api/v2')) {
        baseUrl = baseUrl.replace(/\/$/, '') + '/ws/api/v2';
      }
    }

    this.wsUrl = baseUrl;
    this.ws = null;
    this._msgId = 1;
    this._pendingResponses = new Map();
    this._subscriptions = new Map();
    this._receiveTask = null;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.accessToken = null;
    this.authenticated = false;
    this._connecting = null;
  }

  _nextId() {
    return this._msgId++;
  }

  /**
   * Whether the socket is open and the handshake has completed.
   */
  isConnected() {
    return this.ws !== null && this._connecting === null;
  }

  /**
   * Establish WebSocket connection and perform handshake.
   * Safe to call repeatedly or concurrently: reuses an open connection, joins
   * an in-progress handshake, and reconnects after the socket was closed.
   */
  async connect() {
    if (this._connecting) {
      return this._connecting; // Handshake already in progress
    }
    if (this.ws !== null) {
      return; // Already connected
    }

    this._connecting = this._open().finally(() => {
      this._connecting = null;
    });
    return this._connecting;
  }

  async _open() {
    console.log(`Connecting to ${this.wsUrl}`);
    const ws = new WebSocket(this.wsUrl);
    this.ws = ws;

    try {
      // Wait for connection to open
      await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = () => reject(new Error(`WebSocket connection to ${this.wsUrl} failed`));
      });

      // Start message receiver and reset state if Deribit drops the connection
      ws.onmessage = (event) => this._handleMessage(JSON.parse(event.data));
      ws.onerror = (event) => console.error('WebSocket error:', event.message || event.type);
      ws.onclose = () => this._handleClose(ws);

      // Set heartbeat
      await this._call('public/set_heartbeat', { interval: 10 });

      // Send hello
      await this._call('public/hello', {
        client_name: 'deribit-mcp',
        client_version: '0.1.0'
      });

      // Authenticate if credentials are provided
      if (this.clientId && this.clientSecret) {
        await this.authenticate();
      }
    } catch (error) {
      this._handleClose(ws);
      try { ws.close(); } catch { /* already closed */ }
      throw error;
    }

    console.log('WebSocket connected and handshake completed');
  }

  /**
   * Reset connection state after the socket closed, failing in-flight requests
   * so callers don't wait for the request timeout. The next connect() reconnects.
   *
   * @param {WebSocket} ws - The socket that closed
   */
  _handleClose(ws) {
    if (this.ws !== ws) {
      return; // A newer connection has already replaced this one
    }
    this.ws = null;
    this.accessToken = null;
    this.authenticated = false;
    this._subscriptions.clear();

    for (const [msgId, pending] of this._pendingResponses) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('WebSocket connection closed'));
      this._pendingResponses.delete(msgId);
    }
    console.log('WebSocket connection closed');
  }

  /**
   * Authenticate the WebSocket connection using client credentials.
   *
   * Note: This uses the WebSocket JSON-RPC 'public/auth' method, which is
   * different from the HTTP /public/auth endpoint. The WebSocket method
   * doesn't have the same rate limiting issues.
   *
   * After authentication, the server remembers the token for this connection.
   */
  async authenticate() {
    if (this.authenticated) {
      return; // Already authenticated
    }

    console.log('Authenticating WebSocket connection...');
    const result = await this._call('public/auth', {
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret
    });

    this.accessToken = result.access_token;
    this.authenticated = true;
    console.log('WebSocket authenticated successfully');
  }

  /**
   * Close WebSocket connection.
   */
  async close() {
    const ws = this.ws;
    if (ws) {
      this._handleClose(ws);
      ws.close();
    }
  }

  /**
   * Make a JSON-RPC call and wait for response.
   *
   * @param {string} method - The API method to call
   * @param {Object} [params={}] - Optional parameters
   * @returns {Promise<any>} The result from the API response
   */
  async _call(method, params = {}) {
    if (this.ws === null) {
      throw new Error('WebSocket not connected');
    }

    const msgId = this._nextId();
    const message = {
      jsonrpc: '2.0',
      id: msgId,
      method,
      params
    };

    // Create promise for this request
    const promise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._pendingResponses.delete(msgId);
        reject(new Error('Request timeout'));
      }, 10000);

      this._pendingResponses.set(msgId, { resolve, reject, timeout });
    });

    // Send message
    this.ws.send(JSON.stringify(message));

    return promise;
  }

  /**
   * Handle incoming message - either RPC response, subscription notification, or heartbeat.
   *
   * @param {Object} data - Parsed JSON message
   */
  async _handleMessage(data) {
    const method = data.method;

    // Handle heartbeat messages
    if (method === 'heartbeat') {
      const params = data.params || {};
      const heartbeatType = params.type;

      if (heartbeatType === 'test_request') {
        // Server is testing if we're alive - MUST respond with public/test
        console.log('Received test_request heartbeat, responding with public/test');
        this._call('public/test', {}).catch(err => console.error('Failed to respond to heartbeat:', err));
      } else {
        // Regular heartbeat - no response needed
        console.log('Received heartbeat from server');
      }
      return;
    }

    // Check if this is a subscription notification
    if (method === 'subscription') {
      const channel = data.params.channel;
      const subscriptionData = data.params.data;

      // Store subscription data
      this._subscriptions.set(channel, subscriptionData);
      console.log(`Received subscription update for ${channel}`);
      return;
    }

    // Otherwise it's an RPC response
    const msgId = data.id;
    if (msgId === undefined) {
      return;
    }

    const pending = this._pendingResponses.get(msgId);
    if (pending) {
      clearTimeout(pending.timeout);
      this._pendingResponses.delete(msgId);

      if (data.error) {
        const error = data.error;
        pending.reject(new Error(`API Error ${error.code}: ${error.message}`));
      } else {
        pending.resolve(data.result);
      }
    }
  }

  /**
   * Subscribe to ticker updates for multiple instruments.
   *
   * @param {Array<string>} instrumentNames - List of instrument names to subscribe to
   */
  async subscribeTickers(instrumentNames) {
    const channels = instrumentNames.map(name => `incremental_ticker.${name}`);

    console.log(`Subscribing to ${channels.length} ticker channels`);
    const result = await this._call('public/subscribe', { channels });
    console.log(`Subscribed to ${result.length} channels`);
  }

  /**
   * Unsubscribe from ticker updates for multiple instruments.
   *
   * @param {Array<string>} instrumentNames - List of instrument names to unsubscribe from
   */
  async unsubscribeTickers(instrumentNames) {
    const channels = instrumentNames.map(name => `incremental_ticker.${name}`);

    console.log(`Unsubscribing from ${channels.length} ticker channels`);
    const result = await this._call('public/unsubscribe', { channels });
    console.log(`Unsubscribed from ${result.length} channels`);

    // Clean up subscription data
    for (const channel of channels) {
      this._subscriptions.delete(channel);
    }
  }

  /**
   * Wait for initial snapshot data for all instruments.
   *
   * @param {Array<string>} instrumentNames - List of instrument names
   * @param {number} [timeout=10] - Maximum time to wait in seconds
   * @returns {Promise<Object>} Dictionary mapping instrument name to ticker data
   * @throws {Error} If snapshots don't arrive in time
   */
  async waitForSnapshots(instrumentNames, timeout = 10) {
    const channels = new Set(instrumentNames.map(name => `incremental_ticker.${name}`));
    const startTime = Date.now();

    console.log(`Waiting for ${channels.size} snapshots...`);

    while (true) {
      // Check if we have all snapshots
      const received = new Set(
        Array.from(channels).filter(channel => this._subscriptions.has(channel))
      );

      if (received.size === channels.size) {
        // Got all snapshots!
        const result = {};
        for (const name of instrumentNames) {
          result[name] = this._subscriptions.get(`incremental_ticker.${name}`);
        }
        console.log(`Received all ${Object.keys(result).length} snapshots`);
        return result;
      }

      if (this.ws === null) {
        throw new Error('WebSocket connection closed while waiting for snapshots');
      }

      // Check timeout
      const elapsed = (Date.now() - startTime) / 1000;
      if (elapsed > timeout) {
        const missing = channels.size - received.size;
        throw new Error(
          `Timeout waiting for snapshots. Received ${received.size}/${channels.size} (${missing} missing)`
        );
      }

      // Wait a bit before checking again
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * Subscribe to instruments and get their initial snapshot data.
   *
   * @param {Array<string>} instrumentNames - List of instrument names
   * @param {number} [timeout=10] - Maximum time to wait for snapshots
   * @returns {Promise<Object>} Dictionary mapping instrument name to ticker data
   */
  async getTickerSnapshots(instrumentNames, timeout = 10) {
    await this.subscribeTickers(instrumentNames);
    return await this.waitForSnapshots(instrumentNames, timeout);
  }
}
