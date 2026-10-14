# Deribit instruments, units and settlement

Read this when converting between USD and coin amounts, computing notional or P&L, or explaining contract specs. When in doubt, use the `instruments` tool (or `deribit_call` with `public/get_instruments`) for the currency and kind, and read `contract_size`, `min_trade_amount`, `tick_size` and `settlement_currency` directly — they are authoritative and change over time.

## Inverse vs linear

| | Inverse (`BTC-…`, `ETH-…`) | Linear (`…_USDC-…`) |
|---|---|---|
| Settlement / margin | The coin (BTC, ETH) | USDC |
| Futures & perp `amount`, `open_interest` | USD | Base coin |
| Futures & perp price | USD per coin | USDC per coin |
| Option price (`mark_price`, bids, asks) | Coin per option | USDC per option |
| Option `amount`, `open_interest` | Base coin | Base coin |
| Contract size | Perps/futures: 10 USD (BTC), 1 USD (ETH) — check `contract_size` | Base coin units — check `contract_size` |

Practical consequences:

- **USD value of an inverse option position** = `amount` × `mark_price` × `underlying_price`.
- **Coin exposure of an inverse perp position** = USD `amount` ÷ price. A short USD position in `BTC-PERPETUAL` is how people hedge coin holdings.
- Inverse P&L is non-linear in USD terms because both margin and payout are in the coin.

## Name formats

```
<UNDERLYING>[_<QUOTE>]-PERPETUAL                e.g. BTC-PERPETUAL, SOL_USDC-PERPETUAL
<UNDERLYING>[_<QUOTE>]-<EXPIRY>                 e.g. BTC-26DEC26, ETH_USDC-27MAR26
<UNDERLYING>[_<QUOTE>]-<EXPIRY>-<STRIKE>-<C|P>  e.g. BTC-27MAR26-100000-C, XRP_USDC-14OCT26-2d4-P
```

- `EXPIRY` is `D[D]MMMYY` uppercase with no leading zero: `9OCT26`, `27MAR26`. Options and futures expire at 08:00 UTC on that date.
- `STRIKE` uses `d` as the decimal point for fractional strikes: `9d6` = 9.6, `0d315` = 0.315.
- Combos and spreads have their own names; list them with `instruments` (`view: 'combos'`, or `kind: 'future_combo'` / `'option_combo'`).

## Index names

Lowercase `<coin>_<quote>`: `btc_usd`, `eth_usd`, `btc_usdc`, `sol_usdc`, `xrp_usdc`. Each instrument's `price_index` field gives the index it marks against. DVOL is available for `BTC` and `ETH` via the `volatility` tool.

## Ticker fields worth knowing

| Field | Meaning |
|---|---|
| `mark_price` | Fair price used for margin and P&L, not the last trade. |
| `index_price` | Spot index. |
| `underlying_price` (options) | Forward/underlying used for the IV calculation — the right reference for moneyness. |
| `mark_iv`, `bid_iv`, `ask_iv` | Annualised implied vol in percent. |
| `greeks.delta`, `gamma`, `vega`, `theta`, `rho` | Deribit's per-option greeks. Quote them as Deribit reports them; if you need a specific convention (e.g. USD vega per vol point), state the conversion you applied. |
| `current_funding`, `funding_8h` (perps) | Instantaneous rate, and projected rate for the current 8-hour window. |
| `estimated_delivery_price` | Expected settlement price for expiring instruments. |
| `state` | Order-book lifecycle state. `open` means normal trading; treat anything else as not tradable right now and say so. |

## Spot routed to Coinbase

Some spot instruments are matched on Coinbase Exchange. The `instruments` tool (from `get_instruments`) marks them with `is_cbe_routed: true` (the field is absent on all other instruments, so test for presence). Trade history and chart data are not available for them (error 11060), and tickers omit `volume_usd` and `volume_notional`. Derivatives are unaffected.
