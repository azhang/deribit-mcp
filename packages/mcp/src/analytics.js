/**
 * Pure option analytics shared by the vol_surface tool and the skill's scripts
 * (bundled into plugins/deribit/skills/deribit/scripts/lib). No I/O.
 */

export const YEAR_MS = 365 * 86_400_000;
export const round = (x, dp) => (x === null || x === undefined ? x : Math.round(x * 10 ** dp) / 10 ** dp);
/** Round to `sig` significant digits (forwards span 0.3 to 100k). */
export const sigfig = (x, sig = 6) => (x ? Number(x.toPrecision(sig)) : x);

/** Parse "BTC-27MAR26-100000-C" / "XRP_USDC-14OCT26-2d4-P". */
export function parseOption(name) {
  const m = name.match(/^([A-Z0-9]+)(?:_([A-Z]+))?-(\d{1,2}[A-Z]{3}\d{2})-(\d+(?:[.d]\d+)?)-([CP])$/);
  if (!m) return null;
  return { base: m[1], expiry: m[3], strike: Number(m[4].replace('d', '.')), type: m[5] === 'C' ? 'call' : 'put' };
}

/** Expiry label to its 08:00 UTC timestamp. */
export function expiryTime(label) {
  const m = label.match(/^(\d{1,2})([A-Z]{3})(\d{2})$/);
  const month = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'].indexOf(m[2]);
  return Date.UTC(2000 + Number(m[3]), month, Number(m[1]), 8);
}

// Standard normal CDF (Abramowitz & Stegun 7.1.26 via erf), accurate to ~1e-7.
export function normCdf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** Black-76 forward delta (no discounting): call N(d1), put N(d1) - 1. */
export function forwardDelta(type, forward, strike, iv, years) {
  const d1 = (Math.log(forward / strike) + (iv * iv * years) / 2) / (iv * Math.sqrt(years));
  return type === 'call' ? normCdf(d1) : normCdf(d1) - 1;
}

/** Linear interpolation of y at x over points sorted by x; null outside the range. */
export function interpolate(points, x) {
  for (let i = 1; i < points.length; i += 1) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    if (x >= x0 && x <= x1) return x1 === x0 ? y0 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return null;
}

/**
 * Forward from put-call parity at the strike where both legs are priced, nearest the index.
 * Inverse (coin-quoted) options: C - P = (F - K) / F  =>  F = K / (1 - (C - P)).
 * Linear (USDC-quoted) options:  C - P = F - K        =>  F = K + (C - P).
 * Discounting is ignored (Deribit marks are close to undiscounted for these tenors).
 */
export function impliedForward(rows, inverse, index) {
  const byStrike = new Map();
  for (const r of rows) {
    if (!byStrike.has(r.strike)) byStrike.set(r.strike, {});
    byStrike.get(r.strike)[r.type] = r.mark_price;
  }
  const pairs = [...byStrike.entries()].filter(([, v]) => v.call !== undefined && v.put !== undefined);
  if (!pairs.length) return index;
  const [strike, { call, put }] = pairs.reduce((best, p) => (Math.abs(p[0] - index) < Math.abs(best[0] - index) ? p : best));
  const forward = inverse ? strike / (1 - (call - put)) : strike + (call - put);
  return Number.isFinite(forward) && forward > 0 ? forward : index;
}

/**
 * Group markprice.options marks by expiry and derive forward, deltas and the OTM smile.
 *
 * @param {{ marks: Array<{instrument_name: string, iv: number, mark_price: number}>, base: string,
 *           inverse: boolean, indexPrice: number, now?: number, expiries?: string[] }} input
 *   `iv` as Deribit sends it on markprice.options (a fraction); converted to percent here.
 * @returns {{ available: string[], unknown: string[], perExpiry: Array<object> }}
 */
export function buildSurface({ marks, base, inverse, indexPrice, now = Date.now(), expiries }) {
  const byExpiry = new Map();
  for (const m of marks) {
    const o = parseOption(m.instrument_name);
    if (!o || o.base !== base || !(m.iv > 0)) continue;
    if (!byExpiry.has(o.expiry)) byExpiry.set(o.expiry, []);
    byExpiry.get(o.expiry).push({ ...o, iv: m.iv * 100, mark_price: m.mark_price });
  }
  const available = [...byExpiry.keys()].sort((a, b) => expiryTime(a) - expiryTime(b));
  const wanted = expiries ?? available;
  const unknown = wanted.filter((e) => !byExpiry.has(e));
  const perExpiry = wanted.filter((e) => byExpiry.has(e)).map((expiry) => {
    const rows = byExpiry.get(expiry).sort((a, b) => a.strike - b.strike);
    const years = Math.max((expiryTime(expiry) - now) / YEAR_MS, 1 / (365 * 24));
    const forward = impliedForward(rows, inverse, indexPrice);
    const side = (type) => rows.filter((r) => r.type === type).map((r) => ({ ...r, delta: forwardDelta(type, forward, r.strike, r.iv / 100, years) }));
    const calls = side('call');
    const puts = side('put');
    const otm = [...puts.filter((r) => r.strike < forward), ...calls.filter((r) => r.strike >= forward)];
    return { expiry, years, forward, rows, calls, puts, otm };
  });
  return { available, unknown, perExpiry };
}

/** Per expiry: ATM IV, 25-delta call/put IV, risk reversal and butterfly (IV in percent). */
export function termStructure(perExpiry) {
  return perExpiry.map(({ expiry, years, forward, calls, puts, otm }) => {
    // ATM IV: interpolate the OTM smile at strike = forward
    const atm = interpolate(otm.map((r) => [r.strike, r.iv]).sort((a, b) => a[0] - b[0]), forward);
    // 25-delta IVs: interpolate IV against delta on each wing
    const ivAtDelta = (legs, target) => interpolate(legs.map((r) => [r.delta, r.iv]).sort((a, b) => a[0] - b[0]), target);
    const c25 = ivAtDelta(calls, 0.25);
    const p25 = ivAtDelta(puts, -0.25);
    return {
      expiry, days: round(years * 365, 1), forward: sigfig(forward),
      atm_iv: round(atm, 2),
      rr25: c25 !== null && p25 !== null ? round(c25 - p25, 2) : null,
      bf25: c25 !== null && p25 !== null && atm !== null ? round((c25 + p25) / 2 - atm, 2) : null,
      call25_iv: round(c25, 2), put25_iv: round(p25, 2),
      strikes: calls.length,
    };
  });
}

/** Per-strike smile rows within a moneyness band (OTM side only by default). */
export function smile(perExpiry, { minMoneyness = 0.5, maxMoneyness = 2, otmOnly = true } = {}) {
  return perExpiry.flatMap(({ expiry, forward, rows, otm }) => (otmOnly ? otm : rows)
    .map((r) => ({ expiry, strike: r.strike, type: r.type, moneyness: round(r.strike / forward, 4), iv: round(r.iv, 2), mark_price: r.mark_price }))
    .filter((r) => r.moneyness >= minMoneyness && r.moneyness <= maxMoneyness)
    .sort((a, b) => a.strike - b.strike));
}
