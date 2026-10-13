# Deribit MCP server v2

An MCP server for Deribit built on [`deribit-client-js`](https://github.com/azhang/deribit-client-js). The client is generated from Deribit's published OpenAPI and AsyncAPI specs, so every one of the 186 API methods is reachable and parameters are checked against the spec. Design: [`docs/design/v2.md`](../../docs/design/v2.md).

It serves MCP spec 2026-07-28 and earlier clients, from a single server factory.

## Two ways to run it

| | Hosted (Cloudflare Worker) | Local (stdio) |
|---|---|---|
| Data | Public market data | Market data and **your account** |
| Deribit key | Server-wide read-only key, used only for rate limits | Yours, from the environment |
| Tools | 11 | 14 |

### Local

```bash
DERIBIT_CLIENT_ID=… DERIBIT_CLIENT_SECRET=… DERIBIT_ENV=test node src/stdio.js
```

Claude Code, or any client config that runs a command:

```json
{
  "mcpServers": {
    "deribit": {
      "command": "node",
      "args": ["/path/to/packages/mcp/src/stdio.js"],
      "env": { "DERIBIT_CLIENT_ID": "…", "DERIBIT_CLIENT_SECRET": "…", "DERIBIT_ENV": "production" }
    }
  }
}
```

Without a key it serves the same public tools as the hosted server. Logs go to stderr; stdout carries only MCP messages.

To run it somewhere without this repo and its `node_modules`, build one self-contained file and copy that instead:

```bash
npm install && npm run build:stdio   # writes bundle/deribit-mcp.mjs (about 1.7 MB, not checked in)
```

It runs with plain `node bundle/deribit-mcp.mjs` on Node 22+ and takes the same environment variables. Setup for Hermes: [`skills/README.md`](../../skills/README.md#hermes).

The local server can do three things the hosted one can't:

| Variable | Default | Effect |
|---|---|---|
| `DERIBIT_LIVE_TTL` | `15` | **Live data.** Market subscriptions stay open after first use, so repeat calls answer from memory, kept current by the stream. A channel is dropped after this many minutes without a request, and the socket closes once none are left. Everything also ends when the session's process exits. Measured: tickers 2.2 s cold → 5–6 ms warm; `vol_surface` and `options_chain` about 150 ms warm (the rest is uncached HTTP lookups). `0` turns it off and every call takes a fresh one-shot snapshot. |
| `DERIBIT_OUTPUT_DIR` | `./deribit-data` | **`save_to`.** Tabular tools write the full table to a CSV file under this folder and return the path, row count and a 5-row preview. Paths that are absolute or leave the folder are refused. |
| `HTTPS_PROXY` | | **Proxy.** Used for both HTTP and WebSocket. Node's built-ins ignore it, so the server routes both through `undici`. |

### Hosted

```bash
npx wrangler secret put DERIBIT_CLIENT_ID      # read-only key, for rate limits only
npx wrangler secret put DERIBIT_CLIENT_SECRET
npm run dev                                     # http://localhost:8787/deribit/v2/mcp
```

- **Authentication:** every upstream call is authenticated with the server key. Deribit then applies per-user rate limits instead of per-IP ones, which Workers would share with other customers.
- **No private tools:** they're never registered, so the key's account is never exposed.
- **Per-IP limit:** a Cloudflare rate-limit binding caps each client IP at 120 requests per minute, so one caller can't use up the shared key.

## Tools

| Tool | What it does |
|---|---|
| `vol_surface` | Implied-vol surface for one underlying from a single `markprice.options` message (about 0.3 s when warm): term structure (ATM IV, approximate 25-delta risk reversal and butterfly, implied forward) or per-strike smiles. No greeks. |
| `options_chain` | Live chain with greeks and IV for one underlying and one or more expiries (one WebSocket snapshot). For USDC options pass `underlying`. |
| `tickers` | Live tickers for up to 100 instruments. |
| `order_books` | Depth for up to 20 instruments. |
| `market_overview` | Most active instruments by 24h USD volume or open interest. |
| `funding` | Current funding plus the window average, annualised. |
| `volatility` | DVOL vs realised volatility. |
| `instruments` | Contract specs, expiries or combos. |
| `deribit_search` / `deribit_describe` / `deribit_call` | Find, inspect and call any allowed read method. |
| `account` *(local)* | Balances, positions, open orders, fills, order history. |
| `cancel_orders` *(local)* | Cancel by currency, instrument or label, or cancel everything. |
| `deribit_call_write` *(local)* | Any other state-changing private method. |

Tabular results (chains, overviews, instrument lists, trade and funding history, account lists) come back as **CSV**: a one-line JSON header with metadata (units, forwards, truncation), a blank line, then the table. Pass `format: 'json'` to get JSON instead. On live data CSV is 59–68% smaller. Other results are JSON. Lists are capped, and a capped result says "Showing N of M" with a hint on how to narrow it.

## Safety model

Every Deribit method has a class, generated from the spec and checked in at `src/generated/method-classes.json` (`npm run classify`; a test fails if it's stale):

| Class | Count | Hosted | Local |
|---|---|---|---|
| public | 38 | ✓ | ✓ |
| private_read | 62 | — | ✓ |
| private_write | 70 | — | confirmed |
| blocked | 16 | — | — |

Blocked covers session plumbing and deprecated methods.

**Confirmation for writes.** The write tools are annotated as destructive.
- **Clients with confirmation forms:** the server asks the human through elicitation, and a `confirm: true` supplied by the model does not skip the form.
- **Clients without them:** the call is refused until the model has the user's approval and calls again with `confirm: true`.

**Funds-moving methods** (withdrawals, transfers, address book, API keys) are blocked in local mode by default, even with confirmation. Two environment variables adjust this, each taking comma-separated method globs:
- `DERIBIT_ALLOW` re-enables blocked methods, e.g. `private/withdraw`.
- `DERIBIT_DENY` blocks more.

## Development

```bash
npm install
npm test         # in-process MCP client against the real HTTP handler (both protocol eras),
                 # plus stdio tests that spawn the real entry point
npm run build    # wrangler dry-run bundle
npm run classify # after updating the client's spec
```
