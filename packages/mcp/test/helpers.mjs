import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler } from 'agents/mcp/server';
import { Deribit } from '@deribit-mcp/client';
import { createServer } from '../src/server.js';
import { createPolicy } from '../src/classify.js';

/**
 * A Deribit client whose HTTP calls go to `routes[method](params)` and whose
 * WebSocket answers every subscribe with `tickers[instrument]` snapshots.
 */
export function stubDeribit({ routes = {}, tickers = {}, credentials = false } = {}) {
  const calls = [];
  const fetch = async (_url, init) => {
    const { method, params, id } = JSON.parse(init.body);
    calls.push({ method, params });
    const route = routes[method];
    if (!route) return { ok: false, status: 400, json: async () => ({ id, error: { code: -32601, message: `no stub for ${method}` } }) };
    try {
      return { ok: true, status: 200, json: async () => ({ id, result: route(params) }) };
    } catch (error) {
      return { ok: false, status: 400, json: async () => ({ id, error: error.rpc ?? { code: 10000, message: error.message } }) };
    }
  };

  class FakeSocket {
    constructor() { queueMicrotask(() => this.onopen?.()); }
    send(raw) {
      const msg = JSON.parse(raw);
      calls.push({ method: msg.method, params: msg.params, ws: true });
      const reply = (result) => queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ id: msg.id, result }) }));
      if (msg.method.endsWith('/subscribe')) {
        reply(msg.params.channels);
        for (const channel of msg.params.channels) {
          const name = channel.replace(/^incremental_ticker\./, '');
          const data = { type: 'snapshot', instrument_name: name, ...(tickers[name] ?? {}) };
          setTimeout(() => this.onmessage?.({ data: JSON.stringify({ method: 'subscription', params: { channel, data } }) }), 1);
        }
      } else {
        reply(msg.method.endsWith('/unsubscribe') ? msg.params.channels : 'ok');
      }
    }
    close() { queueMicrotask(() => this.onclose?.()); }
  }

  const client = new Deribit({
    fetch,
    WebSocket: FakeSocket,
    idleTimeoutMs: 0,
    ...(credentials ? { clientId: 'id', clientSecret: 'secret', env: 'test' } : {}),
  });
  return { client, calls };
}

/**
 * Connect an SDK v2 client to the real HTTP handler in-process (no sockets).
 * @param {{ mode: 'hosted' | 'local', deribit: Deribit, elicit?: (req) => object, era?: string }} options
 */
export async function connect({ mode, deribit, elicit, allow, deny, era = '2026-07-28' }) {
  const policy = createPolicy({ mode, allow, deny });
  const handler = createMcpHandler(() => createServer({ client: deribit, policy }), { route: '/mcp' });
  const transport = new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
    fetch: (url, init) => {
      // Workers always set Host; Node's Request doesn't, and the handler checks it.
      const headers = new Headers(init?.headers);
      headers.set('host', 'localhost');
      return handler.fetch(new Request(url, { ...init, headers }));
    },
  });
  const mcp = new Client(
    { name: 'test', version: '1.0.0' },
    {
      capabilities: elicit ? { elicitation: { form: {} } } : {},
      // Pin the modern era; pass era: 'legacy' for the 2025 initialize handshake.
      ...(era === 'legacy' ? {} : { versionNegotiation: { mode: { pin: era } } }),
    },
  );
  if (elicit) mcp.setRequestHandler('elicitation/create', async (request) => elicit(request));
  await mcp.connect(transport);
  return mcp;
}

/** Parse a tool result's JSON text (or return the raw text for errors). */
export function body(result) {
  const text = result.content?.[0]?.text ?? '';
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Parse a CSV tool result: optional JSON metadata line, blank line, then the CSV table. */
export function parseTable(result) {
  const text = result.content[0].text;
  const [first, ...rest] = text.split('\n\n');
  const meta = rest.length ? JSON.parse(first) : {};
  const csv = rest.length ? rest.join('\n\n') : first;
  const [header, ...lines] = csv.split('\n');
  const columns = header.split(',');
  const rows = lines.map((line) => {
    const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g).slice(0, columns.length).map((c) => c.replace(/,$/, ''));
    return Object.fromEntries(columns.map((c, i) => {
      const raw = cells[i] ?? '';
      const value = raw.startsWith('"') ? raw.slice(1, -1).replace(/""/g, '"') : raw;
      return [c, value === '' ? undefined : Number.isNaN(Number(value)) ? value : Number(value)];
    }));
  });
  return { meta, columns, rows };
}
