---
name: deribit
description: "Deribit crypto derivatives: options chains, IV surfaces and skew, greeks, futures, perps, funding, DVOL, order books, account tools. Use for any Deribit, BTC/ETH/SOL options or perps, or crypto vol question, or when calling a deribit tool."
---

# Deribit

Deribit's conventions differ from most venues: inverse contracts, coin-denominated option prices, USD-sized perps, `d` decimal strikes. Getting them wrong gives answers that look plausible but are off by a factor of the spot price. This skill covers picking the right tool, reading the units correctly, handling account tools safely, and running the bundled scripts when no MCP server is connected.

## MCP tools

The deribit MCP server (v2) has 11 tools on the hosted server and 14 on a local server with your own key.

| Question | Tool | Notes |
|---|---|---|
| Vol surface: ATM IV, skew (25-delta RR/BF), term structure, or a smile | `vol_surface` | One subscription covers every option of an underlying, so it's fast and cheap. No greeks or quotes. Start here for any volatility question. |
| Chain with greeks, quotes and open interest | `options_chain` | Pass `expiries` and a strike range. Defaults to the nearest expiry. Costs one channel per option. |
| Quotes for a few named instruments | `tickers` | Up to 100 in one call. |
| Depth | `order_books` | `depth` must be 1, 5, 10, 20, 50 or 100. |
| Most active instruments | `market_overview` | Ranked by 24h USD volume or open interest. |
| Perp funding | `funding` | Window average, annualised; `include_history` for hourly rows. |
| DVOL vs realised vol | `volatility` | Realised vol only covers about the last 16 days (Deribit's limit); the comparison uses the overlap. |
| Contract specs, valid expiries, combos | `instruments` | `view: 'expirations'` is the cheapest way to get valid expiry labels. |
| Anything else in the API | `deribit_search` → `deribit_describe` → `deribit_call` | Search by intent, check params, then call. All 186 methods are reachable, subject to policy. |
| Your account *(local only)* | `account` | `view`: summary, positions, open_orders, trades, order_history. |
| Cancel orders *(local only)* | `cancel_orders` | Asks the user to confirm. |
| Any other account change *(local only)* | `deribit_call_write` | Asks the user to confirm. Withdrawals, transfers and API-key methods are blocked by default. |

**Settlement currency.** For `options_chain` and `vol_surface`, `currency` is the settlement currency:
- `BTC` or `ETH` for the coin-settled books.
- `USDC` for linear options, and then you must pass `underlying` (e.g. `SOL`), because one USDC expiry lists several coins.

**Output.** Tables come back as CSV: a one-line JSON header (units, forwards, row count, truncation note), a blank line, then the CSV. Read the header before the rows. Pass `format: 'json'` only when you need nested data. A truncated list says "Showing N of M" and how to narrow it.

**Timestamps** are Unix milliseconds.

## Scripts (no MCP server needed)

`scripts/` runs anywhere with Node 22+ (or Deno or Bun) and has no installs: `scripts/lib/deribit.mjs` bundles the same client and analytics the MCP server uses, and `scripts/_common.mjs` holds their shared client setup, argument parsing and output. The scripts read public data only. Set `DERIBIT_CLIENT_ID` and `DERIBIT_CLIENT_SECRET` to authenticate calls for higher rate limits.

| Script | Does |
|---|---|
| `node scripts/surface.mjs BTC` | Term structure: ATM IV, RR25, BF25 and forward per expiry. Add `--smile [EXPIRY] --min 0.8 --max 1.2` for a smile. Works for SOL and other USDC underlyings. |
| `node scripts/chain.mjs ETH 27MAR26 --min 2000 --max 3500` | Chain with live greeks and IV. |
| `node scripts/funding_basis.mjs BTC --days 7` | Perp funding (annualised) next to each future's annualised basis. |
| `node scripts/dvol.mjs BTC --days 60 [--series]` | DVOL vs realised over their overlap. |

Output is the same JSON-header-plus-CSV format as the tools; add `--json` for JSON. Prefer a script when the user wants the data in a file or wants several steps combined, so intermediate data doesn't pass through the conversation. Node's built-in WebSocket ignores `HTTPS_PROXY`. Behind a proxy, `chain.mjs` and `surface.mjs` will fail to connect; that's an environment limit, not a data problem.

## Instrument names

- **Perpetuals:** `BTC-PERPETUAL` (inverse, coin-settled), `SOL_USDC-PERPETUAL` (linear).
- **Futures:** `BTC-26DEC26`. The expiry is the day without a leading zero, a 3-letter month and a 2-digit year (`9OCT26`). Expiry time is 08:00 UTC.
- **Options:** `BTC-27MAR26-100000-C`, `XRP_USDC-14OCT26-2d4-P`. A `d` in the strike is the decimal point, so `2d4` is 2.4.
- **Settlement:** the prefix before the first `-` gives it. `BTC-`/`ETH-` are inverse and settle in the coin; `_USDC` is linear and settles in USDC.

`references/instruments.md` has contract sizes and USD conversions.

## Units that trip people up

- **Inverse option prices are in coin.** A BTC option `mark_price` of `0.0215` is 0.0215 BTC. Multiply by the forward or index to get USD. USDC options are already in USDC.
- **IV is in percent** in every tool and script (`mark_iv: 51.3` means 51.3%). The raw `markprice.options` channel uses fractions; `vol_surface` converts them.
- **Inverse perp and future sizes are in USD**; contract sizes are BTC 10 USD and ETH 1 USD. Option and linear sizes are in the base coin.
- **Funding:** `current_funding` is the instantaneous rate and `funding_8h` the projected rate for the current 8-hour window. Annualise an 8-hour rate by multiplying by 3 × 365.
- **`vol_surface` estimates.** Its forward comes from put-call parity on marks, and its 25-delta numbers from Black-76 deltas on mark IV. Both are approximate; say so when precision matters, and use `options_chain` greeks for exact deltas.

## Known API behaviour

- **Coinbase-routed spot pairs:** trade history and charts return error 11060. For `get_last_trades_by_currency`, pass `kind: 'future'` or `'option'` rather than `'any'`.
- **Unknown or expired instruments** in `tickers`/`options_chain` are skipped and reported, not fatal.
- **Rate limits:** the hosted server authenticates with its own key and caps each client IP at 120 requests a minute. Batch with the plural tools.

## Local server extras

A local server (stdio) keeps market data live for the session. The first call to a chain, surface or ticker subscribes, and later calls answer from memory in milliseconds, so repeated or iterative questions are cheap there. Tabular tools there also take `save_to: 'path/name'`, which writes the full table to CSV and returns only a summary. Use it for large tables you'll analyse with a script rather than read.

## Account tools (local server with the user's key)

These touch a real account.
- **Environment:** say which environment the key is on (`environment` in every account result: `test` or `production`) before reporting balances or positions.
- **Confirmation:** writes always go through user confirmation.
  - On clients with confirmation forms, the user is asked directly.
  - Otherwise the tool refuses until you've shown the user the exact action, they've approved it in the conversation, and you call again with `confirm: true`. Never set `confirm: true` without that approval.
- **Blocked by default:** withdrawals, transfers and API-key management. Don't look for ways around the block. The user can enable a method with `DERIBIT_ALLOW`.
- **Keys:** suggest read-only keys (`account:read`, `trade:read`) unless the user needs to cancel or trade. Never echo secrets, and never ask the user to paste them into the chat. Local servers read keys from environment variables.

## Analysis recipes

`references/workflows.md` has recipes for skew and smile, term structure, funding vs basis, greeks aggregation across positions, DVOL vs realised, and a market overview. Each lists the tool or script to use and the conversions involved.
