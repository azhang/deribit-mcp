#!/usr/bin/env node
/**
 * 25-delta risk reversal and butterfly per expiry, from live option snapshots.
 * The kind of multi-call analysis a skill script or an MCP "execute" tool would run:
 * several API calls in, a few lines of result out.
 *
 *   node examples/skew.mjs [BTC|ETH] [number of expiries]
 */
import { Deribit } from '../src/index.js';

const currency = (process.argv[2] ?? 'BTC').toUpperCase();
const count = Number(process.argv[3] ?? 4);
const d = new Deribit();

try {
  const instruments = await d.public.get_instruments({ currency, kind: 'option' });
  const byExpiry = Map.groupBy(instruments, (i) => i.expiration_timestamp);
  const expiries = [...byExpiry.keys()].sort((a, b) => a - b).slice(0, count);

  // One WebSocket snapshot for every option in the chosen expiries
  const names = expiries.flatMap((e) => byExpiry.get(e).map((i) => i.instrument_name));
  const snap = await d.snapshot(names.map((n) => `incremental_ticker.${n}`), { timeoutMs: 20_000 });
  const ticker = (name) => snap[`incremental_ticker.${name}`];

  const closest = (opts, target) =>
    opts.reduce((best, o) => (Math.abs(o.delta - target) < Math.abs(best.delta - target) ? o : best));

  console.log(`${currency} skew  (${new Date().toISOString()})`);
  console.log('expiry      ATM IV   25d RR   25d BF');
  for (const e of expiries) {
    const opts = byExpiry.get(e).map((i) => ({ ...i, t: ticker(i.instrument_name) }))
      .filter((o) => o.t?.greeks && o.t.mark_iv)
      .map((o) => ({ type: o.option_type, delta: o.t.greeks.delta, iv: o.t.mark_iv, strike: o.strike, fwd: o.t.underlying_price }));
    const calls = opts.filter((o) => o.type === 'call');
    const puts = opts.filter((o) => o.type === 'put');
    if (!calls.length || !puts.length) continue;
    const atm = closest(calls, 0.5).iv;
    const c25 = closest(calls, 0.25).iv;
    const p25 = closest(puts, -0.25).iv;
    const label = byExpiry.get(e)[0].instrument_name.split('-')[1].padEnd(10);
    console.log(`${label} ${atm.toFixed(1).padStart(6)}  ${(c25 - p25).toFixed(2).padStart(7)}  ${((c25 + p25) / 2 - atm).toFixed(2).padStart(7)}`);
  }
} finally {
  d.close();
}
