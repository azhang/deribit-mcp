// Shared helpers for the skill scripts. Public data only; set DERIBIT_CLIENT_ID /
// DERIBIT_CLIENT_SECRET to authenticate calls for higher rate limits.
import { Deribit, toCsv } from './lib/deribit.mjs';

export function client() {
  return new Deribit({
    env: process.env.DERIBIT_ENV === 'test' ? 'test' : 'production',
    clientId: process.env.DERIBIT_CLIENT_ID || null,
    clientSecret: process.env.DERIBIT_CLIENT_SECRET || null,
    idleTimeoutMs: 0,
  });
}

/** Minimal flag parser: positional args plus --name value / --flag. */
export function args(argv = process.argv.slice(2)) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      const name = argv[i].slice(2);
      const next = argv[i + 1];
      flags[name] = next !== undefined && !next.startsWith('--') ? argv[(i += 1)] : true;
    } else {
      positional.push(argv[i]);
    }
  }
  return { positional, flags };
}

/** Print a JSON metadata line, a blank line, then CSV (or JSON with --json). */
export function print(meta, rows, { json = false } = {}) {
  if (json) console.log(JSON.stringify({ ...meta, rows }, null, 2));
  else console.log(`${JSON.stringify({ ...meta, rows: rows.length })}\n\n${toCsv(rows)}`);
}

/** Run main(), always closing the client and exiting non-zero on errors. */
export async function run(main) {
  const d = client();
  try {
    await main(d);
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  } finally {
    d.close();
  }
}

/** Coin- vs USDC-settled index for an underlying: BTC/ETH options are inverse on *_usd. */
export function optionMarket(underlying, settlement) {
  const base = underlying.toUpperCase();
  const inverse = settlement ? settlement.toUpperCase() !== 'USDC' : ['BTC', 'ETH'].includes(base);
  return { base, inverse, currency: inverse ? base : 'USDC', indexName: `${base.toLowerCase()}_${inverse ? 'usd' : 'usdc'}` };
}
