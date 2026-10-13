#!/usr/bin/env node
/**
 * Carry: perpetual funding (window average, annualised) next to dated-future basis
 * (annualised) for BTC or ETH.
 *
 *   node funding_basis.mjs BTC [--days 7] [--json]
 */
import { args, print, run } from './_common.mjs';

const DAY = 86_400_000;
const r = (x, dp = 3) => (x === null || x === undefined ? x : Math.round(x * 10 ** dp) / 10 ** dp);
const { positional, flags } = args();
const base = (positional[0] ?? 'BTC').toUpperCase();
const days = Number(flags.days ?? 7);

await run(async (d) => {
  const now = Date.now();
  const indexName = `${base.toLowerCase()}_usd`;
  const [{ index_price: index }, futures] = await Promise.all([
    d.public.get_index_price({ index_name: indexName }),
    d.public.get_book_summary_by_currency({ currency: base, kind: 'future' }),
  ]);
  const perps = [`${base}-PERPETUAL`, `${base}_USDC-PERPETUAL`];
  const fundingRows = await Promise.all(perps.map(async (instrument_name) => {
    try {
      const history = await d.public.get_funding_rate_history({ instrument_name, start_timestamp: now - days * DAY, end_timestamp: now });
      const rates = history.map((h) => h.interest_8h).filter((v) => typeof v === 'number');
      const mean = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
      return { instrument: instrument_name, kind: 'perpetual', days_to_expiry: null, mark_price: null, basis_pct: null, annualised_pct: mean === null ? null : r(mean * 3 * 365 * 100), source: `funding, ${days}d mean` };
    } catch (error) {
      return { instrument: instrument_name, kind: 'perpetual', source: `unavailable: ${error.message}` };
    }
  }));
  const basisRows = futures
    .filter((f) => !f.instrument_name.endsWith('PERPETUAL'))
    .map((f) => {
      const expiry = Date.UTC(...(() => {
        const m = f.instrument_name.split('-')[1].match(/^(\d{1,2})([A-Z]{3})(\d{2})$/);
        return [2000 + Number(m[3]), ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'].indexOf(m[2]), Number(m[1]), 8];
      })());
      const dte = (expiry - now) / DAY;
      const basis = (f.mark_price - index) / index;
      return { instrument: f.instrument_name, kind: 'future', days_to_expiry: Math.round(dte * 10) / 10, mark_price: f.mark_price, basis_pct: r(basis * 100, 4), annualised_pct: dte > 0.5 ? r((basis * 365 / dte) * 100) : null, source: 'mark vs index' };
    })
    .sort((a, b) => a.days_to_expiry - b.days_to_expiry);
  print({ underlying: base, index_price: index, window_days: days }, [...fundingRows, ...basisRows], { json: flags.json });
});
