import { z } from 'zod';
import { ok, fail, limitList, pick, safe, table, tableOrSave, saveParam } from '../format.js';

const READ = { readOnlyHint: true, openWorldHint: true };
const FORMAT = z.enum(['csv', 'json']).default('csv').describe("'csv' (default, compact for long tables) or 'json'.");
const DAY_MS = 86_400_000;

const expiryOf = (name) => name.split('-')[1];
const settlementOf = (currency, base) => (currency === 'USDC' ? 'USDC' : base);

/** @param {import('@modelcontextprotocol/server').McpServer} server */
/**
 * @param {{ market?: { snapshot: Function }, save?: Function }} [deps] local extras: a live
 *   snapshot source (defaults to the client's one-shot snapshot) and a CSV saver.
 */
export function registerMarketTools(server, client, deps = {}) {
  const market = deps.market ?? client;
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
      format: FORMAT,
      ...saveParam(deps),
    }),
    annotations: { title: 'Options chain', ...READ },
  }, safe(async ({ currency, underlying, expiries, min_strike, max_strike, limit, format, save_to }) => {
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

    const snap = await market.snapshot(selected.map((o) => `incremental_ticker.${o.instrument_name}`), { timeoutMs: 20_000 });
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
    return tableOrSave(deps, save_to, {
      underlying: bases[0], currency, expiries: wanted, forward_by_expiry: forwards,
      index_price: first.index_price, timestamp: first.timestamp,
      units: { price: settlementOf(currency, bases[0]), iv: 'percent' },
    }, 'options', rows, format);
  }));

  server.registerTool('tickers', {
    title: 'Tickers',
    description: 'Live ticker (prices, mark, funding for perps, greeks/IV for options) for up to 100 instruments in one WebSocket snapshot.',
    inputSchema: z.object({
      instrument_names: z.array(z.string()).min(1).max(100).describe("e.g. ['BTC-PERPETUAL', 'ETH-27MAR26']"),
    }),
    annotations: { title: 'Tickers', ...READ },
  }, safe(async ({ instrument_names }) => {
    const snap = await market.snapshot(instrument_names.map((n) => `incremental_ticker.${n}`));
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
      format: FORMAT,
      ...saveParam(deps),
    }),
    annotations: { title: 'Market overview', ...READ },
  }, safe(async ({ currency, kind, sort_by, limit, format, save_to }) => {
    const rows = await client.public.get_book_summary_by_currency({ currency, kind });
    rows.sort((a, b) => (b[sort_by] ?? 0) - (a[sort_by] ?? 0));
    const { items, total, truncated } = limitList(rows, limit, 'Raise limit to see more.');
    return tableOrSave(deps, save_to, { currency, kind, sorted_by: sort_by, total, truncated }, 'instruments', items.map((r) => pick(r, [
      'instrument_name', 'mark_price', 'last', 'bid_price', 'ask_price', 'mid_price', 'price_change',
      'volume', 'volume_usd', 'open_interest', 'current_funding', 'funding_8h', 'estimated_delivery_price',
    ])), format);
  }));

  server.registerTool('funding', {
    title: 'Perpetual funding',
    description: 'Current and historical funding for a perpetual, with the window average annualised (8h rate x 3 x 365).',
    inputSchema: z.object({
      instrument_name: z.string().describe("A perpetual, e.g. 'BTC-PERPETUAL' or 'SOL_USDC-PERPETUAL'"),
      days: z.number().min(1).max(90).default(7),
      include_history: z.boolean().default(false).describe('Include the hourly rows (up to 24 x days).'),
      format: FORMAT,
      ...saveParam(deps),
    }),
    annotations: { title: 'Perpetual funding', ...READ },
  }, safe(async ({ instrument_name, days, include_history, format, save_to }) => {
    const end = Date.now();
    const [history, ticker] = await Promise.all([
      client.public.get_funding_rate_history({ instrument_name, start_timestamp: end - days * DAY_MS, end_timestamp: end }),
      client.public.ticker({ instrument_name }),
    ]);
    const rates = history.map((h) => h.interest_8h).filter((v) => typeof v === 'number');
    const mean8h = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
    const summary = {
      instrument_name, window_days: days,
      current: pick(ticker, ['current_funding', 'funding_8h', 'mark_price', 'index_price', 'timestamp']),
      window: { samples: rates.length, mean_8h: mean8h, annualised_pct: mean8h === null ? null : mean8h * 3 * 365 * 100 },
    };
    return include_history || save_to ? tableOrSave(deps, save_to, summary, 'history', history, format) : ok(summary);
  }));

  server.registerTool('volatility', {
    title: 'Implied vs realised volatility',
    description:
      "DVOL (Deribit's 30-day implied volatility index) alongside realised volatility for BTC or ETH. Values are in percent. " +
      'Deribit only publishes about the last 16 days of realised volatility, so the implied-vs-realised comparison covers the overlap.',
    inputSchema: z.object({
      currency: z.enum(['BTC', 'ETH']),
      days: z.number().min(1).max(365).default(30),
      resolution: z.enum(['1h', '12h', '1D']).default('1D'),
      include_series: z.boolean().default(false).describe('Include the DVOL candles, with the latest realised value at each timestamp.'),
      format: FORMAT,
      ...saveParam(deps),
    }),
    annotations: { title: 'Implied vs realised volatility', ...READ },
  }, safe(async ({ currency, days, resolution, include_series, format, save_to }) => {
    const end = Date.now();
    const start = end - days * DAY_MS;
    const res = { '1h': 3600, '12h': 43200, '1D': '1D' }[resolution];

    // DVOL returns at most 1000 candles per call, newest first, with `continuation`
    // as the end_timestamp for the next (older) page.
    const fetchDvol = async () => {
      const byTs = new Map();
      let pageEnd = end;
      for (let page = 0; page < 10 && pageEnd > start; page += 1) {
        const { data = [], continuation } = await client.public.get_volatility_index_data({
          currency, start_timestamp: start, end_timestamp: pageEnd, resolution: res,
        });
        for (const candle of data) byTs.set(candle[0], candle);
        if (!continuation || continuation >= pageEnd) break;
        pageEnd = continuation;
      }
      return [...byTs.values()].sort((a, b) => a[0] - b[0]);
    };
    const [candles, realisedAll] = await Promise.all([fetchDvol(), client.public.get_historical_volatility({ currency })]);
    const realised = realisedAll.filter(([ts]) => ts >= start).sort((a, b) => a[0] - b[0]);

    const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const realisedFrom = realised[0]?.[0];
    const overlap = realisedFrom === undefined ? [] : candles.filter(([ts]) => ts >= realisedFrom);
    const dvolLast = candles.at(-1)?.[4] ?? null;
    const rvLast = realised.at(-1)?.[1] ?? null;
    const summary = {
      currency, window_days: days, resolution,
      latest: { dvol: dvolLast, realised: rvLast, spread: dvolLast !== null && rvLast !== null ? dvolLast - rvLast : null },
      dvol: { candles: candles.length, mean: mean(candles.map((c) => c[4])), from: candles[0]?.[0], to: candles.at(-1)?.[0] },
      realised: { points: realised.length, from: realisedFrom, to: realised.at(-1)?.[0], note: 'Deribit publishes only about the last 16 days of realised volatility.' },
      // Like-for-like comparison over the period both series cover
      overlap: {
        dvol_mean: mean(overlap.map((c) => c[4])),
        realised_mean: mean(realised.map((r) => r[1])),
      },
    };
    if (summary.overlap.dvol_mean !== null && summary.overlap.realised_mean !== null) {
      summary.overlap.spread = summary.overlap.dvol_mean - summary.overlap.realised_mean;
    }
    if (!include_series && !save_to) return ok(summary);

    // One row per DVOL candle; realised is the latest value at or before that time (as-of join).
    let j = -1;
    const series = candles.map(([timestamp, open, high, low, close]) => {
      while (j + 1 < realised.length && realised[j + 1][0] <= timestamp) j += 1;
      return { timestamp, dvol_open: open, dvol_high: high, dvol_low: low, dvol_close: close, realised: j >= 0 ? realised[j][1] : undefined };
    });
    return tableOrSave(deps, save_to, summary, 'series', series, format);
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
      format: FORMAT,
      ...saveParam(deps),
    }),
    annotations: { title: 'Instruments, expiries and combos', ...READ },
  }, safe(async ({ view, currency, kind, underlying, expired, limit, format, save_to }) => {
    if (view === 'expirations') {
      if (kind && !['future', 'option'].includes(kind)) return fail("expirations supports kind 'future' or 'option'.");
      if (currency === 'EURR') return fail("expirations doesn't support EURR; use BTC, ETH, USDC, USDT or any.");
      return ok(await client.public.get_expirations({ currency, kind: kind ?? 'any' }));
    }
    if (view === 'combos') {
      const combos = await client.public.get_combos({ currency });
      const { items, total, truncated } = limitList(combos, limit, 'Raise limit to see more.');
      return tableOrSave(deps, save_to, { total, truncated }, 'combos', items, format);
    }
    let rows = await client.public.get_instruments({ currency, kind, expired });
    if (underlying) rows = rows.filter((r) => r.base_currency === underlying.toUpperCase());
    const { items, total, truncated } = limitList(rows, limit, 'Filter by kind or underlying, or raise limit.');
    return tableOrSave(deps, save_to, { total, truncated }, 'instruments', items.map((r) => pick(r, [
      'instrument_name', 'kind', 'base_currency', 'quote_currency', 'settlement_currency', 'expiration_timestamp',
      'strike', 'option_type', 'contract_size', 'tick_size', 'min_trade_amount', 'is_active', 'state', 'is_cbe_routed',
    ])), format);
  }));
}
