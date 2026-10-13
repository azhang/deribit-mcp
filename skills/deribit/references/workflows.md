# Analysis recipes

Each recipe gives the MCP tools to use, the script that does the same without MCP, and the conversions that matter. State the data's timestamp in the answer, because Deribit data is live and goes stale quickly.

## Contents

1. Skew and smile
2. Term structure
3. Funding vs basis (carry)
4. Greeks aggregation across positions
5. DVOL vs realised volatility
6. Market overview

## 1. Skew and smile

**Fast path:** `vol_surface` (term structure view) gives per-expiry `rr25` (risk reversal) and `bf25` (butterfly). Negative RR means puts are bid over calls. For the shape of one expiry, use `vol_surface` with `view: 'smile'` and `expiries: ['27MAR26']`, which returns OTM IV by strike and moneyness.
Script: `node scripts/surface.mjs BTC --smile 27MAR26 --min 0.8 --max 1.2`.

**When you need traded quotes or exact greeks:** use `options_chain` for that expiry with a strike range around the forward (e.g. ±30% of the header's `forward_by_expiry`).
- Flag strikes with no bid or a wide `bid_iv`/`ask_iv` spread: their `mark_iv` comes from Deribit's model, not from trades.
- RR25 from the chain: IV of the call whose `delta` is nearest +0.25, minus IV of the put nearest −0.25. Interpolate if they straddle 0.25.

For USDC-settled underlyings, pass `currency: 'USDC'` and `underlying: 'SOL'` (or whichever coin).

## 2. Term structure

`vol_surface` (default view) returns, per expiry, `days`, `forward`, `atm_iv`, `rr25` and `bf25` in one call.
Script: `node scripts/surface.mjs ETH`.
- **Backwardation** (front ATM above back) usually means near-term event risk.
- **Forward over index** shows the basis curve implied by the options.
- **Compare with DVOL** (recipe 5), which is a 30-day measure; it should sit between the expiries either side of 30 days.

## 3. Funding vs basis (carry)

Script: `node scripts/funding_basis.mjs BTC --days 7` gives both in one table.
With tools:
1. **Perps:** `funding` for each perp (`BTC-PERPETUAL`, `BTC_USDC-PERPETUAL`). `window.annualised_pct` is the window mean of the 8-hour rate × 3 × 365.
2. **Futures:** `market_overview` with `kind: 'future'`, plus the index from `tickers`. Basis = (mark − index) / index. Annualise with × 365 / days-to-expiry; expiry is 08:00 UTC on the date in the name.
3. **The carry trade** is the difference between the annualised basis curve and perp funding. Name the window used for funding.

## 4. Greeks aggregation across positions (local server with the user's key)

1. `account` with `view: 'positions'` for each currency. Say whether it's test or production (`environment` in the header).
2. **Scaling:** every position has `delta`, and options also have `gamma`, `vega` and `theta`. `size` is in USD for futures and in the base coin for options; futures also carry `size_currency` in coin. The docs don't say whether position greeks are already scaled by size. Check once: compare one option's position `delta` with its ticker `greeks.delta` (`tickers`) × `size`, then apply that convention to every position.
3. **Totals:** net delta per currency = option deltas + futures and perp exposure in coin (`size_currency`). Sum gamma, vega and theta across options. Report per currency and name the units.
4. **Concentrations:** point them out, e.g. one expiry dominating vega, or short gamma into an expiry.

## 5. DVOL vs realised volatility

`volatility` (or `node scripts/dvol.mjs BTC --days 60`):
- **`latest`:** today's DVOL vs realised.
- **`overlap`:** the like-for-like comparison. Deribit publishes only about the last 16 days of realised vol, so means over longer windows can't be compared directly.
- DVOL above realised is the usual state (variance risk premium). DVOL below realised is notable.

## 6. Market overview

1. `market_overview` with `kind: 'future'` and with `kind: 'option'`, sorted by `volume_usd` or `open_interest`. Start with a small `limit` (10–20) rather than pulling everything.
2. Add `vol_surface` for the vol picture and `funding` for the main perp.
3. Summarise rather than reproduce tables.
