import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stubDeribit, connect, body, parseTable } from './helpers.mjs';
import { toCsv } from '../src/format.js';
import * as surface from '../src/analytics.js';
import { classifyAll } from '../src/classify.js';

// ---- Tool surface ----

test('hosted exposes only read tools, each titled and annotated read-only', async () => {
  const mcp = await connect({ mode: 'hosted', deribit: stubDeribit().client });
  const { tools } = await mcp.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    'deribit_call', 'deribit_describe', 'deribit_search', 'funding', 'instruments',
    'market_overview', 'options_chain', 'order_books', 'tickers', 'vol_surface', 'volatility',
  ]);
  for (const t of tools) {
    assert.ok(t.title, `${t.name} has a title`);
    assert.equal(t.annotations?.readOnlyHint, true, `${t.name} is read-only`);
  }
  await mcp.close();
});

test('local adds account and write tools; write tools are marked destructive', async () => {
  const mcp = await connect({ mode: 'local', deribit: stubDeribit({ credentials: true }).client });
  const { tools } = await mcp.listTools();
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  assert.ok(byName.account);
  for (const name of ['cancel_orders', 'deribit_call_write']) {
    assert.equal(byName[name].annotations.readOnlyHint, false);
    assert.equal(byName[name].annotations.destructiveHint, true);
  }
  await mcp.close();
});

test('checked-in method classes match the spec (run `npm run classify` after a spec update)', async () => {
  const checkedIn = JSON.parse(await readFile(new URL('../src/generated/method-classes.json', import.meta.url), 'utf8'));
  assert.deepEqual(classifyAll(), checkedIn);
});

// ---- options_chain ----

const instruments = [
  { instrument_name: 'SOL_USDC-14OCT26-150-C', base_currency: 'SOL', expiration_timestamp: 2, strike: 150, option_type: 'call' },
  { instrument_name: 'SOL_USDC-14OCT26-150-P', base_currency: 'SOL', expiration_timestamp: 2, strike: 150, option_type: 'put' },
  { instrument_name: 'SOL_USDC-30OCT26-160-C', base_currency: 'SOL', expiration_timestamp: 3, strike: 160, option_type: 'call' },
  { instrument_name: 'XRP_USDC-14OCT26-2d4-C', base_currency: 'XRP', expiration_timestamp: 2, strike: 2.4, option_type: 'call' },
];
const tickers = {
  'SOL_USDC-14OCT26-150-C': { mark_price: 5, mark_iv: 60, underlying_price: 151, index_price: 150.5, greeks: { delta: 0.52, vega: 0.1 } },
  'SOL_USDC-14OCT26-150-P': { mark_price: 4, mark_iv: 61, underlying_price: 151, greeks: { delta: -0.48, vega: 0.1 } },
};

test('options_chain refuses to mix underlyings and asks for one', async () => {
  const { client } = stubDeribit({ routes: { 'public/get_instruments': () => instruments } });
  const mcp = await connect({ mode: 'hosted', deribit: client });
  const r = await mcp.callTool({ name: 'options_chain', arguments: { currency: 'USDC' } });
  assert.equal(r.isError, true);
  assert.match(body(r), /several underlyings \(SOL, XRP\)/);
  await mcp.close();
});

test('options_chain defaults to the nearest expiry and returns live greeks', async () => {
  const { client } = stubDeribit({ routes: { 'public/get_instruments': () => instruments }, tickers });
  const mcp = await connect({ mode: 'hosted', deribit: client });
  const { meta, rows } = parseTable(await mcp.callTool({ name: 'options_chain', arguments: { currency: 'USDC', underlying: 'sol' } }));
  assert.deepEqual(meta.expiries, ['14OCT26']);
  assert.equal(meta.forward_by_expiry['14OCT26'], 151);
  assert.deepEqual(meta.units, { price: 'USDC', iv: 'percent' });
  assert.equal(meta.rows, 2);
  assert.deepEqual(rows.map((o) => [o.strike, o.type, o.delta]), [[150, 'call', 0.52], [150, 'put', -0.48]]);

  // format: 'json' keeps the rows as JSON
  const json = body(await mcp.callTool({ name: 'options_chain', arguments: { currency: 'USDC', underlying: 'sol', format: 'json' } }));
  assert.equal(json.options.length, 2);
  await mcp.close();
});

test('options_chain lists valid expiries when given an unknown one', async () => {
  const { client } = stubDeribit({ routes: { 'public/get_instruments': () => instruments } });
  const mcp = await connect({ mode: 'hosted', deribit: client });
  const r = await mcp.callTool({ name: 'options_chain', arguments: { currency: 'USDC', underlying: 'SOL', expiries: ['1JAN99'] } });
  assert.equal(r.isError, true);
  assert.match(body(r), /Available: 14OCT26, 30OCT26/);
  await mcp.close();
});

// ---- Generic tools and policy ----

test('deribit_call runs public methods and caps long lists', async () => {
  const trades = Array.from({ length: 250 }, (_, i) => ({ trade_id: i }));
  const { client } = stubDeribit({ routes: { 'public/get_last_trades_by_currency': () => ({ trades, has_more: true }) } });
  const mcp = await connect({ mode: 'hosted', deribit: client });
  const { meta, rows } = parseTable(await mcp.callTool({ name: 'deribit_call', arguments: { method: 'public/get_last_trades_by_currency', params: { currency: 'BTC' }, limit: 50 } }));
  assert.equal(rows.length, 50);
  assert.equal(meta.has_more, true);
  assert.match(meta.truncated, /Showing 50 of 250/);
  await mcp.close();
});

test('deribit_call reports every invalid param before calling Deribit', async () => {
  const { client, calls } = stubDeribit();
  const mcp = await connect({ mode: 'hosted', deribit: client });
  const r = await mcp.callTool({ name: 'deribit_call', arguments: { method: 'public/get_funding_rate_history', params: { instrument_name: 'BTC-PERPETUAL', foo: 1 } } });
  assert.equal(r.isError, true);
  assert.match(body(r), /missing required param 'start_timestamp'/);
  assert.match(body(r), /unknown param 'foo'/);
  assert.equal(calls.length, 0);
  await mcp.close();
});

test('hosted never calls private methods, even through deribit_call', async () => {
  const { client, calls } = stubDeribit({ credentials: true });
  const mcp = await connect({ mode: 'hosted', deribit: client });
  const r = await mcp.callTool({ name: 'deribit_call', arguments: { method: 'private/get_positions', params: { currency: 'BTC' } } });
  assert.equal(r.isError, true);
  assert.match(body(r), /only available on a local server/);
  assert.equal(calls.length, 0);
  await mcp.close();
});

test('local deribit_call refuses writes and points to deribit_call_write', async () => {
  const { client, calls } = stubDeribit({ credentials: true });
  const mcp = await connect({ mode: 'local', deribit: client });
  const r = await mcp.callTool({ name: 'deribit_call', arguments: { method: 'private/buy', params: { instrument_name: 'BTC-PERPETUAL', amount: 10 } } });
  assert.match(body(r), /use deribit_call_write/);
  assert.equal(calls.length, 0);
  await mcp.close();
});

test('funds-moving methods are blocked locally unless allowed', async () => {
  const { client, calls } = stubDeribit({ credentials: true });
  const mcp = await connect({ mode: 'local', deribit: client });
  const r = await mcp.callTool({ name: 'deribit_call_write', arguments: { method: 'private/withdraw', params: { currency: 'BTC', address: 'x', amount: 1 }, confirm: true } });
  assert.match(body(r), /blocked by policy/);
  assert.equal(calls.length, 0);
  await mcp.close();
});

test('deribit_search hides blocked methods and labels classes', async () => {
  const mcp = await connect({ mode: 'hosted', deribit: stubDeribit().client });
  const results = body(await mcp.callTool({ name: 'deribit_search', arguments: { query: 'funding rate history' } }));
  assert.equal(results[0].name, 'public/get_funding_rate_history');
  assert.ok(results.every((r) => r.class === 'public'));
  await mcp.close();
});

// ---- Confirmation for writes ----

const cancelRoute = { 'private/cancel_all_by_currency': () => 3 };
const cancelArgs = { scope: 'currency', currency: 'BTC', kind: 'option' };

test('without elicitation, writes need confirm: true and do not run otherwise', async () => {
  const { client, calls } = stubDeribit({ credentials: true, routes: cancelRoute });
  const mcp = await connect({ mode: 'local', deribit: client });
  const refused = await mcp.callTool({ name: 'cancel_orders', arguments: cancelArgs });
  assert.equal(refused.isError, true);
  assert.match(body(refused), /Not run\..*cancel_all_by_currency.*get their explicit approval/s);
  assert.equal(calls.length, 0);

  const done = body(await mcp.callTool({ name: 'cancel_orders', arguments: { ...cancelArgs, confirm: true } }));
  assert.equal(done.cancelled, 3);
  assert.deepEqual(calls.map((c) => c.method), ['private/cancel_all_by_currency']);
  await mcp.close();
});

test('with elicitation, the user decides, and a model-supplied confirm cannot skip the form', async () => {
  for (const [action, accept, expectRun] of [['accept', true, true], ['accept', false, false], ['decline', undefined, false]]) {
    const { client, calls } = stubDeribit({ credentials: true, routes: cancelRoute });
    const prompts = [];
    const mcp = await connect({
      mode: 'local',
      deribit: client,
      elicit: (req) => {
        prompts.push(req.params.message);
        return action === 'accept' ? { action, content: { confirm: accept } } : { action };
      },
    });
    const r = await mcp.callTool({ name: 'cancel_orders', arguments: { ...cancelArgs, confirm: true } });
    assert.equal(prompts.length, 1, 'the user was asked');
    assert.match(prompts[0], /cancel_all_by_currency.*"kind":"option".*on test/s);
    assert.equal(calls.some((c) => c.method === 'private/cancel_all_by_currency'), expectRun);
    if (!expectRun) assert.match(body(r), /did not confirm/);
    await mcp.close();
  }
});

test('deribit_call_write validates params before asking the user', async () => {
  const prompts = [];
  const { client, calls } = stubDeribit({ credentials: true });
  const mcp = await connect({ mode: 'local', deribit: client, elicit: (req) => { prompts.push(req); return { action: 'accept', content: { confirm: true } }; } });
  const r = await mcp.callTool({ name: 'deribit_call_write', arguments: { method: 'private/buy', params: { amount: 10 } } });
  assert.match(body(r), /missing required param 'instrument_name'/);
  assert.equal(prompts.length, 0);
  assert.equal(calls.length, 0);
  await mcp.close();
});

test('both protocol eras see the same tools over HTTP', async () => {
  for (const era of ['2026-07-28', 'legacy']) {
    const mcp = await connect({ mode: 'hosted', deribit: stubDeribit().client, era });
    const { tools } = await mcp.listTools();
    assert.equal(tools.length, 11, era);
    await mcp.close();
  }
});

test('CSV quotes commas, quotes and nested values', () => {
  const csv = toCsv([{ a: 'x,y', b: 'say "hi"', c: { d: 1 } }, { a: 1, e: null }]);
  assert.equal(csv, 'a,b,c,e\n"x,y","say ""hi""","{""d"":1}",\n1,,,');
});

test('deribit_call keeps non-tabular results as JSON', async () => {
  const { client } = stubDeribit({ routes: { 'public/get_index_price': () => ({ index_price: 1, estimated_delivery_price: 1 }) } });
  const mcp = await connect({ mode: 'hosted', deribit: client });
  const r = body(await mcp.callTool({ name: 'deribit_call', arguments: { method: 'public/get_index_price', params: { index_name: 'btc_usd' } } }));
  assert.deepEqual(r, { index_price: 1, estimated_delivery_price: 1 });
  await mcp.close();
});

test('volatility pages through DVOL and compares implied vs realised over their overlap only', async () => {
  const DAY = 86_400_000;
  const now = Date.now();
  const candle = (ts, v) => [ts, v, v, v, v];
  const pages = [
    { data: [candle(now - 1 * DAY, 50), candle(now - 2 * DAY, 50)], continuation: now - 2 * DAY },
    { data: [candle(now - 20 * DAY, 30), candle(now - 25 * DAY, 30)], continuation: null },
  ];
  const { client, calls } = stubDeribit({
    routes: {
      'public/get_volatility_index_data': () => pages.shift(),
      // realised only covers the last ~3 days here
      'public/get_historical_volatility': () => [[now - 3 * DAY, 40], [now - 1 * DAY, 44]],
    },
  });
  const mcp = await connect({ mode: 'hosted', deribit: client });
  const r = body(await mcp.callTool({ name: 'volatility', arguments: { currency: 'BTC', days: 30 } }));
  assert.equal(calls.filter((c) => c.method === 'public/get_volatility_index_data').length, 2, 'followed continuation');
  assert.equal(r.dvol.candles, 4);
  assert.equal(r.dvol.mean, 40); // all 4 candles
  assert.equal(r.overlap.dvol_mean, 50); // only the 2 candles inside realised coverage
  assert.equal(r.overlap.realised_mean, 42);
  assert.equal(r.overlap.spread, 8);
  await mcp.close();
});

// ---- vol_surface ----

test('surface maths: put-call parity forward and Black-76 deltas', () => {
  const { impliedForward, forwardDelta, parseOption } = surface;
  // Inverse: C - P = (F - K) / F. With F = 100000, K = 95000: C - P = 0.05
  const inverse = [{ strike: 95000, type: 'call', mark_price: 0.08 }, { strike: 95000, type: 'put', mark_price: 0.03 }];
  assert.ok(Math.abs(impliedForward(inverse, true, 99000) - 100000) < 1e-6);
  // Linear: C - P = F - K
  const linear = [{ strike: 100, type: 'call', mark_price: 7 }, { strike: 100, type: 'put', mark_price: 2 }];
  assert.equal(impliedForward(linear, false, 104), 105);
  // ATM-forward call delta ~ 0.5 + small vol term; put = call - 1
  const c = forwardDelta('call', 100, 100, 0.5, 0.25);
  assert.ok(c > 0.5 && c < 0.56);
  assert.ok(Math.abs(forwardDelta('put', 100, 100, 0.5, 0.25) - (c - 1)) < 1e-12);
  assert.deepEqual(parseOption('XRP_USDC-14OCT26-2d4-P'), { base: 'XRP', expiry: '14OCT26', strike: 2.4, type: 'put' });
});

test('vol_surface builds a term structure from one markprice snapshot', async () => {
  // Synthetic smile for one expiry ~30 days out: IV higher on the put wing.
  const d = new Date(Date.now() + 30 * 86_400_000);
  const label = `${d.getUTCDate()}${['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][d.getUTCMonth()]}${String(d.getUTCFullYear()).slice(2)}`;
  const marks = [];
  for (const k of [80000, 90000, 100000, 110000, 120000]) {
    const iv = 0.5 + (100000 - k) / 400000; // 0.55 at 80k ... 0.45 at 120k
    marks.push({ instrument_name: `BTC-${label}-${k}-C`, iv, mark_price: Math.max(0.0005, (100000 - k) / 100000 + 0.04) });
    marks.push({ instrument_name: `BTC-${label}-${k}-P`, iv, mark_price: Math.max(0.0005, (k - 100000) / 100000 + 0.04) });
  }
  const { client, calls } = stubDeribit({
    routes: { 'public/get_index_price': () => ({ index_price: 99900 }) },
    channels: { 'markprice.options.btc_usd': marks },
  });
  const mcp = await connect({ mode: 'hosted', deribit: client });
  const { meta, rows } = parseTable(await mcp.callTool({ name: 'vol_surface', arguments: { currency: 'BTC' } }));
  assert.equal(meta.index_name, 'btc_usd');
  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.equal(row.expiry, label);
  assert.ok(Math.abs(row.forward - 100000) < 1, `forward ${row.forward}`); // C - P = 0 at 100k
  assert.ok(Math.abs(row.atm_iv - 50) < 0.01, `atm ${row.atm_iv}`);
  assert.ok(row.rr25 < 0, 'put skew gives a negative risk reversal');
  assert.equal(calls.filter((c) => c.ws && c.method === 'public/subscribe').length, 1, 'one subscription for the whole surface');
  await mcp.close();
});
