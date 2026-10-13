---
name: deribit
description: How to use the Deribit MCP server's tools correctly for crypto derivatives questions — options chains, implied volatility, greeks, futures and perpetuals, funding rates, DVOL, order books, and (with credentials) account positions and orders. Use this whenever the user asks about Deribit, BTC/ETH/SOL options or perps, crypto implied volatility, vol smiles or term structure, funding or basis, or anything that will call deribit-mcp tools (get_options_chain, get_ticker, get_funding_rate_history, get_positions, cancel_all_orders, ...), even if they don't name Deribit explicitly.
---

# Deribit

The deribit-mcp server exposes Deribit's JSON-RPC API as MCP tools. This skill covers how to pick the right tool, read Deribit's naming and units correctly, and handle account tools safely. Deribit's conventions differ from most venues (inverse contracts, coin-denominated option prices, USD-sized perps), and getting them wrong gives answers that look plausible but are off by a factor of the spot price.

## Picking a tool

| Question | Tool | Notes |
|---|---|---|
| Full options chain with greeks and IV for one or more expiries | `get_options_chain` / `get_options_chains` | Uses a WebSocket snapshot, so prices are live. Narrow with `min_strike`/`max_strike` — a full BTC chain is hundreds of rows. |
| Which expiries exist | `get_expirations` | Call this before `get_options_chain` instead of guessing a date. |
| Quote for a few named instruments | `get_ticker` (one) / `get_tickers` (several) | `get_tickers` is one WebSocket round trip; prefer it over looping `get_ticker`. |
| Cheap overview of every instrument of a kind (no greeks) | `get_book_summary_by_currency` | Good for scanning volume, OI and mark prices across all futures or options. |
| Depth | `get_order_book` / `get_order_books` | `depth` must be 1, 5, 10, 20, 50, 100, 1000 or 10000. |
| Instrument list / contract specs | `get_instruments` | `currency: "any"` returns thousands of rows; always pass a currency and `kind`. |
| Spot / index level | `get_index_price` / `get_index_prices` | Index names are lowercase pairs: `btc_usd`, `eth_usd`, `sol_usdc`. |
| Perp funding over a window | `get_funding_rate_history` (hourly rows) or `get_funding_rate` (one accumulated number) | Both need `start_timestamp` and `end_timestamp` in milliseconds. |
| DVOL (Deribit's implied-vol index) | `get_volatility_index_data` | `resolution` is in **seconds**: `"60"`, `"3600"` (hourly), `"43200"`, `"1D"`. |
| Realised volatility | `get_historical_volatility` | Returns `[timestamp, vol%]` pairs. |
| OHLCV candles | `get_tradingview_chart_data` | `resolution` is in **minutes** here (`"1"` … `"720"`, `"1D"`) — the opposite of DVOL. |
| Recent prints | `get_last_trades` | `count` up to 1000; `sorting: "desc"` for newest first. |
| Delivery/settlement history | `get_delivery_prices` | |
| Combos (spreads, strategies) | `get_combos` | |

Account tools (`get_account_summary`, `get_positions`, `get_open_orders`, `get_order_history`, `get_user_trades`, `get_subaccounts`, `cancel_all_orders`) only work when the server has credentials. Check `get_auth_status` first if unsure, and see "Account tools" below.

All timestamps are Unix **milliseconds**. Compute them from the current time rather than guessing.

## Instrument names

- Perpetuals: `BTC-PERPETUAL`, `ETH-PERPETUAL` (inverse, coin-settled); `BTC_USDC-PERPETUAL`, `SOL_USDC-PERPETUAL` (linear, USDC-settled).
- Futures: `BTC-26DEC26`. Expiry format is day without leading zero + 3-letter month + 2-digit year, uppercase: `9OCT26`, `27MAR26`.
- Options: `BTC-27MAR26-100000-C`, `ETH_USDC-9OCT26-4000-P`. Fractional strikes use `d` as the decimal point: `AVAX_USDC-14OCT26-9d6-C` is strike 9.6.
- The part before the first `-` tells you the settlement: `BTC`/`ETH` options are inverse and settle in the coin; anything with `_USDC` is linear and settles in USDC.

For `get_options_chain`, `currency` is the **settlement** currency: `BTC` or `ETH` for the inverse books, `USDC` for every linear book (SOL, XRP, AVAX, and the linear BTC/ETH books). A USDC chain for an expiry can therefore contain several underlyings — check the `instrument_name` prefix before treating rows as one smile.

Read `references/instruments.md` for contract sizes, units and settlement details when you need to convert between USD and coin amounts or compute notional.

## Units that trip people up

- **Inverse option prices are in coin, not USD.** A BTC option `mark_price` of `0.0215` means 0.0215 BTC. Multiply by `underlying_price` (or `index_price`) for USD. USDC options are already in USDC.
- **IV fields are percentages**: `mark_iv: 51.3` means 51.3% annualised.
- **Inverse perp/future sizes are USD**: `open_interest` and order `amount` on `BTC-PERPETUAL` are USD (contract size 10 USD). For options and linear futures they are in the base coin.
- **Funding**: `current_funding` is the instantaneous rate; `funding_8h` is the projected rate for the current 8-hour window. History rows give `interest_1h` and `interest_8h`. Annualise an 8h rate by multiplying by 3 × 365.

## Known API behaviour

- Some spot pairs are matched on Coinbase Exchange. For those, `get_last_trades` and `get_tradingview_chart_data` return error 11060 (`not_supported_for_coinbase_routed_spot`). Use the order book or ticker instead.
- Tool output is TOON, a compact tabular text format: a header line like `options[42]{strike,type,...}:` followed by one comma-separated row per item. Read it like CSV.
- Rate limits: the server shares IPs on Cloudflare, so unauthenticated bursts can hit 429. Batch with the plural tools rather than many single calls.

## Account tools

These touch a real account. Treat them accordingly:

- Before anything that changes state (currently `cancel_all_orders`), say exactly what will happen — which currency, kind and order type, and that it cannot be undone — and get the user's explicit go-ahead in this conversation. A filter by `kind` or `type` requires `currency`; without one the server refuses rather than cancelling everything.
- Say which environment the credentials point at (`get_auth_status` reports `test` or `production`) before reporting balances or positions, so test-net numbers are never mistaken for real ones.
- Suggest read-only API keys (`account:read`, `trade:read`) unless the user actually needs to cancel orders.
- Never echo API secrets back, and don't ask the user to paste them into the chat if the deployment has a better way to configure credentials (environment variables for local stdio setups).

## Analysis recipes

For multi-step analyses — vol smile and skew, term structure, funding/basis comparison, greeks aggregation across positions, DVOL vs realised vol — read `references/workflows.md`. It lists the tool sequence and the conversions for each.
