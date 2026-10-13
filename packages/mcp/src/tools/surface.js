import { z } from 'zod';
import { fail, safe, table } from '../format.js';
import { buildSurface, termStructure, smile, sigfig } from '../analytics.js';

/** @param {import('@modelcontextprotocol/server').McpServer} server */
export function registerSurfaceTool(server, client) {
  server.registerTool('vol_surface', {
    title: 'Volatility surface',
    description:
      'Implied volatility for every listed option of one underlying, from a single markprice.options snapshot (much cheaper than options_chain). ' +
      "view 'term_structure' (default): per expiry ATM IV, approximate 25-delta risk reversal and butterfly, and the implied forward. " +
      "view 'smile': per-strike IV for the chosen expiries. No greeks or quotes; use options_chain for those. IV is in percent.",
    inputSchema: z.object({
      currency: z.enum(['BTC', 'ETH', 'USDC']).describe("Settlement currency: 'BTC'/'ETH' for coin-settled options, 'USDC' for linear options (then pass underlying)."),
      underlying: z.string().optional().describe("Underlying coin for USDC options, e.g. 'SOL'."),
      view: z.enum(['term_structure', 'smile']).default('term_structure'),
      expiries: z.array(z.string()).optional().describe("Expiry labels like '27MAR26'. Default: all for term_structure, nearest for smile."),
      min_moneyness: z.number().positive().default(0.5).describe('Smile: lowest strike / forward to include.'),
      max_moneyness: z.number().positive().default(2).describe('Smile: highest strike / forward to include.'),
      otm_only: z.boolean().default(true).describe('Smile: only out-of-the-money options (puts below the forward, calls above), the liquid side.'),
      format: z.enum(['csv', 'json']).default('csv'),
    }),
    annotations: { title: 'Volatility surface', readOnlyHint: true, openWorldHint: true },
  }, safe(async ({ currency, underlying, view, expiries, min_moneyness, max_moneyness, otm_only, format }) => {
    const inverse = currency !== 'USDC';
    const base = inverse ? currency : underlying?.toUpperCase();
    if (!base) return fail("USDC options need underlying, e.g. 'SOL'.");
    const indexName = inverse ? `${base.toLowerCase()}_usd` : `${base.toLowerCase()}_usdc`;
    const channel = `markprice.options.${indexName}`;

    const [snap, index] = await Promise.all([
      client.snapshot([channel], { timeoutMs: 15_000 }),
      client.public.get_index_price({ index_name: indexName }),
    ]);
    if (!snap[channel]) return fail(`No option marks for ${indexName}; check currency/underlying.`);
    const wantedLabels = expiries?.length ? expiries.map((e) => e.toUpperCase()) : undefined;
    const { available, unknown, perExpiry: all } = buildSurface({
      marks: snap[channel], base, inverse, indexPrice: index.index_price, expiries: wantedLabels,
    });
    if (!available.length) return fail(`No live ${base} options found on ${indexName}.`);
    if (unknown.length) return fail(`Unknown expiries ${unknown.join(', ')}. Available: ${available.join(', ')}`);
    const perExpiry = view === 'smile' && !wantedLabels ? all.slice(0, 1) : all;

    const meta = {
      underlying: base, index_name: indexName, index_price: index.index_price,
      timestamp: snap[channel][0]?.timestamp,
      units: { iv: 'percent', mark_price: inverse ? base : 'USDC' },
      notes: 'Forward from put-call parity on marks; 25-delta strikes from Black-76 forward deltas computed on mark IV (approximate).',
    };

    if (view === 'smile') {
      const forwards = Object.fromEntries(perExpiry.map((e) => [e.expiry, sigfig(e.forward)]));
      const rows = smile(perExpiry, { minMoneyness: min_moneyness, maxMoneyness: max_moneyness, otmOnly: otm_only });
      return table({ ...meta, forward_by_expiry: forwards }, 'smile', rows, format);
    }
    return table(meta, 'term_structure', termStructure(perExpiry), format);
  }));
}

