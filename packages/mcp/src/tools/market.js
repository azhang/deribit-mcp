import { z } from 'zod';
import { ok, fail, limitList, pick, safe } from '../format.js';

const READ = { readOnlyHint: true, openWorldHint: true };
const DAY_MS = 86_400_000;

const expiryOf = (name) => name.split('-')[1];
const settlementOf = (currency, base) => (currency === 'USDC' ? 'USDC' : base);

/** @param {import('@modelcontextprotocol/server').McpServer} server */
export function registerMarketTools(server, client) {
  server.registerTool('options_chain', {
    title: 'Options chain',
    description:
      'Live options chain with greeks and IV for one or more expiries of one underlying, from a single WebSocket snapshot. ' +
      "currency is the settlement currency: 'BTC'/'ETH' for coin-settled options, 'USDC' for linear options (then pass underlying, e.g. 'SOL'). " +
      'Prices of BTC/ETH options are in the coin; IV is in percent. Defaults to the nearest expiry.',
    inputSchema: z.object({
      currency: z.enum(['BTC', 'ETH', 'USDC']),
      underlying: z.string().optional().describe("Underlying coin, e.g. 'SOL'. Required for USDC when several underlyings share an expiry."),
      expiries: z.array(z.string()).optional().describe("Expiry labels like '27MAR26'. Omit for the nearest expiry."),
      min_strike: z.number().optional(),
      max_strike: z.number().optional(),
      limit: z.number().int().min(1).max(1000).default(300).describe('Maximum number of options to fetch.'),
    }),
    annotations: { title: 'Options chain', ...READ },
  }, safe(async ({ currency, underlying, expiries, min_strike, max_strike, limit }) => {
    let options = await client.public.get_instruments({ currency, kind: 'option' });
    if (underlying) options = options.filter((o) => o.base_currency === underlying.toUpperCase());
    const bases = [...new Set(options.map((o) => o.base_currency))].sort();
    if (bases.length === 0) return fail(`No ${currency}${underlying ? ` ${underlying}` : ''} options found.`);
    if (bases.length > 1) return fail(`${currency} options cover several underlyings (${bases.join(', ')}). Pass underlying to pick one.`);

    const byExpiry = new Map();
    for (const o of options) {
      const label = expiryOf(o.instrument_name);
      if (!byExpiry.has(label)) byExpiry.set(label, { ts: o.expiration_timestamp, items: [] });
      byExpiry.get(label).items.push(o);
    }
    const available = [...byExpiry.entries()].sort((a, b) => a[1].ts - b[1].ts).map(([label]) => label);
    const wanted = expiries?.length ? expiries.map((e) => e.toUpperCase()) : available.slice(0, 1);
    const unknown = wanted.filter((e) => !byExpiry.has(e));
    if (unknown.length) return fail(`Unknown expiries ${unknown.join(', ')}. Available: ${available.slice(0, 20).join(', ')}${available.length > 20 ? ', …' : ''}`);

    const selected = wanted.flatMap((e) => byExpiry.get(e).items)
      .filter((o) => (min_strike === undefined || o.strike >= min_strike) && (max_strike === undefined || o.strike <= max_strike));
    if (selected.length === 0) return fail('No options match that strike range.');
    if (selected.length > limit) {
      return fail(`${selected.length} options match (limit ${limit}). Narrow with min_strike/max_strike or fewer expiries, or raise limit.`);
    }

    const snap = await client.snapshot(selected.map((o) => `incremental_ticker.${o.instrument_name}`), { timeoutMs: 20_000 });
    const forwards = {};
    const rows = selected.map((o) => {
      const t = snap[`incremental_ticker.${o.instrument_name}`] ?? {};
      const expiry = expiryOf(o.instrument_name);
      forwards[expiry] ??= t.underlying_price;
      return {
        instrument_name: o.instrument_name, expiry, strike: o.strike, type: o.option_type,
        mark_price: t.mark_price, mark_iv: t.mark_iv, bid_iv: t.bid_iv, ask_iv: t.ask_iv,
        bid: t.best_bid_price, ask: t.best_ask_price, bid_amount: t.best_bid_amount, ask_amount: t.best_ask_amount,
        ...pick(t.greeks, ['delta', 'gamma', 'vega', 'theta']),
        open_interest: t.open_interest, volume_24h: t.stats?.volume,
      };
    }).sort((a, b) => byExpiry.get(a.expiry).ts - byExpiry.get(b.expiry).ts || a.strike - b.strike || a.type.localeCompare(b.type));

    const first = snap[`incremental_ticker.${selected[0].instrument_name}`] ?? {};
    return ok({
      underlying: bases[0], currency, expiries: wanted, forward_by_expiry: forwards,
      index_price: first.index_price, timestamp: first.timestamp,
      units: { price: settlementOf(currency, bases[0]), iv: 'percent' },
      options: rows,
    });
  }));

  server.registerTool('tickers', {
    title: 'Tickers',
    description: 'Live ticker (prices, mark, funding for perps, greeks/IV for options) for up to 100 instruments in one WebSocket snapshot.',
    inputSchema: z.object({
      instrument_names: z.array(z.string()).min(1).max(100).describe("e.g. ['BTC-PERPETUAL', 'ETH-27MAR26']"),
    }),
    annotations: { title: 'Tickers', ...READ },
  }, safe(async ({ instrument_names }) => {
    const snap = await client.snapshot(instrument_names.map((n) => `incremental_ticker.${n}`));
    return ok(Object.fromEntries(instrument_names.map((n) => {
      const { type, ...data } = snap[`incremental_ticker.${n}`] ?? {};
      return [n, data];
    })));
  }));

  server.registerTool('order_books', {
    title: 'Order books',
    description: 'Order book depth for up to 20 instruments.',
    inputSchema: z.object({
      instrument_names: z.array(z.string()).min(1).max(20),
      depth: z.union([z.literal(1), z.literal(5), z.literal(10), z.literal(20), z.literal(50), z.literal(100)]).default(10),
    }),
    annotations: { title: 'Order books', ...READ },
  }, safe(async ({ instrument_names, depth }) => {
    const entries = await Promise.all(instrument_names.map(async (instrument_name) => {
      try {
        const b = await client.public.get_order_book({ instrument_name, depth });
        return [instrument_name, pick(b, ['timestamp', 'state', 'mark_price', 'index_price', 'best_bid_price', 'best_ask_price', 'bids', 'asks'])];
      } catch (error) {
        return [instrument_name, { error: error.message }];
      }
    }));
    return ok(Object.fromEntries(entries));
  }));

  server.registerTool('market_overview', {
    title: 'Market overview',
    description: 'Most active instruments of a currency and kind, ranked by 24h USD volume or open interest (no greeks; use options_chain for those).',
    inputSchema: z.object({
      currency: z.enum(['BTC', 'ETH', 'USDC', 'USDT', 'EURR']),
      kind: z.enum(['future', 'option', 'spot', 'future_combo', 'option_combo']),
      sort_by: z.enum(['volume_usd', 'open_interest']).default('volume_usd'),
      limit: z.number().int().min(1).max(200).default(20),
    }),
    annotations: { title: 'Market overview', ...READ },
  }, safe(async ({ currency, kind, sort_by, limit }) => {
    const rows = await client.public.get_book_summary_by_currency({ currency, kind });
    rows.sort((a, b) => (b[sort_by] ?? 0) - (a[sort_by] ?? 0));
    const { items, total, truncated } = limitList(rows, limit, 'Raise limit to see more.');
    return ok({
      currency, kind, sorted_by: sort_by, total, truncated,
      instruments: items.map((r) => pick(r, [
        'instrument_name', 'mark_price', 'last', 'bid_price', 'ask_price', 'mid_price', 'price_change',
        'volume', 'volume_usd', 'open_interest', 'current_funding', 'funding_8h', 'estimated_delivery_price',
      ])),
    });
  }));

  server.registerTool('funding', {
    title: 'Perpetual funding',
    description: 'Current and historical funding for a perpetual, with the window average annualised (8h rate x 3 x 365).',
    inputSchema: z.object({
      instrument_name: z.string().describe("A perpetual, e.g. 'BTC-PERPETUAL' or 'SOL_USDC-PERPETUAL'"),
      days: z.number().min(1).max(90).default(7),
      include_history: z.boolean().default(false).describe('Include the hourly rows (up to 24 x days).'),
    }),
    annotations: { title: 'Perpetual funding', ...READ },
  }, safe(async ({ instrument_name, days, include_history }) => {
    const end = Date.now();
    const [history, ticker] = await Promise.all([
      client.public.get_funding_rate_history({ instrument_name, start_timestamp: end - days * DAY_MS, end_timestamp: end }),
      client.public.ticker({ instrument_name }),
    ]);
    const rates = history.map((h) => h.interest_8h).filter((v) => typeof v === 'number');
    const mean8h = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
    return ok({
      instrument_name, window_days: days,
      current: pick(ticker, ['current_funding', 'funding_8h', 'mark_price', 'index_price', 'timestamp']),
      window: { samples: rates.length, mean_8h: mean8h, annualised_pct: mean8h === null ? null : mean8h * 3 * 365 * 100 },
      ...(include_history ? { history } : {}),
    });
  }));

  server.registerTool('volatility', {
    title: 'Implied vs realised volatility',
    description: "DVOL (Deribit's 30-day implied volatility index) alongside realised volatility for BTC or ETH, with a summary of the window. Values are in percent.",
    inputSchema: z.object({
      currency: z.enum(['BTC', 'ETH']),
      days: z.number().min(1).max(365).default(30),
      resolution: z.enum(['1h', '12h', '1D']).default('1D'),
      include_series: z.boolean().default(false).describe('Include the DVOL candles and realised series.'),
    }),
    annotations: { title: 'Implied vs realised volatility', ...READ },
  }, safe(async ({ currency, days, resolution, include_series }) => {
    const end = Date.now();
    const res = { '1h': 3600, '12h': 43200, '1D': '1D' }[resolution];
    const [dvol, realised] = await Promise.all([
      client.public.get_volatility_index_data({ currency, start_timestamp: end - days * DAY_MS, end_timestamp: end, resolution: res }),
      client.public.get_historical_volatility({ currency }),
    ]);
    const candles = dvol.data ?? [];
    const rv = realised.filter(([ts]) => ts >= end - days * DAY_MS);
    const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const dvolLast = candles.at(-1)?.[4] ?? null;
    const rvLast = rv.at(-1)?.[1] ?? null;
    return ok({
      currency, window_days: days,
      latest: { dvol: dvolLast, realised: rvLast, spread: dvolLast !== null && rvLast !== null ? dvolLast - rvLast : null },
      window_mean: { dvol: mean(candles.map((c) => c[4])), realised: mean(rv.map((r) => r[1])) },
      ...(include_series ? { dvol_candles: { columns: ['timestamp', 'open', 'high', 'low', 'close'], rows: candles }, realised: rv } : {}),
    });
  }));

  server.registerTool('instruments', {
    title: 'Instruments, expiries and combos',
    description: "List instruments (contract specs), expiries, or combos. view='expirations' is the cheapest way to find valid expiry labels.",
    inputSchema: z.object({
      view: z.enum(['instruments', 'expirations', 'combos']).default('instruments'),
      currency: z.enum(['BTC', 'ETH', 'USDC', 'USDT', 'EURR', 'any']),
      kind: z.enum(['future', 'option', 'spot', 'future_combo', 'option_combo']).optional(),
      underlying: z.string().optional().describe("Filter by base coin, e.g. 'SOL'"),
      expired: z.boolean().default(false),
      limit: z.number().int().min(1).max(1000).default(100),
    }),
    annotations: { title: 'Instruments, expiries and combos', ...READ },
  }, safe(async ({ view, currency, kind, underlying, expired, limit }) => {
    if (view === 'expirations') {
      if (kind && !['future', 'option'].includes(kind)) return fail("expirations supports kind 'future' or 'option'.");
      return ok(await client.public.get_expirations({ currency, kind: kind ?? 'any' }));
    }
    if (view === 'combos') {
      const combos = await client.public.get_combos({ currency });
      const { items, total, truncated } = limitList(combos, limit, 'Raise limit to see more.');
      return ok({ total, truncated, combos: items });
    }
    let rows = await client.public.get_instruments({ currency, kind, expired });
    if (underlying) rows = rows.filter((r) => r.base_currency === underlying.toUpperCase());
    const { items, total, truncated } = limitList(rows, limit, 'Filter by kind or underlying, or raise limit.');
    return ok({
      total, truncated,
      instruments: items.map((r) => pick(r, [
        'instrument_name', 'kind', 'base_currency', 'quote_currency', 'settlement_currency', 'expiration_timestamp',
        'strike', 'option_type', 'contract_size', 'tick_size', 'min_trade_amount', 'is_active', 'state', 'is_cbe_routed',
      ])),
    });
  }));
}
