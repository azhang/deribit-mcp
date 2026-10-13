// Manual smoke test against the real Workers runtime (catches Workers-only rules such as
// "no I/O across requests" that Node tests can't):
//   npm run dev   # in another terminal
//   npm run smoke:workerd
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const url = new URL(process.env.MCP_URL ?? 'http://127.0.0.1:8787/deribit/v2/mcp');
async function connect({ legacy = false } = {}) {
  // Default negotiation lands on the legacy lane, which streams SSE instead of JSON.
  const c = new Client({ name: 'smoke', version: '1' }, legacy ? {} : { versionNegotiation: { mode: { pin: '2026-07-28' } } });
  await c.connect(new StreamableHTTPClientTransport(url));
  return c;
}
let failed = 0;
async function call(c, label, name, args) {
  const t0 = Date.now();
  const r = await c.callTool({ name, arguments: args }).catch((e) => ({ isError: true, content: [{ text: e.message }] }));
  if (r.isError) failed += 1;
  console.log(`${r.isError ? 'FAIL' : 'ok  '} ${label.padEnd(18)} ${String(Date.now() - t0).padStart(5)} ms  ${r.content[0].text.slice(0, 100).replace(/\n/g, ' ')}`);
}

const tickers = { instrument_names: ['BTC-PERPETUAL', 'ETH-PERPETUAL'] };
const a = await connect();
await call(a, 'tickers #1', 'tickers', tickers);
await call(a, 'tickers #2', 'tickers', tickers); // second request reuses nothing from the first
const [b, c] = [await connect(), await connect()];
await Promise.all([
  call(a, 'parallel tickers', 'tickers', tickers),
  call(b, 'parallel chain', 'options_chain', { currency: 'BTC', min_strike: 75000, max_strike: 90000 }),
  call(c, 'parallel vol', 'volatility', { currency: 'BTC', days: 200, resolution: '1h' }),
]);
await call(a, 'vol_surface', 'vol_surface', { currency: 'BTC' });
const legacy = await connect({ legacy: true });
await call(legacy, 'legacy tickers', 'tickers', tickers);
await call(legacy, 'legacy vol_surface', 'vol_surface', { currency: 'ETH', view: 'smile' });
console.log(failed ? `${failed} failed` : 'all ok');
process.exit(failed ? 1 : 0);
