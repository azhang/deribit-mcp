import { McpServer } from '@modelcontextprotocol/server';
import { registerMarketTools } from './tools/market.js';
import { registerSurfaceTool } from './tools/surface.js';
import { registerGenericTools } from './tools/generic.js';
import { registerAccountTools } from './tools/account.js';

export const VERSION = '2.0.0-alpha.0';

const INSTRUCTIONS = {
  hosted:
    'Deribit public market data (options, futures, perpetuals, spot). Prefer the dedicated tools; ' +
    'for anything else use deribit_search, then deribit_describe and deribit_call. ' +
    'Account tools need a local server with your own API key.',
  local:
    "Deribit market data and the user's own account. Prefer the dedicated tools; for anything else use deribit_search, " +
    'then deribit_describe and deribit_call (reads) or deribit_call_write (changes, always confirmed by the user). ' +
    'State the environment (test or production) when reporting account data.',
};

/**
 * Build a server for one request (hosted) or one connection (stdio).
 *
 * @param {{ client: import('@deribit-mcp/client').Deribit, policy: ReturnType<import('./classify.js').createPolicy>,
 *   market?: { snapshot: Function }, save?: Function }} deps
 *   `market` and `save` are local-only extras (live cache, CSV files); the hosted server omits them.
 */
export function createServer({ client, policy, market, save }) {
  const deps = { market, save };
  const server = new McpServer(
    { name: 'deribit', version: VERSION },
    { instructions: INSTRUCTIONS[policy.mode] },
  );
  registerMarketTools(server, client, deps);
  registerSurfaceTool(server, client, deps);
  if (policy.mode === 'local') registerAccountTools(server, client, deps);
  registerGenericTools(server, client, policy, deps);
  return server;
}
