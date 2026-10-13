# @deribit-mcp/client (prototype)

A Deribit JSON-RPC client generated from Deribit's published specs:

- [`deribit_openapi.json`](https://docs.deribit.com/specifications/deribit_openapi.json): 186 methods (48 public, 138 private)
- [`deribit_asyncapi.json`](https://docs.deribit.com/specifications/deribit_asyncapi.json): 43 subscription channels

Copies are kept in `spec/`, and `npm run check-spec` reports when the published versions change.

The package has no runtime dependencies. It uses the global `fetch` and `WebSocket`, so it runs on Node 22+, Cloudflare Workers, Deno and Bun.

## Use

```js
import { Deribit } from '@deribit-mcp/client';

const d = new Deribit();                                   // production, public only
const t = await d.public.ticker({ instrument_name: 'BTC-PERPETUAL' });
const same = await d.call('public/ticker', { instrument_name: 'BTC-PERPETUAL' });

// With credentials every call is authenticated (HTTP Basic auth, or public/auth on the
// WebSocket): private methods work, and public calls get per-user rather than per-IP rate limits
const acct = new Deribit({ clientId, clientSecret, env: 'test' });
await acct.private.get_positions({ currency: 'BTC' });

// One WebSocket round trip for many instruments; incremental_ticker changes
// are merged into the first snapshot
const snap = await d.snapshot(['incremental_ticker.BTC-PERPETUAL', 'incremental_ticker.ETH-PERPETUAL']);

// Streaming
const sub = await d.subscribe('ticker.BTC-PERPETUAL.100ms', (data) => console.log(data.mark_price));
await sub.unsubscribe();

d.close();
```

## What the specs give you

- **Types:** every method's params and result are typed. Unknown methods, missing or misspelled params, wrong types and invalid enum values fail at compile time (see `test/types.test-d.ts`).
- **Runtime validation:** params are checked against the spec before sending, and every problem is reported in one error. Callers that aren't TypeScript, such as LLM-written code or MCP tool arguments, get the same checks. Turn it off with `validate: false`.
- **Search:** `search('funding rate history')` ranks methods by name, params, tags and description. `search('ticker', { kind: 'channel' })` does the same for channels. This is the basis for an MCP search tool.
- **Drift check:** `npm run check-spec` compares the vendored specs with the published ones and lists added, removed or changed methods, params and channels. It exits with code 1 if anything changed. `-- --write` updates `spec/`, and `npm run generate` then rebuilds the generated files.

## Transports

`call()` sends the same JSON-RPC envelope over HTTP (`POST /api/v2`, the default) or over WebSocket (`transport: 'ws'`, per client or per call).

The WebSocket:
- opens lazily and shares one handshake between concurrent callers
- answers heartbeats
- re-authenticates and resubscribes after a reconnect
- fails in-flight requests immediately when the socket drops
- closes after `idleTimeoutMs` (60 s by default) with no requests or subscriptions

## Errors

| Class | When |
|---|---|
| `DeribitValidationError` | Params rejected against the spec. Nothing was sent. `.problems` lists each issue. |
| `DeribitError` | The API returned a JSON-RPC error. `.code` and `.data` (e.g. `{ param, reason }`) are set. |
| `DeribitTransportError` | Network failure, timeout, a non-JSON response or a dropped socket. |

## Scripts

| | |
|---|---|
| `npm run generate` | Rebuild `src/generated/` from `spec/` |
| `npm run check-spec` | Diff the vendored specs against docs.deribit.com |
| `npm run typecheck` | Type-level tests |
| `npm test` | Offline tests (stubbed fetch, fake WebSocket) |
| `npm run test:live` | Also runs live tests against production (public methods only) |

`examples/skew.mjs` shows a multi-call analysis: 25Δ risk reversal and butterfly per expiry from one WebSocket snapshot.
