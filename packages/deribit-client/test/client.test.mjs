import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Deribit, search, channel, methods, channels, validateParams,
  DeribitError, DeribitValidationError, DeribitTransportError,
} from '../src/index.js';

// ---- Spec coverage ----

test('generated metadata covers the spec', () => {
  assert.ok(Object.keys(methods).length >= 180);
  assert.equal(methods['public/ticker'].scope, 'public');
  assert.deepEqual(methods['public/ticker'].required, ['instrument_name']);
  assert.deepEqual(methods['public/get_funding_rate_history'].required.sort(), ['end_timestamp', 'instrument_name', 'start_timestamp']);
  assert.ok(channels['incremental_ticker.(instrument_name)']);
  assert.equal(channels['user.portfolio.(currency)'].scope, 'private');
});

// ---- Validation ----

test('validation reports every problem at once', () => {
  assert.throws(
    () => validateParams('public/get_volatility_index_data', { currency: 'DOGE', resolution: '15', foo: 1 }),
    (err) => {
      assert.ok(err instanceof DeribitValidationError);
      assert.match(err.message, /missing required param 'start_timestamp'/);
      assert.match(err.message, /param 'currency' must be one of/);
      assert.match(err.message, /param 'resolution' must be one of/);
      assert.match(err.message, /unknown param 'foo'/);
      return true;
    },
  );
});

test('validation accepts numeric enums given as strings and numbers', () => {
  const base = { currency: 'BTC', start_timestamp: 0, end_timestamp: 1 };
  validateParams('public/get_volatility_index_data', { ...base, resolution: 3600 });
  validateParams('public/get_volatility_index_data', { ...base, resolution: '3600' });
  validateParams('public/get_volatility_index_data', { ...base, resolution: '1D' });
});

test('unknown method suggests the right scope', () => {
  assert.throws(() => validateParams('public/get_positions'), /did you mean private\/get_positions/);
});

// ---- HTTP transport (stubbed fetch) ----

function stubFetch(handler) {
  const calls = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, headers: init.headers, body });
    const { status = 200, json } = await handler(body);
    return { ok: status < 400, status, json: async () => json };
  };
  return { fetch, calls };
}

test('call() sends JSON-RPC over HTTP POST and returns result', async () => {
  const { fetch, calls } = stubFetch(() => ({ json: { jsonrpc: '2.0', id: 1, result: { index_price: 1 } } }));
  const d = new Deribit({ fetch });
  assert.deepEqual(await d.public.get_index_price({ index_name: 'btc_usd' }), { index_price: 1 });
  assert.equal(calls[0].url, 'https://www.deribit.com/api/v2');
  assert.equal(calls[0].body.method, 'public/get_index_price');
  assert.deepEqual(calls[0].body.params, { index_name: 'btc_usd' });
  assert.equal(calls[0].headers.Authorization, undefined);
});

test('invalid params never reach the network', async () => {
  const { fetch, calls } = stubFetch(() => ({ json: {} }));
  const d = new Deribit({ fetch });
  await assert.rejects(d.call('public/ticker', {}), DeribitValidationError);
  assert.equal(calls.length, 0);
});

test('API errors become DeribitError with code and reason', async () => {
  const { fetch } = stubFetch(() => ({
    status: 400,
    json: { jsonrpc: '2.0', error: { code: -32602, message: 'Invalid params', data: { reason: 'value required', param: 'start_timestamp' } } },
  }));
  const d = new Deribit({ fetch, validate: false });
  await assert.rejects(d.call('public/get_funding_rate_history', { instrument_name: 'X' }), (err) => {
    assert.ok(err instanceof DeribitError);
    assert.equal(err.code, -32602);
    assert.match(err.message, /start_timestamp: value required/);
    return true;
  });
});

test('private calls need credentials and use Basic auth over HTTP', async () => {
  const { fetch, calls } = stubFetch(() => ({ json: { result: [] } }));
  await assert.rejects(new Deribit({ fetch }).private.get_positions({ currency: 'BTC' }), /no client credentials/);
  const d = new Deribit({ fetch, clientId: 'id', clientSecret: 'secret', env: 'test' });
  await d.private.get_positions({ currency: 'BTC' });
  assert.equal(calls[0].url, 'https://test.deribit.com/api/v2');
  assert.equal(calls[0].headers.Authorization, `Basic ${btoa('id:secret')}`);
});

test('public calls are authenticated too when credentials are set (per-user rate limits)', async () => {
  const { fetch, calls } = stubFetch(() => ({ json: { result: {} } }));
  await new Deribit({ fetch, clientId: 'id', clientSecret: 'secret' }).public.get_time();
  assert.equal(calls[0].headers.Authorization, `Basic ${btoa('id:secret')}`);
});

test('network failures become DeribitTransportError', async () => {
  const d = new Deribit({ fetch: async () => { throw new Error('ECONNRESET'); } });
  await assert.rejects(d.public.get_time(), DeribitTransportError);
});

// ---- WebSocket transport (fake socket) ----

class FakeSocket {
  static instances = [];
  static refuse = new Set(); // channels Deribit would silently skip
  constructor(url) {
    this.url = url;
    this.sent = [];
    FakeSocket.instances.push(this);
    queueMicrotask(() => this.onopen?.());
  }
  send(raw) {
    const msg = JSON.parse(raw);
    this.sent.push(msg);
    const reply = (result) => queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) }));
    if (msg.method.endsWith('/subscribe')) reply(msg.params.channels.filter((c) => !FakeSocket.refuse.has(c)));
    else if (msg.method.endsWith('/unsubscribe')) reply(msg.params.channels);
    else if (msg.method === 'public/auth') reply({ access_token: 't' });
    else reply('ok');
  }
  push(channelName, data) {
    this.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', method: 'subscription', params: { channel: channelName, data } }) });
  }
  close() { queueMicrotask(() => this.onclose?.()); }
}

test('snapshot() merges incremental changes into the first full snapshot', async () => {
  FakeSocket.instances = [];
  const d = new Deribit({ WebSocket: FakeSocket, idleTimeoutMs: 0 });
  const ch = 'incremental_ticker.BTC-PERPETUAL';
  const pending = d.snapshot([ch]);
  await new Promise((r) => setTimeout(r, 10));
  const ws = FakeSocket.instances[0];
  ws.push(ch, { type: 'change', best_bid_price: 1 }); // before snapshot: ignored
  ws.push(ch, { type: 'snapshot', best_bid_price: 2, best_ask_price: 3, greeks: { delta: 0.5, vega: 1 } });
  const result = await pending;
  assert.equal(result[ch].best_bid_price, 2);
  assert.deepEqual(result[ch].greeks, { delta: 0.5, vega: 1 });
  assert.deepEqual(ws.sent.map((m) => m.method), ['public/set_heartbeat', 'public/hello', 'public/subscribe', 'public/unsubscribe']);
  d.close();
});

test('ws transport authenticates and fails pending calls when the socket drops', async () => {
  FakeSocket.instances = [];
  const d = new Deribit({ WebSocket: FakeSocket, transport: 'ws', clientId: 'id', clientSecret: 's', idleTimeoutMs: 0 });
  await d.public.get_time();
  const ws = FakeSocket.instances[0];
  assert.ok(ws.sent.some((m) => m.method === 'public/auth' && m.params.client_id === 'id'));
  ws.send = function (raw) { this.sent.push(JSON.parse(raw)); }; // stop replying
  const hung = d.public.get_time();
  ws.close();
  await assert.rejects(hung, /WebSocket connection closed/);
  // Next call reconnects with a new socket
  await d.public.get_time();
  assert.equal(FakeSocket.instances.length, 2);
  d.close();
});

// ---- Search and channels ----

test('search finds methods by intent', () => {
  const names = (q, o) => search(q, o).map((r) => r.name);
  assert.equal(names('funding rate history')[0], 'public/get_funding_rate_history');
  assert.ok(names('order book').includes('public/get_order_book'));
  assert.ok(names('positions', { scope: 'private' }).includes('private/get_positions'));
  assert.ok(search('ticker', { kind: 'channel' }).every((r) => r.kind === 'channel'));
});

test('channel() fills templates', () => {
  assert.equal(channel('ticker.{instrument_name}.{interval}', { instrument_name: 'BTC-PERPETUAL', interval: '100ms' }), 'ticker.BTC-PERPETUAL.100ms');
  assert.throws(() => channel('ticker.{instrument_name}.{interval}', {}), /needs 'instrument_name'/);
});

// ---- Live (DERIBIT_LIVE=1) ----

const live = process.env.DERIBIT_LIVE ? test : test.skip;

live('live: public calls over HTTP and WebSocket return the same shape', async () => {
  const d = new Deribit();
  const http = await d.public.get_index_price({ index_name: 'btc_usd' });
  const ws = await d.call('public/get_index_price', { index_name: 'btc_usd' }, { transport: 'ws' });
  assert.equal(typeof http.index_price, 'number');
  assert.deepEqual(Object.keys(ws).sort(), Object.keys(http).sort());
  d.close();
});

live('live: typed enum value for DVOL resolution is accepted by the API', async () => {
  const d = new Deribit();
  const now = Date.now();
  const r = await d.public.get_volatility_index_data({ currency: 'BTC', start_timestamp: now - 86_400_000, end_timestamp: now, resolution: 3600 });
  assert.ok(r.data.length > 0);
});

live('live: API errors come back as DeribitError', async () => {
  const d = new Deribit({ validate: false });
  await assert.rejects(d.call('public/get_funding_rate_history', { instrument_name: 'BTC-PERPETUAL' }), (err) => err instanceof DeribitError && err.code === -32602);
});

live('live: incremental ticker snapshot has full option fields', async () => {
  const d = new Deribit();
  const [opt] = await d.public.get_instruments({ currency: 'BTC', kind: 'option' });
  const ch = `incremental_ticker.${opt.instrument_name}`;
  const snap = await d.snapshot([ch]);
  assert.ok(snap[ch].greeks && 'mark_iv' in snap[ch]);
  d.close();
});

test('overlapping snapshots of the same channel both resolve', async () => {
  FakeSocket.instances = [];
  const d = new Deribit({ WebSocket: FakeSocket, idleTimeoutMs: 0 });
  const ch = 'incremental_ticker.BTC-PERPETUAL';
  const first = d.subscribe(ch, () => {});
  await first;
  const ws = FakeSocket.instances[0];
  ws.push(ch, { type: 'snapshot', best_bid_price: 2, greeks: { delta: 0.5 } });
  ws.push(ch, { type: 'change', best_bid_price: 3 });
  // A later snapshot() joins the existing subscription and gets the merged state
  const snap = await d.snapshot([ch], { timeoutMs: 500 });
  assert.equal(snap[ch].best_bid_price, 3);
  assert.deepEqual(snap[ch].greeks, { delta: 0.5 });
  // Only one server-side subscribe was sent
  assert.equal(ws.sent.filter((m) => m.method === 'public/subscribe').length, 1);
  d.close();
});

test('snapshot() skips channels Deribit refuses instead of timing out', async () => {
  FakeSocket.instances = [];
  FakeSocket.refuse = new Set(['incremental_ticker.BTC-TYPO']);
  const d = new Deribit({ WebSocket: FakeSocket, idleTimeoutMs: 0 });
  const good = 'incremental_ticker.BTC-PERPETUAL';
  const started = Date.now();
  const pending = d.snapshot([good, 'incremental_ticker.BTC-TYPO'], { timeoutMs: 2000 });
  await new Promise((r) => setTimeout(r, 10));
  FakeSocket.instances[0].push(good, { type: 'snapshot', mark_price: 1 });
  const result = await pending;
  assert.ok(Date.now() - started < 1000);
  assert.deepEqual(Object.keys(result), [good]);
  assert.deepEqual(result.rejected, ['incremental_ticker.BTC-TYPO']);
  FakeSocket.refuse = new Set();
  d.close();
});

test('sending on a closed socket fails fast with a transport error', async () => {
  FakeSocket.instances = [];
  const d = new Deribit({ WebSocket: FakeSocket, transport: 'ws', idleTimeoutMs: 0 });
  await d.public.get_time();
  const ws = FakeSocket.instances[0];
  ws.readyState = 3; // CLOSED, before onclose has fired
  const started = Date.now();
  await assert.rejects(d.public.get_time(), (err) => err instanceof DeribitTransportError && /not open/.test(err.message));
  assert.ok(Date.now() - started < 1000);
  d.close();
});

test('subscriptions reconnect and resubscribe after the server drops the socket', async () => {
  FakeSocket.instances = [];
  const d = new Deribit({ WebSocket: FakeSocket, idleTimeoutMs: 0 });
  const seen = [];
  const sub = await d.subscribe('ticker.BTC-PERPETUAL.100ms', (data) => seen.push(data.n));
  FakeSocket.instances[0].push('ticker.BTC-PERPETUAL.100ms', { n: 1 });
  FakeSocket.instances[0].close(); // server-side drop
  await new Promise((r) => setTimeout(r, 1300)); // first backoff is 1s
  assert.equal(FakeSocket.instances.length, 2, 'reconnected');
  const ws2 = FakeSocket.instances[1];
  assert.ok(ws2.sent.some((m) => m.method === 'public/subscribe' && m.params.channels.includes('ticker.BTC-PERPETUAL.100ms')), 'resubscribed');
  ws2.push('ticker.BTC-PERPETUAL.100ms', { n: 2 });
  assert.deepEqual(seen, [1, 2]);
  await sub.unsubscribe();
  d.close();
});

test('fetch is called on the global object (Workers rejects other receivers)', async () => {
  let receiver;
  const fetch = function (_url, init) {
    receiver = this;
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ result: JSON.parse(init.body).method }) });
  };
  await new Deribit({ fetch }).public.get_time();
  assert.equal(receiver, globalThis);
});
