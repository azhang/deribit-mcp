# Analysis recipes

Each recipe lists the tool calls in order and the conversions that matter. Compute timestamps (Unix ms) from the current time. State the data's timestamp in the answer — Deribit data is live and goes stale quickly.

## Contents

1. Vol smile and skew for one expiry
2. Term structure across expiries
3. Funding and basis comparison
4. Greeks aggregation across positions
5. DVOL vs realised volatility
6. Market overview of a currency

## 1. Vol smile and skew for one expiry

1. `get_expirations` (`currency`, `kind: "option"`) and pick the expiry.
2. `get_options_chain` with that expiry. Pass `min_strike`/`max_strike` around the forward (e.g. ±30–40% of `index_price`) to keep the output small.
3. Use the metadata's `underlying_price` as the forward. Moneyness = strike ÷ forward.
4. Build the smile from `mark_iv` per strike. Use OTM options (puts below the forward, calls above) — they are the liquid side and what the market quotes.
5. Skew measures:
   - **25-delta risk reversal** = IV(25Δ call) − IV(25Δ put). Find the strikes whose `delta` is closest to +0.25 and −0.25, and interpolate if needed. Negative means puts are bid.
   - **25-delta butterfly** = (IV(25Δ call) + IV(25Δ put)) / 2 − IV(ATM).
6. Flag strikes with no bid or a wide `bid_iv`/`ask_iv` spread. `mark_iv` there is model-driven, not traded.

For USDC-settled chains, filter rows by the `instrument_name` prefix so you only use one underlying.

## 2. Term structure across expiries

1. `get_expirations` and choose a spread of expiries (e.g. weekly, monthly, quarterly).
2. `get_options_chains` with those expiries in one call, narrowed by strike range.
3. For each expiry, take ATM IV: interpolate `mark_iv` at moneyness 1.0 using that expiry's `underlying_price`.
4. Compare with DVOL (recipe 5), which is a 30-day measure.
5. Backwardation (front IV above back IV) usually signals near-term event risk.

## 3. Funding and basis comparison

Perpetual funding:
1. `get_funding_rate_history` for each perp over the window (e.g. last 7 days). It gives hourly `interest_1h` and `interest_8h`.
2. Average funding per 8h × 3 × 365 = annualised rate. Report it as a percentage.
3. For right now, `get_tickers` on the perps gives `current_funding` and `funding_8h`.

Dated-future basis:
1. `get_book_summary_by_currency` (`kind: "future"`) or `get_tickers` on the futures, plus the index price.
2. Basis = (future `mark_price` − `index_price`) / `index_price`. Annualise by 365 ÷ days-to-expiry. Expiry is 08:00 UTC on the date in the name.
3. Compare the annualised basis curve with perp funding. That difference is the carry trade.

## 4. Greeks aggregation across positions (needs credentials)

1. `get_auth_status`, and say whether it's test or production.
2. Call `get_positions` for each currency. Every position has `delta`, and options also have `gamma`, `vega` and `theta`. `size` is in USD for futures and in the base coin for options. Futures also carry `size_currency`, their size in the base coin.
3. Check the greeks once before summing. The API docs don't say whether position greeks are already scaled by size. Compare one option position's `delta` with its ticker `greeks.delta` × `size` from `get_tickers`, then use whichever convention matches for every position.
4. Net delta per currency = option deltas + the futures and perp exposure in coin (`size_currency`). Sum `gamma`, `vega` and `theta` across options. Report per currency and name the units.
5. Point out concentrations, such as one expiry dominating vega or short gamma into an expiry.

## 5. DVOL vs realised volatility

1. `get_volatility_index_data` (`currency: "BTC"` or `"ETH"`, `resolution: "3600"` or `"1D"`, a window of e.g. 30–90 days). Rows are `[timestamp, open, high, low, close]`.
2. `get_historical_volatility` for the same currency. Rows are `[timestamp, realised vol %]`.
3. Variance risk premium ≈ DVOL − realised vol at matching dates. DVOL is forward-looking 30-day implied vol. Historical vol is backward-looking, so align their horizons before comparing.

## 6. Market overview of a currency

1. `get_index_price` for the spot level.
2. `get_book_summary_by_currency` for `kind: "future"` and `kind: "option"`. This gives volume, open interest and mark prices without greeks.
3. Summarise the most active instruments by `volume_usd` and the biggest open-interest strikes. Don't dump the whole table: the option summary can have hundreds of rows.
