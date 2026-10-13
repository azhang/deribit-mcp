import { DeribitError, DeribitTransportError } from './errors.js';

/**
 * JSON-RPC over WebSocket. Opens lazily, shares one handshake between concurrent
 * callers, and answers heartbeats. If the server drops the connection while
 * subscriptions are active, it reconnects with backoff, re-authenticates and
 * resubscribes. Closes itself after `idleTimeoutMs` with no pending requests or
 * subscriptions.
 */
export class WsTransport {
  constructor({ url, auth, timeoutMs, idleTimeoutMs, WebSocketImpl, clientName }) {
    this.url = url;
    this.auth = auth; // async (call) => void, or null
    this.timeoutMs = timeoutMs;
    this.idleTimeoutMs = idleTimeoutMs;
    this.WebSocketImpl = WebSocketImpl ?? globalThis.WebSocket;
    this.clientName = clientName;
    this.ws = null;
    this.connecting = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map(); // channel -> Set<fn>
    this.latest = new Map(); // channel -> latest full state (incremental changes merged)
    this.idleTimer = null;
    this.reconnectTimer = null;
    this.reconnectDelayMs = 0;
  }

  get connected() {
    return this.ws !== null && this.connecting === null;
  }

  async connect() {
    if (this.connecting) return this.connecting;
    if (this.ws) return;
    this.connecting = this.#open().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  async #open() {
    if (!this.WebSocketImpl) {
      throw new DeribitTransportError('connect', 'no WebSocket implementation available; pass WebSocketImpl');
    }
    const ws = new this.WebSocketImpl(this.url);
    this.ws = ws;
    try {
      await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = () => reject(new DeribitTransportError('connect', `could not connect to ${this.url}`));
      });
      ws.onmessage = (event) => this.#onMessage(JSON.parse(event.data));
      ws.onerror = () => {};
      ws.onclose = () => this.#onClose(ws, 'connection closed');

      await this.#send('public/set_heartbeat', { interval: 30 });
      await this.#send('public/hello', this.clientName);
      if (this.auth) await this.auth((method, params) => this.#send(method, params));

      // Resubscribe channels that still have listeners after a reconnect
      const channels = [...this.listeners.keys()];
      if (channels.length) await this.#subscribeRaw(channels);
    } catch (error) {
      this.#onClose(ws, error.message);
      try { ws.close(); } catch { /* already closed */ }
      throw error;
    }
  }

  #onClose(ws, reason, { byClient = false } = {}) {
    if (this.ws !== ws) return;
    this.ws = null;
    this.latest.clear();
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new DeribitTransportError(p.method, `WebSocket ${reason}`));
      this.pending.delete(id);
    }
    for (const [channel, fns] of this.listeners) {
      for (const fn of fns) fn.onClose?.(reason, channel);
    }
    if (!byClient) this.#scheduleReconnect();
  }

  /** Reconnect (and resubscribe, in #open) while listeners remain; backoff 1s doubling to 30s. */
  #scheduleReconnect() {
    if (this.reconnectTimer || this.listeners.size === 0) return;
    this.reconnectDelayMs = Math.min(30_000, this.reconnectDelayMs ? this.reconnectDelayMs * 2 : 1_000);
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.listeners.size === 0) return;
      try {
        await this.connect();
        this.reconnectDelayMs = 0;
      } catch {
        this.#scheduleReconnect();
      }
    }, this.reconnectDelayMs);
  }

  #onMessage(msg) {
    if (msg.method === 'heartbeat') {
      if (msg.params?.type === 'test_request') this.#send('public/test', {}).catch(() => {});
      return;
    }
    if (msg.method === 'subscription') {
      const { channel, data } = msg.params;
      if (data?.type === 'change') {
        const prev = this.latest.get(channel);
        if (prev) this.latest.set(channel, mergeChange(prev, data));
      } else {
        this.latest.set(channel, data);
      }
      for (const fn of this.listeners.get(channel) ?? []) fn(data, channel);
      return;
    }
    const p = this.pending.get(msg.id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(msg.id);
    if (msg.error) p.reject(new DeribitError(p.method, msg.error));
    else p.resolve(msg.result);
    this.#scheduleIdleClose();
  }

  #send(method, params) {
    // readyState is undefined on minimal WebSocket implementations; 1 is OPEN.
    if (!this.ws || (this.ws.readyState !== undefined && this.ws.readyState !== 1)) {
      return Promise.reject(new DeribitTransportError(method, 'WebSocket is not open'));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new DeribitTransportError(method, `timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      try {
        this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
      } catch (cause) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new DeribitTransportError(method, `send failed: ${cause.message}`, { cause }));
      }
    });
  }

  async call(method, params) {
    this.#cancelIdleClose();
    await this.connect();
    return this.#send(method, params);
  }

  #subscribeRaw(channels) {
    const priv = channels.some((c) => c.startsWith('user.') || c.startsWith('block_'));
    return this.#send(priv ? 'private/subscribe' : 'public/subscribe', { channels });
  }

  /**
   * Add a listener; subscribes on the server only for channels not already subscribed.
   * @returns {Promise<string[]>} the channels now active. Deribit silently skips invalid
   *   channels (e.g. unknown instruments); those are dropped and not returned.
   */
  async subscribe(channels, listener) {
    this.#cancelIdleClose();
    await this.connect();
    const fresh = channels.filter((c) => !this.listeners.has(c));
    for (const c of channels) {
      if (!this.listeners.has(c)) this.listeners.set(c, new Set());
      this.listeners.get(c).add(listener);
      // The server only sends the initial snapshot to the first subscriber, so
      // replay the latest known full state to listeners joining an existing channel.
      const known = this.latest.get(c);
      if (known && !fresh.includes(c)) queueMicrotask(() => listener({ ...known, type: 'snapshot' }, c));
    }
    if (!fresh.length) return channels;
    let accepted;
    try {
      accepted = new Set(await this.#subscribeRaw(fresh));
    } catch (error) {
      this.#removeListener(channels, listener);
      throw error;
    }
    const rejected = fresh.filter((c) => !accepted.has(c));
    if (rejected.length) this.#removeListener(rejected, listener);
    return channels.filter((c) => !rejected.includes(c));
  }

  #removeListener(channels, listener) {
    const empty = [];
    for (const c of channels) {
      const set = this.listeners.get(c);
      if (!set) continue;
      set.delete(listener);
      if (set.size === 0) {
        this.listeners.delete(c);
        this.latest.delete(c);
        empty.push(c);
      }
    }
    return empty;
  }

  /** Remove a listener; unsubscribes on the server once a channel has no listeners left. */
  async unsubscribe(channels, listener) {
    const empty = this.#removeListener(channels, listener);
    try {
      if (empty.length && this.connected) {
        const priv = empty.some((c) => c.startsWith('user.') || c.startsWith('block_'));
        await this.#send(priv ? 'private/unsubscribe' : 'public/unsubscribe', { channels: empty });
      }
    } finally {
      this.#scheduleIdleClose();
    }
  }

  #cancelIdleClose() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  #scheduleIdleClose() {
    if (!this.idleTimeoutMs || this.pending.size || this.listeners.size || this.idleTimer) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (!this.pending.size && !this.listeners.size) this.close();
    }, this.idleTimeoutMs);
  }

  close() {
    this.#cancelIdleClose();
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const ws = this.ws;
    if (ws) {
      this.#onClose(ws, 'closed by client', { byClient: true });
      ws.close();
    }
  }
}

/** Apply an incremental_ticker `change` to the previous full state (nested objects merged one level). */
export function mergeChange(prev, change) {
  const out = { ...prev };
  for (const [key, value] of Object.entries(change)) {
    const old = prev[key];
    out[key] = value && typeof value === 'object' && !Array.isArray(value) && old && typeof old === 'object' && !Array.isArray(old)
      ? { ...old, ...value }
      : value;
  }
  return out;
}
