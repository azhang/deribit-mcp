/**
 * Options chain building and formatting utilities.
 */
import { encode } from '@toon-format/toon';

/**
 * Parse an options instrument name into components.
 *
 * @param {string} instrumentName - Instrument name like "ETH_USDC-9OCT25-4000-C"
 * @returns {Object|null} Dictionary with currency, expiry, strike, type, or null if not an option
 */
export function parseInstrumentName(instrumentName) {
  // Pattern: CURRENCY[-EXPIRY-STRIKE-TYPE]
  // Examples: BTC-27MAR20-8000-C, ETH_USDC-9OCT25-4000-P, AVAX_USDC-14OCT26-9d6-C
  // Fractional strikes use 'd' as the decimal separator (9d6 = 9.6)
  const pattern = /^([A-Z_]+)-(\d{1,2}[A-Z]{3}\d{2})-(\d+(?:[.d]\d+)?)-([CP])$/;
  const match = instrumentName.match(pattern);

  if (!match) {
    return null;
  }

  const [, currency, expiry, strike, optionType] = match;

  return {
    currency,
    expiry,
    strike: parseFloat(strike.replace('d', '.')),
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
 * Build TOON representation of options chain from ticker data.
 *
 * @param {Object} tickerData - Dictionary mapping instrument_name to ticker data
 * @param {string} currency - Currency symbol
 * @param {string} expiry - Expiry date
 * @param {number} [minStrike] - Optional minimum strike filter
 * @param {number} [maxStrike] - Optional maximum strike filter
 * @returns {string} TOON formatted string with metadata and options array
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

  // Build TOON-formatted options array
  const optionsList = [];

  // Sort strikes
  const sortedStrikes = Object.keys(strikesData)
    .map(parseFloat)
    .sort((a, b) => a - b);

  // Build options array
  for (const strike of sortedStrikes) {
    const strikeData = strikesData[strike];

    // Add call option
    const callData = strikeData.call;
    if (callData) {
      optionsList.push({
        strike,
        type: 'call',
        instrument_name: callData.instrumentName,
        mark_price: callData.markPrice,
        bid_price: callData.bidPrice,
        ask_price: callData.askPrice,
        bid_amount: callData.bidAmount,
        ask_amount: callData.askAmount,
        last_price: callData.lastPrice,
        volume_24h: callData.volume24h,
        open_interest: callData.openInterest,
        delta: callData.delta,
        gamma: callData.gamma,
        vega: callData.vega,
        theta: callData.theta,
        rho: callData.rho,
        mark_iv: callData.markIv,
        bid_iv: callData.bidIv,
        ask_iv: callData.askIv
      });
    }

    // Add put option
    const putData = strikeData.put;
    if (putData) {
      optionsList.push({
        strike,
        type: 'put',
        instrument_name: putData.instrumentName,
        mark_price: putData.markPrice,
        bid_price: putData.bidPrice,
        ask_price: putData.askPrice,
        bid_amount: putData.bidAmount,
        ask_amount: putData.askAmount,
        last_price: putData.lastPrice,
        volume_24h: putData.volume24h,
        open_interest: putData.openInterest,
        delta: putData.delta,
        gamma: putData.gamma,
        vega: putData.vega,
        theta: putData.theta,
        rho: putData.rho,
        mark_iv: putData.markIv,
        bid_iv: putData.bidIv,
        ask_iv: putData.askIv
      });
    }
  }

  // Return TOON format with metadata
  return encode({
    metadata: {
      currency,
      expiry,
      timestamp: timestamp || '',
      underlying_price: underlyingPrice || '',
      index_price: indexPrice || ''
    },
    options: optionsList
  });
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
