#!/usr/bin/env node
/**
 * Options chain with live greeks and IV (one WebSocket snapshot for all strikes).
 *
 *   node chain.mjs BTC                      nearest expiry
 *   node chain.mjs ETH 27MAR26 --min 2000 --max 3500
 *   node chain.mjs SOL 30OCT26              USDC-settled
 *   node chain.mjs BTC 27MAR26 --json
 */
import { args, print, run, optionMarket } from './_common.mjs';

const { positional, flags } = args();
if (!positional[0]) {
  console.error('usage: node chain.mjs <UNDERLYING> [EXPIRY] [--min K] [--max K] [--settlement USDC] [--json]');
  process.exit(2);
}

await run(async (d) => {
  const { base, inverse, currency } = optionMarket(positional[0], flags.settlement);
  const options = (await d.public.get_instruments({ currency, kind: 'option' })).filter((o) => o.base_currency === base);
  if (!options.length) throw new Error(`no ${base} options settled in ${currency}`);
  const label = (o) => o.instrument_name.split('-')[1];
  const expiries = [...new Map(options.map((o) => [label(o), o.expiration_timestamp])).entries()].sort((a, b) => a[1] - b[1]).map(([l]) => l);
  const expiry = (positional[1] ?? expiries[0]).toUpperCase();
  if (!expiries.includes(expiry)) throw new Error(`unknown expiry ${expiry}; available: ${expiries.join(', ')}`);

  const min = flags.min !== undefined ? Number(flags.min) : -Infinity;
  const max = flags.max !== undefined ? Number(flags.max) : Infinity;
  const selected = options.filter((o) => label(o) === expiry && o.strike >= min && o.strike <= max);
  const snap = await d.snapshot(selected.map((o) => `incremental_ticker.${o.instrument_name}`), { timeoutMs: 30_000 });

  const rows = selected.map((o) => {
    const t = snap[`incremental_ticker.${o.instrument_name}`] ?? {};
    return {
      strike: o.strike, type: o.option_type, instrument_name: o.instrument_name,
      mark_price: t.mark_price, mark_iv: t.mark_iv, bid_iv: t.bid_iv, ask_iv: t.ask_iv,
      bid: t.best_bid_price, ask: t.best_ask_price,
      delta: t.greeks?.delta, gamma: t.greeks?.gamma, vega: t.greeks?.vega, theta: t.greeks?.theta,
      open_interest: t.open_interest, volume_24h: t.stats?.volume,
    };
  }).sort((a, b) => a.strike - b.strike || a.type.localeCompare(b.type));
  const first = snap[`incremental_ticker.${selected[0]?.instrument_name}`] ?? {};
  print({
    underlying: base, settlement: inverse ? base : 'USDC', expiry, forward: first.underlying_price, index_price: first.index_price,
    units: { price: inverse ? base : 'USDC', iv: 'percent' },
  }, rows, { json: flags.json });
});
