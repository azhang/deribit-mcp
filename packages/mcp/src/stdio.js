#!/usr/bin/env node
/**
 * Local server over stdio with your own Deribit key:
 *
 *   DERIBIT_CLIENT_ID=… DERIBIT_CLIENT_SECRET=… [DERIBIT_ENV=test] npx deribit-mcp
 *
 * Local-only extras (the hosted server can't do these):
 *   DERIBIT_LIVE_TTL     minutes a market-data subscription stays open after its last use,
 *                        so repeat calls answer from memory (default 15; 0 = one-shot snapshots)
 *   DERIBIT_OUTPUT_DIR   where `save_to` writes CSV files (default ./deribit-data)
 *   HTTPS_PROXY          honoured for both HTTP and WebSocket connections
 *   DERIBIT_ALLOW / DERIBIT_DENY  comma-separated method globs adjusting which private methods are callable
 *
 * stdout carries only MCP messages; logs go to stderr.
 */
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { Deribit } from '@deribit-mcp/client';
import { createServer } from './server.js';
import { createPolicy } from './classify.js';
import { LiveMarket } from './live.js';
import { createSaver } from './save.js';

const log = (...args) => console.error('[deribit-mcp]', ...args);

/** Node's built-in fetch and WebSocket ignore HTTPS_PROXY; route both through undici's proxy agent. */
async function proxySupport() {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.ALL_PROXY;
  if (!proxy) return {};
  const { EnvHttpProxyAgent, setGlobalDispatcher, WebSocket: UndiciWebSocket } = await import('undici');
  const dispatcher = new EnvHttpProxyAgent();
  setGlobalDispatcher(dispatcher); // global fetch
  class ProxiedWebSocket extends UndiciWebSocket {
    constructor(url, protocols) {
      super(url, { protocols, dispatcher });
    }
  }
  log(`using proxy ${new URL(proxy).host}`);
  return { WebSocket: ProxiedWebSocket };
}

const env = process.env.DERIBIT_ENV === 'test' ? 'test' : 'production';
const client = new Deribit({
  env,
  clientId: process.env.DERIBIT_CLIENT_ID || null,
  clientSecret: process.env.DERIBIT_CLIENT_SECRET || null,
  ...(await proxySupport()),
});
// Without a key there is nothing private to call, so behave like the hosted server.
const mode = client.authenticated ? 'local' : 'hosted';
const policy = createPolicy({ mode, allow: process.env.DERIBIT_ALLOW, deny: process.env.DERIBIT_DENY });

const ttlMinutes = Number(process.env.DERIBIT_LIVE_TTL ?? 15);
const market = ttlMinutes > 0 ? new LiveMarket(client, { idleTtlMs: ttlMinutes * 60_000 }) : undefined;
const save = createSaver(process.env.DERIBIT_OUTPUT_DIR || 'deribit-data');

const handle = serveStdio(() => createServer({ client, policy, market, save }), {
  onerror: (error) => log(error),
});
log(
  `stdio server on ${env}; ${mode === 'local' ? 'with your key: private tools enabled' : 'no key: public data only'}; ` +
  `${market ? `live data kept for ${ttlMinutes} min after last use` : 'one-shot snapshots'}`,
);

const shutdown = async () => {
  await market?.close();
  client.close();
  await handle.close();
  process.exit(0);
};
process.stdin.on('end', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
