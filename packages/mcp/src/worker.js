/**
 * Hosted server on Cloudflare Workers: public market data only.
 *
 * Secrets DERIBIT_CLIENT_ID / DERIBIT_CLIENT_SECRET (a read-only key) authenticate every
 * upstream call, so Deribit applies per-user rather than per-IP rate limits (Workers share
 * IPs). Private tools are never registered, so that key's account is never exposed.
 */
import { createMcpHandler } from 'agents/mcp/server';
import { Deribit } from '@deribit-mcp/client';
import { createServer } from './server.js';
import { createPolicy } from './classify.js';

const ROUTE = '/deribit/v2/mcp';

// One client per isolate: reuses the WebSocket across requests until it goes idle.
let shared;
function clientFor(env) {
  const key = `${env.DERIBIT_CLIENT_ID ?? ''}:${env.DERIBIT_ENV ?? ''}`;
  if (shared?.key !== key) {
    shared?.client.close();
    shared = {
      key,
      client: new Deribit({
        env: env.DERIBIT_ENV === 'test' ? 'test' : 'production',
        clientId: env.DERIBIT_CLIENT_ID || null,
        clientSecret: env.DERIBIT_CLIENT_SECRET || null,
      }),
    };
  }
  return shared.client;
}

const policy = createPolicy({ mode: 'hosted' });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== ROUTE) {
      return new Response(`Deribit MCP server. Endpoint: ${ROUTE}\n`, { status: url.pathname === '/' ? 200 : 404 });
    }

    // Per-client rate limit so one caller can't exhaust the shared Deribit key.
    if (env.RATE_LIMITER) {
      const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
      const { success } = await env.RATE_LIMITER.limit({ key: ip });
      if (!success) {
        return Response.json(
          { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Rate limit exceeded; retry in a minute.' } },
          { status: 429, headers: { 'Retry-After': '60' } },
        );
      }
    }

    const client = clientFor(env);
    return createMcpHandler(() => createServer({ client, policy }), {
      route: ROUTE,
      allowedHostnames: env.ALLOWED_HOSTNAMES ? env.ALLOWED_HOSTNAMES.split(',') : undefined,
    })(request, env, ctx);
  },
};
