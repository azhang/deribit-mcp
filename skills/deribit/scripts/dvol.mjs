#!/usr/bin/env node
/**
 * DVOL (30-day implied vol index) vs realised volatility, compared over the period both
 * cover (Deribit publishes about 16 days of realised vol).
 *
 *   node dvol.mjs BTC [--days 30] [--resolution 1h|12h|1D] [--series] [--json]
 */
import { args, print, run } from './_common.mjs';

const DAY = 86_400_000;
const r = (x, dp = 2) => (x === null || x === undefined ? x : Math.round(x * 10 ** dp) / 10 ** dp);
const { positional, flags } = args();
const currency = (positional[0] ?? 'BTC').toUpperCase();
const days = Number(flags.days ?? 30);
const resolution = { '1h': 3600, '12h': 43200, '1D': '1D' }[flags.resolution ?? '1D'];

await run(async (d) => {
  const end = Date.now();
  const start = end - days * DAY;
  const candles = new Map();
  for (let page = 0, pageEnd = end; page < 10 && pageEnd > start; page += 1) {
    const { data = [], continuation } = await d.public.get_volatility_index_data({ currency, start_timestamp: start, end_timestamp: pageEnd, resolution });
    for (const c of data) candles.set(c[0], c);
    if (!continuation || continuation >= pageEnd) break;
    pageEnd = continuation;
  }
  const dvol = [...candles.values()].sort((a, b) => a[0] - b[0]);
  const realised = (await d.public.get_historical_volatility({ currency })).filter(([ts]) => ts >= start).sort((a, b) => a[0] - b[0]);
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const from = realised[0]?.[0];
  const overlapDvol = mean(dvol.filter(([ts]) => ts >= from).map((c) => c[4]));
  const overlapRv = mean(realised.map((r) => r[1]));
  const meta = {
    currency, window_days: days,
    latest: { dvol: dvol.at(-1)?.[4], realised: r(realised.at(-1)?.[1]) },
    overlap: { from, dvol_mean: r(overlapDvol), realised_mean: r(overlapRv), spread: overlapDvol !== null && overlapRv !== null ? r(overlapDvol - overlapRv) : null },
  };
  if (!flags.series) {
    console.log(JSON.stringify(meta, null, 2));
    return;
  }
  let j = -1;
  const rows = dvol.map(([timestamp, , , , close]) => {
    while (j + 1 < realised.length && realised[j + 1][0] <= timestamp) j += 1;
    return { timestamp, dvol: close, realised: j >= 0 ? r(realised[j][1]) : undefined };
  });
  print(meta, rows, { json: flags.json });
});
