/**
 * Options chain building and formatting utilities.
 */

/**
 * Parse an options instrument name into components.
 *
 * @param {string} instrumentName - Instrument name like "ETH_USDC-9OCT25-4000-C"
 * @returns {Object|null} Dictionary with currency, expiry, strike, type, or null if not an option
 */
export function parseInstrumentName(instrumentName) {
  // Pattern: CURRENCY[-EXPIRY-STRIKE-TYPE]
  // Examples: BTC-27MAR20-8000-C, ETH_USDC-9OCT25-4000-P
  const pattern = /^([A-Z_]+)-(\d{1,2}[A-Z]{3}\d{2})-(\d+(?:\.\d+)?)-([CP])$/;
  const match = instrumentName.match(pattern);

  if (!match) {
    return null;
  }

  const [, currency, expiry, strike, optionType] = match;

  return {
    currency,
    expiry,
    strike: parseFloat(strike),
    type: optionType === 'C' ? 'call' : 'put',
    instrumentName
  };
}

/**
 * Filter instruments list to only options matching the expiry.
 *
 * @param {Array<Object>} instruments - List of instrument dictionaries from get_instruments
 * @param {string} expiry - Expiry date string like "9OCT25"
 * @returns {Array<string>} List of instrument names matching the expiry
 */
export function filterInstrumentsByExpiry(instruments, expiry) {
  const matching = [];

  for (const instrument of instruments) {
    const name = instrument.instrument_name || '';
    const parsed = parseInstrumentName(name);

    if (parsed && parsed.expiry.toUpperCase() === expiry.toUpperCase()) {
      matching.push(name);
    }
  }

  return matching;
}

/**
 * Build CSV representation of options chain from ticker data.
 *
 * @param {Object} tickerData - Dictionary mapping instrument_name to ticker data
 * @param {string} currency - Currency symbol
 * @param {string} expiry - Expiry date
 * @param {number} [minStrike] - Optional minimum strike filter
 * @param {number} [maxStrike] - Optional maximum strike filter
 * @returns {string} CSV formatted string with header comments
 */
export function buildOptionsChainCSV(tickerData, currency, expiry, minStrike = null, maxStrike = null) {
  // Group by strike
  const strikesData = {};

  // Extract metadata from first ticker
  let underlyingPrice = null;
  let indexPrice = null;
  let timestamp = null;

  for (const [instrumentName, data] of Object.entries(tickerData)) {
    const parsed = parseInstrumentName(instrumentName);
    if (!parsed) {
      continue;
    }

    const strike = parsed.strike;

    // Apply strike filters
    if (minStrike !== null && strike < minStrike) {
      continue;
    }
    if (maxStrike !== null && strike > maxStrike) {
      continue;
    }

    // Extract metadata
    if (underlyingPrice === null) {
      underlyingPrice = data.underlying_price;
      indexPrice = data.index_price;
      timestamp = data.timestamp;
    }

    // Initialize strike entry if needed
    if (!strikesData[strike]) {
      strikesData[strike] = { call: null, put: null };
    }

    // Store data by type
    const optionType = parsed.type;
    const stats = data.stats || {};
    const greeks = data.greeks || {};

    strikesData[strike][optionType] = {
      instrumentName,
      markPrice: data.mark_price,
      bidPrice: data.best_bid_price,
      askPrice: data.best_ask_price,
      bidAmount: data.best_bid_amount,
      askAmount: data.best_ask_amount,
      lastPrice: data.last_price,
      volume24h: stats.volume || 0.0,
      openInterest: data.open_interest,
      delta: greeks.delta,
      gamma: greeks.gamma,
      vega: greeks.vega,
      theta: greeks.theta,
      rho: greeks.rho,
      markIv: data.mark_iv,
      bidIv: data.bid_iv,
      askIv: data.ask_iv
    };
  }

  // Build CSV
  const lines = [];

  // Header comments
  lines.push(`# Currency: ${currency}`);
  lines.push(`# Expiry: ${expiry}`);
  if (timestamp !== null) {
    lines.push(`# Timestamp: ${timestamp}`);
  }
  if (underlyingPrice !== null) {
    lines.push(`# Underlying: ${underlyingPrice}`);
  }
  if (indexPrice !== null) {
    lines.push(`# Index: ${indexPrice}`);
  }

  // CSV header
  const headerFields = [
    'strike',
    'type',
    'instrument_name',
    'mark_price',
    'bid_price',
    'ask_price',
    'bid_amount',
    'ask_amount',
    'last_price',
    'volume_24h',
    'open_interest',
    'delta',
    'gamma',
    'vega',
    'theta',
    'rho',
    'mark_iv',
    'bid_iv',
    'ask_iv'
  ];
  lines.push(headerFields.join(','));

  // Sort strikes
  const sortedStrikes = Object.keys(strikesData)
    .map(parseFloat)
    .sort((a, b) => a - b);

  // Build rows
  for (const strike of sortedStrikes) {
    const strikeData = strikesData[strike];

    // Add call row
    const callData = strikeData.call;
    if (callData) {
      lines.push(formatCSVRow(strike, 'call', callData));
    }

    // Add put row
    const putData = strikeData.put;
    if (putData) {
      lines.push(formatCSVRow(strike, 'put', putData));
    }
  }

  return lines.join('\n');
}

/**
 * Format a single CSV row.
 *
 * @param {number} strike - Strike price
 * @param {string} optionType - "call" or "put"
 * @param {Object} data - Option data dictionary
 * @returns {string} CSV formatted row
 */
function formatCSVRow(strike, optionType, data) {
  /**
   * Format a value for CSV.
   * @param {any} value
   * @returns {string}
   */
  function fmt(value) {
    if (value === null || value === undefined) {
      return '';
    }
    if (typeof value === 'number') {
      return value.toFixed(6).replace(/\.?0+$/, '');
    }
    return String(value);
  }

  const fields = [
    fmt(strike),
    optionType,
    fmt(data.instrumentName),
    fmt(data.markPrice),
    fmt(data.bidPrice),
    fmt(data.askPrice),
    fmt(data.bidAmount),
    fmt(data.askAmount),
    fmt(data.lastPrice),
    fmt(data.volume24h),
    fmt(data.openInterest),
    fmt(data.delta),
    fmt(data.gamma),
    fmt(data.vega),
    fmt(data.theta),
    fmt(data.rho),
    fmt(data.markIv),
    fmt(data.bidIv),
    fmt(data.askIv)
  ];

  return fields.join(',');
}
