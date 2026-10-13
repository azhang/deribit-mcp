#!/usr/bin/env node
/**
 * Local server over stdio with your own Deribit key:
 *
 *   DERIBIT_CLIENT_ID=… DERIBIT_CLIENT_SECRET=… [DERIBIT_ENV=test] npx deribit-mcp
 *
 * Optional: DERIBIT_ALLOW / DERIBIT_DENY (comma-separated method globs) adjust which
 * private methods are callable. stdout carries only MCP messages; logs go to stderr.
 */
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { Deribit } from '@deribit-mcp/client';
import { createServer } from './server.js';
import { createPolicy } from './classify.js';

const env = process.env.DERIBIT_ENV === 'test' ? 'test' : 'production';
const client = new Deribit({
  env,
  clientId: process.env.DERIBIT_CLIENT_ID || null,
  clientSecret: process.env.DERIBIT_CLIENT_SECRET || null,
});
// Without a key there is nothing private to call, so behave like the hosted server.
const mode = client.authenticated ? 'local' : 'hosted';
const policy = createPolicy({ mode, allow: process.env.DERIBIT_ALLOW, deny: process.env.DERIBIT_DENY });

const handle = serveStdio(() => createServer({ client, policy }), {
  onerror: (error) => console.error('[deribit-mcp]', error),
});
console.error(`[deribit-mcp] stdio server on ${env} (${mode === 'local' ? 'with your key: private tools enabled' : 'no key: public data only'})`);

const shutdown = async () => {
  client.close();
  await handle.close();
  process.exit(0);
};
process.stdin.on('end', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
