import { methods, apiVersion } from './generated/methods.js';
import { channels } from './generated/channels.js';
import { validateParams } from './validate.js';
import { WsTransport, mergeChange } from './ws.js';
import { DeribitError, DeribitTransportError, DeribitValidationError } from './errors.js';

export { methods, channels, apiVersion, validateParams, DeribitError, DeribitTransportError, DeribitValidationError };

const HOSTS = {
  production: 'www.deribit.com',
  test: 'test.deribit.com',
};

export class Deribit {
  /**
   * @param {import('./index.js').DeribitOptions} [options]
   */
  constructor({
    env = 'production',
    clientId = null,
    clientSecret = null,
    transport = 'http',
    validate = true,
    timeoutMs = 10_000,
    idleTimeoutMs = 60_000,
    fetch: fetchImpl = globalThis.fetch,
    WebSocket: WebSocketImpl,
    clientName = { client_name: 'deribit-mcp-client', client_version: '0.1.0' },
  } = {}) {
    const host = HOSTS[env];
    if (!host) throw new Error(`env must be one of ${Object.keys(HOSTS).join(', ')}`);
    this.env = env;
    this.httpUrl = `https://${host}/api/v2`;
    this.wsUrl = `wss://${host}/ws/api/v2`;
    this.credentials = clientId && clientSecret ? { clientId, clientSecret } : null;
    this.transport = transport;
    this.validate = validate;
    this.timeoutMs = timeoutMs;
    // Call fetch on the global object: Workers throws "Illegal invocation" when the
    // built-in fetch runs with `this` bound to another object (e.g. this client).
    this.fetch = (...args) => fetchImpl.call(globalThis, ...args);
    this.nextId = 1;
    this.ws = new WsTransport({
      url: this.wsUrl,
      timeoutMs,
      idleTimeoutMs,
      WebSocketImpl,
      clientName,
      auth: this.credentials
        ? (send) => send('public/auth', {
          grant_type: 'client_credentials',
          client_id: this.credentials.clientId,
          client_secret: this.credentials.clientSecret,
        })
        : null,
    });

    // client.public.ticker({...}) / client.private.get_positions({...})
    const scoped = (scope) => new Proxy({}, {
      get: (_, name) => (typeof name === 'string' ? (params) => this.call(`${scope}/${name}`, params) : undefined),
    });
    this.public = scoped('public');
    this.private = scoped('private');
  }

  /** Whether private methods can be called. */
  get authenticated() {
    return this.credentials !== null;
  }

  /**
   * Call any Deribit JSON-RPC method, e.g. `call('public/ticker', { instrument_name: 'BTC-PERPETUAL' })`.
   * Params are checked against the spec first unless `validate: false`.
   */
  async call(method, params = {}, { transport = this.transport } = {}) {
    if (this.validate) validateParams(method, params);
    if (method.startsWith('private/') && !this.credentials) {
      throw new DeribitError(method, { code: 13004, message: 'invalid_credentials', data: { reason: 'no client credentials configured' } });
    }
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null));
    return transport === 'ws' ? this.ws.call(method, clean) : this.#httpCall(method, clean);
  }

  async #httpCall(method, params) {
    const headers = { 'Content-Type': 'application/json' };
    // Authenticate every call when credentials are set: Deribit's rate limits are
    // per user when authenticated, rather than per IP, so this raises public limits too.
    if (this.credentials) {
      headers.Authorization = `Basic ${btoa(`${this.credentials.clientId}:${this.credentials.clientSecret}`)}`;
    }
    let response;
    try {
      response = await this.fetch(this.httpUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id: this.nextId++, method, params }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      const timedOut = cause?.name === 'TimeoutError';
      throw new DeribitTransportError(method, timedOut ? `timed out after ${this.timeoutMs}ms` : `request failed: ${cause.message}`, { cause });
    }
    let body;
    try {
      body = await response.json();
    } catch (cause) {
      throw new DeribitTransportError(method, `HTTP ${response.status} with a non-JSON body`, { status: response.status, cause });
    }
    if (body.error) throw new DeribitError(method, body.error);
    if (!response.ok) throw new DeribitTransportError(method, `HTTP ${response.status}`, { status: response.status });
    return body.result;
  }

  /**
   * Subscribe to channels over WebSocket. `listener(data, channel)` gets every notification.
   * Returns a handle whose `unsubscribe()` removes this listener.
   */
  async subscribe(channelNames, listener) {
    const requested = [].concat(channelNames);
    const active = await this.ws.subscribe(requested, listener);
    return {
      channels: active,
      rejected: requested.filter((c) => !active.includes(c)),
      unsubscribe: () => this.ws.unsubscribe(active, listener),
    };
  }

  /**
   * Subscribe, wait for one complete message per channel, then unsubscribe. For
   * `incremental_ticker.*` channels, later `change` messages are merged into the
   * first `snapshot` so the result is never a partial update.
   *
   * Channels Deribit refuses (e.g. an unknown or expired instrument) don't block the
   * others: they are left out of the result and listed in `snapshot.rejected`.
   *
   * @returns {Promise<Record<string, any>>} channel -> latest full data
   */
  async snapshot(channelNames, { timeoutMs = this.timeoutMs } = {}) {
    const list = [...new Set([].concat(channelNames))];
    const latest = new Map();
    let expected = list.length;
    let done;
    let fail;
    const finished = new Promise((resolve, reject) => { done = resolve; fail = reject; });
    finished.catch(() => {}); // rejection is surfaced by the await below
    const listener = (data, channel) => {
      if (data?.type === 'change') {
        const prev = latest.get(channel);
        if (!prev) return; // ignore changes before the snapshot
        latest.set(channel, mergeChange(prev, data));
      } else {
        latest.set(channel, data);
      }
      if (latest.size >= expected) done();
    };
    listener.onClose = (reason) => fail(new DeribitTransportError('snapshot', `WebSocket ${reason}`));

    let active = [];
    const timer = setTimeout(() => {
      const missing = active.filter((c) => !latest.has(c));
      fail(new DeribitTransportError('snapshot', `timed out waiting for ${missing.length}/${active.length} channels (e.g. ${missing.slice(0, 3).join(', ')})`));
    }, timeoutMs);
    try {
      active = await this.ws.subscribe(list, listener);
      expected = active.length;
      if (latest.size >= expected) done();
      await finished;
      const result = Object.fromEntries(active.map((c) => [c, latest.get(c)]));
      const rejected = list.filter((c) => !active.includes(c));
      if (rejected.length) Object.defineProperty(result, 'rejected', { value: rejected, enumerable: false });
      return result;
    } finally {
      clearTimeout(timer);
      await this.ws.unsubscribe(active, listener).catch(() => {});
    }
  }

  /** Close the WebSocket, if open. HTTP needs no cleanup. */
  close() {
    this.ws.close();
  }
}

/**
 * Search methods (and optionally channels) by keyword. Matches on name, tags,
 * summary, description and param names; ranks name hits first.
 *
 * @returns {Array<{ name: string, kind: 'method' | 'channel', scope: string, summary: string, score: number }>}
 */
export function search(query, { scope, kind = 'method', limit = 10 } = {}) {
  const terms = query.toLowerCase().split(/[\s/_.,]+/).filter(Boolean);
  const pools = [];
  if (kind === 'method' || kind === 'all') pools.push(['method', methods]);
  if (kind === 'channel' || kind === 'all') pools.push(['channel', channels]);
  const results = [];
  for (const [k, pool] of pools) {
    for (const [name, info] of Object.entries(pool)) {
      if (scope && info.scope !== scope) continue;
      const fields = {
        name: name.toLowerCase(),
        params: Object.keys(info.params).join(' ').toLowerCase(),
        tags: info.tags.join(' ').toLowerCase(),
        text: `${info.summary} ${info.description ?? ''}`.toLowerCase(),
      };
      let score = 0;
      for (const t of terms) {
        if (fields.name.includes(t)) score += 5;
        if (fields.params.includes(t)) score += 2;
        if (fields.tags.includes(t)) score += 2;
        if (fields.text.includes(t)) score += 1;
      }
      if (score > 0) results.push({ name, kind: k, scope: info.scope, summary: info.summary, score, deprecated: info.deprecated ?? false });
    }
  }
  return results.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, limit);
}

/** Fill a channel template: channel('ticker.{instrument_name}.{interval}', { instrument_name: 'BTC-PERPETUAL', interval: '100ms' }). */
export function channel(template, params) {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    if (params[key] === undefined) throw new Error(`channel ${template} needs '${key}'`);
    return params[key];
  });
}
