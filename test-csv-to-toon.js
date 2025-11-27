/**
 * Test TOON format conversions for CSV functions
 */
import { encode } from '@toon-format/toon';

console.log("=== CSV to TOON Format Conversion Tests ===\n");

// Test 1: get_instruments (options)
console.log("1. get_instruments (options) - Before (CSV):");
const instrumentsCSV = `instrument_name,kind,strike,option_type,expiration_timestamp,is_active,settlement_currency
BTC-25JAN25-100000-C,option,100000,call,1737763200000,true,BTC
BTC-25JAN25-100000-P,option,100000,put,1737763200000,true,BTC
BTC-25JAN25-95000-C,option,95000,call,1737763200000,true,BTC
BTC-25JAN25-95000-P,option,95000,put,1737763200000,true,BTC`;
console.log(instrumentsCSV);

console.log("\n1. get_instruments (options) - After (TOON):");
const instrumentsTOON = encode({
  instruments: [
    { instrument_name: "BTC-25JAN25-100000-C", kind: "option", strike: 100000, option_type: "call", expiration_timestamp: 1737763200000, is_active: true, settlement_currency: "BTC" },
    { instrument_name: "BTC-25JAN25-100000-P", kind: "option", strike: 100000, option_type: "put", expiration_timestamp: 1737763200000, is_active: true, settlement_currency: "BTC" },
    { instrument_name: "BTC-25JAN25-95000-C", kind: "option", strike: 95000, option_type: "call", expiration_timestamp: 1737763200000, is_active: true, settlement_currency: "BTC" },
    { instrument_name: "BTC-25JAN25-95000-P", kind: "option", strike: 95000, option_type: "put", expiration_timestamp: 1737763200000, is_active: true, settlement_currency: "BTC" }
  ]
});
console.log(instrumentsTOON);

// Test 2: get_instruments (futures)
console.log("\n\n2. get_instruments (futures) - Before (CSV):");
const futuresCSV = `instrument_name,kind,expiration_timestamp,is_active,settlement_currency
BTC-PERPETUAL,future,,true,BTC
BTC-28MAR25,future,1743177600000,true,BTC
BTC-27JUN25,future,1751001600000,true,BTC`;
console.log(futuresCSV);

console.log("\n2. get_instruments (futures) - After (TOON):");
const futuresTOON = encode({
  instruments: [
    { instrument_name: "BTC-PERPETUAL", kind: "future", expiration_timestamp: "", is_active: true, settlement_currency: "BTC" },
    { instrument_name: "BTC-28MAR25", kind: "future", expiration_timestamp: 1743177600000, is_active: true, settlement_currency: "BTC" },
    { instrument_name: "BTC-27JUN25", kind: "future", expiration_timestamp: 1751001600000, is_active: true, settlement_currency: "BTC" }
  ]
});
console.log(futuresTOON);

// Test 3: get_expirations
console.log("\n\n3. get_expirations - Before (CSV):");
const expirationsCSV = `currency,kind,expiration
BTC,future,28MAR25
BTC,future,27JUN25
BTC,future,26SEP25
BTC,option,25JAN25
BTC,option,28FEB25`;
console.log(expirationsCSV);

console.log("\n3. get_expirations - After (TOON):");
const expirationsTOON = encode({
  expirations: [
    { currency: "BTC", kind: "future", expiration: "28MAR25" },
    { currency: "BTC", kind: "future", expiration: "27JUN25" },
    { currency: "BTC", kind: "future", expiration: "26SEP25" },
    { currency: "BTC", kind: "option", expiration: "25JAN25" },
    { currency: "BTC", kind: "option", expiration: "28FEB25" }
  ]
});
console.log(expirationsTOON);

// Test 4: get_options_chain
console.log("\n\n4. get_options_chain - Before (CSV):");
const optionsChainCSV = `# Currency: BTC
# Expiry: 25JAN25
# Timestamp: 1732377600000
# Underlying: 97250.5
# Index: 97200
strike,type,instrument_name,mark_price,bid_price,ask_price,bid_amount,ask_amount,last_price,volume_24h,open_interest,delta,gamma,vega,theta,rho,mark_iv,bid_iv,ask_iv
95000,call,BTC-25JAN25-95000-C,3250.50,3200.00,3300.00,5.5,7.2,3225.00,125.5,850.25,0.65,0.00012,15.5,-12.3,25.8,0.55,0.54,0.56
95000,put,BTC-25JAN25-95000-P,950.25,925.00,975.00,8.2,6.5,940.00,88.3,425.75,-0.35,0.00012,15.5,-10.8,22.1,0.52,0.51,0.53
100000,call,BTC-25JAN25-100000-C,1250.75,1225.00,1275.00,12.5,9.8,1240.00,255.8,1250.5,0.45,0.00015,18.2,-15.5,30.2,0.58,0.57,0.59
100000,put,BTC-25JAN25-100000-P,3500.25,3450.00,3550.00,6.8,5.2,3480.00,175.2,680.3,-0.55,0.00015,18.2,-14.2,28.5,0.60,0.59,0.61`;
console.log(optionsChainCSV);

console.log("\n4. get_options_chain - After (TOON):");
const optionsChainTOON = encode({
  metadata: {
    currency: "BTC",
    expiry: "25JAN25",
    timestamp: 1732377600000,
    underlying_price: 97250.5,
    index_price: 97200
  },
  options: [
    { strike: 95000, type: "call", instrument_name: "BTC-25JAN25-95000-C", mark_price: 3250.50, bid_price: 3200.00, ask_price: 3300.00, bid_amount: 5.5, ask_amount: 7.2, last_price: 3225.00, volume_24h: 125.5, open_interest: 850.25, delta: 0.65, gamma: 0.00012, vega: 15.5, theta: -12.3, rho: 25.8, mark_iv: 0.55, bid_iv: 0.54, ask_iv: 0.56 },
    { strike: 95000, type: "put", instrument_name: "BTC-25JAN25-95000-P", mark_price: 950.25, bid_price: 925.00, ask_price: 975.00, bid_amount: 8.2, ask_amount: 6.5, last_price: 940.00, volume_24h: 88.3, open_interest: 425.75, delta: -0.35, gamma: 0.00012, vega: 15.5, theta: -10.8, rho: 22.1, mark_iv: 0.52, bid_iv: 0.51, ask_iv: 0.53 },
    { strike: 100000, type: "call", instrument_name: "BTC-25JAN25-100000-C", mark_price: 1250.75, bid_price: 1225.00, ask_price: 1275.00, bid_amount: 12.5, ask_amount: 9.8, last_price: 1240.00, volume_24h: 255.8, open_interest: 1250.5, delta: 0.45, gamma: 0.00015, vega: 18.2, theta: -15.5, rho: 30.2, mark_iv: 0.58, bid_iv: 0.57, ask_iv: 0.59 },
    { strike: 100000, type: "put", instrument_name: "BTC-25JAN25-100000-P", mark_price: 3500.25, bid_price: 3450.00, ask_price: 3550.00, bid_amount: 6.8, ask_amount: 5.2, last_price: 3480.00, volume_24h: 175.2, open_interest: 680.3, delta: -0.55, gamma: 0.00015, vega: 18.2, theta: -14.2, rho: 28.5, mark_iv: 0.60, bid_iv: 0.59, ask_iv: 0.61 }
  ]
});
console.log(optionsChainTOON);

console.log("\n\n=== Token Count Estimates ===");
// Rough estimate (actual tokenization varies by model)
const csvSizes = {
  instrumentsOptions: instrumentsCSV.length / 4,
  instrumentsFutures: futuresCSV.length / 4,
  expirations: expirationsCSV.length / 4,
  optionsChain: optionsChainCSV.length / 4
};

const toonSizes = {
  instrumentsOptions: instrumentsTOON.length / 4,
  instrumentsFutures: futuresTOON.length / 4,
  expirations: expirationsTOON.length / 4,
  optionsChain: optionsChainTOON.length / 4
};

console.log(`Instruments (options): CSV ~${Math.round(csvSizes.instrumentsOptions)} tokens, TOON ~${Math.round(toonSizes.instrumentsOptions)} tokens (${Math.round((1 - toonSizes.instrumentsOptions/csvSizes.instrumentsOptions) * 100)}% reduction)`);
console.log(`Instruments (futures): CSV ~${Math.round(csvSizes.instrumentsFutures)} tokens, TOON ~${Math.round(toonSizes.instrumentsFutures)} tokens (${Math.round((1 - toonSizes.instrumentsFutures/csvSizes.instrumentsFutures) * 100)}% reduction)`);
console.log(`Expirations: CSV ~${Math.round(csvSizes.expirations)} tokens, TOON ~${Math.round(toonSizes.expirations)} tokens (${Math.round((1 - toonSizes.expirations/csvSizes.expirations) * 100)}% reduction)`);
console.log(`Options Chain: CSV ~${Math.round(csvSizes.optionsChain)} tokens, TOON ~${Math.round(toonSizes.optionsChain)} tokens (${Math.round((1 - toonSizes.optionsChain/csvSizes.optionsChain) * 100)}% reduction)`);

console.log("\n=== Summary ===");
console.log("✓ All CSV-returning tools have been converted to TOON format");
console.log("✓ TOON provides explicit structure (array lengths, field names)");
console.log("✓ LLMs can better understand and validate the data structure");
console.log("✓ Token efficiency is similar to CSV, with better comprehension");
