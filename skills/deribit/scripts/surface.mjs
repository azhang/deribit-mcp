#!/usr/bin/env node
/**
 * Implied-vol term structure (ATM IV, 25-delta RR/BF, forward) or a smile, from one
 * markprice.options snapshot.
 *
 *   node surface.mjs BTC                       term structure, all expiries
 *   node surface.mjs SOL                       USDC-settled underlyings work too
 *   node surface.mjs ETH --smile 27MAR26       per-strike smile for one expiry (OTM side)
 *   node surface.mjs BTC --smile --min 0.8 --max 1.2 [--all-strikes] [--json]
 *   node surface.mjs BTC --settlement USDC     linear BTC_USDC options instead of inverse
 */
import { buildSurface, termStructure, smile, sigfig } from './lib/deribit.mjs';
import { args, print, run, optionMarket } from './_common.mjs';

const { positional, flags } = args();
if (!positional[0]) {
  console.error('usage: node surface.mjs <UNDERLYING> [--smile [EXPIRY]] [--min M] [--max M] [--all-strikes] [--settlement USDC] [--json]');
  process.exit(2);
}

await run(async (d) => {
  const { base, inverse, indexName } = optionMarket(positional[0], flags.settlement);
  const channel = `markprice.options.${indexName}`;
  const [snap, index] = await Promise.all([d.snapshot([channel], { timeoutMs: 20_000 }), d.public.get_index_price({ index_name: indexName })]);
  if (!snap[channel]) throw new Error(`no option marks for ${indexName}`);

  const smileExpiry = typeof flags.smile === 'string' ? [flags.smile.toUpperCase()] : undefined;
  const { available, unknown, perExpiry } = buildSurface({ marks: snap[channel], base, inverse, indexPrice: index.index_price, expiries: smileExpiry });
  if (!available.length) throw new Error(`no live ${base} options on ${indexName}`);
  if (unknown.length) throw new Error(`unknown expiry ${unknown.join(', ')}; available: ${available.join(', ')}`);

  const meta = { underlying: base, index_name: indexName, index_price: index.index_price, timestamp: snap[channel][0]?.timestamp, units: { iv: 'percent' } };
  if (flags.smile) {
    const chosen = smileExpiry ? perExpiry : perExpiry.slice(0, 1);
    const rows = smile(chosen, { minMoneyness: Number(flags.min ?? 0.5), maxMoneyness: Number(flags.max ?? 2), otmOnly: !flags['all-strikes'] });
    print({ ...meta, forward_by_expiry: Object.fromEntries(chosen.map((e) => [e.expiry, sigfig(e.forward)])) }, rows, { json: flags.json });
  } else {
    print(meta, termStructure(perExpiry), { json: flags.json });
  }
});
