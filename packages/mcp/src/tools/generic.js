import { z } from 'zod';
import { search, methods, channels, validateParams } from 'deribit-client-js';
import { ok, fail, limitList, safe, table, isTable, tableOrSave, saveParam } from '../format.js';
import { requireConfirmation } from '../confirm.js';

const MAX_TEXT = 60_000;

/**
 * Bound any API result and pick a shape: a list of records (or an object whose main
 * field is one) becomes CSV with the rest as metadata; anything else stays JSON.
 */
export function shapeResult(result, limit, format = 'csv') {
  let meta = {};
  let key = 'items';
  let rows = result;
  if (!Array.isArray(result) && result && typeof result === 'object') {
    // e.g. { trades: [...], has_more } or { data: [...], records_total }
    const arrays = Object.entries(result).filter(([, v]) => Array.isArray(v)).sort((a, b) => b[1].length - a[1].length);
    if (arrays.length) {
      [key, rows] = arrays[0];
      meta = Object.fromEntries(Object.entries(result).filter(([k]) => k !== key));
    } else {
      rows = null;
    }
  }
  if (Array.isArray(rows)) {
    const { items, total, truncated } = limitList(rows, limit, 'Pass a larger limit or narrower params.');
    if (truncated) meta = { ...meta, total, truncated };
    rows = items;
  }

  const out = Array.isArray(rows) && (isTable(rows) || rows.length === 0 || format === 'json')
    ? table(meta, key, rows, format)
    : ok(Array.isArray(rows) ? (Object.keys(meta).length ? { ...meta, [key]: rows } : rows) : result);
  const size = out.content[0].text.length;
  if (size > MAX_TEXT) {
    return fail(`Result is ${size} characters, over the ${MAX_TEXT} limit. Narrow the params (e.g. kind, instrument, time range) or lower limit.`);
  }
  return out;
}

/**
 * @param {import('@modelcontextprotocol/server').McpServer} server
 * @param {ReturnType<import('../classify.js').createPolicy>} policy
 */
export function registerGenericTools(server, client, policy, deps = {}) {
  const local = policy.mode === 'local';
  const callable = local ? 'public and private read methods' : 'public market-data methods';

  server.registerTool('deribit_search', {
    title: 'Search Deribit API',
    description: `Find Deribit API methods (or subscription channels) by keyword, e.g. 'funding rate history' or 'mark price'. Use this when no dedicated tool fits, then deribit_describe and deribit_call.`,
    inputSchema: z.object({
      query: z.string().min(2),
      kind: z.enum(['method', 'channel']).default('method'),
      limit: z.number().int().min(1).max(30).default(10),
    }),
    annotations: { title: 'Search Deribit API', readOnlyHint: true, openWorldHint: false },
  }, safe(async ({ query, kind, limit }) => {
    const results = search(query, { kind, limit: limit * 3 })
      .map((r) => (r.kind === 'method' ? { ...r, class: policy.classOf(r.name) } : r))
      .filter((r) => r.kind === 'channel' || r.class !== 'blocked')
      .slice(0, limit)
      .map(({ score, ...r }) => r);
    if (!results.length) return fail(`Nothing matched '${query}'. Try other words, e.g. a param name like 'instrument_name'.`);
    return ok(results);
  }));

  server.registerTool('deribit_describe', {
    title: 'Describe Deribit method',
    description: 'Params (types, enums, which are required) and documentation for one Deribit method or channel.',
    inputSchema: z.object({ name: z.string().describe("e.g. 'public/get_funding_rate_history' or 'ticker.(instrument_name).(interval)'") }),
    annotations: { title: 'Describe Deribit method', readOnlyHint: true, openWorldHint: false },
  }, safe(async ({ name }) => {
    if (methods[name]) {
      const info = methods[name];
      const cls = policy.classOf(name);
      return ok({
        name, class: cls,
        callable_with: { public: 'deribit_call', private_read: 'deribit_call', private_write: 'deribit_call_write' }[cls] ?? null,
        ...(cls === 'blocked' ? { blocked_because: policy.reason(name) } : {}),
        required: info.required, params: info.params,
        description: info.description.length > 3000 ? `${info.description.slice(0, 3000)}…` : info.description,
      });
    }
    if (channels[name]) return ok({ name, ...channels[name] });
    return fail(`No method or channel named '${name}'. Use deribit_search to find it.`);
  }));

  server.registerTool('deribit_call', {
    title: 'Call Deribit API (read)',
    description: `Call any allowed Deribit read method (${callable}) by name with params as in deribit_describe. Lists of records come back as CSV (a JSON metadata line, then the table); other results as JSON. Lists are capped by limit.`,
    inputSchema: z.object({
      method: z.string().describe("e.g. 'public/get_last_trades_by_currency'"),
      params: z.record(z.string(), z.unknown()).default({}),
      limit: z.number().int().min(1).max(1000).default(100).describe('Cap for list results.'),
      format: z.enum(['csv', 'json']).default('csv').describe("Lists of records come back as CSV by default; 'json' keeps them as JSON."),
      ...saveParam(deps),
    }),
    annotations: { title: 'Call Deribit API (read)', readOnlyHint: true, openWorldHint: true },
  }, safe(async ({ method, params, limit, format, save_to }) => {
    const cls = policy.classOf(method);
    if (cls === 'private_write') return fail(`${method} changes account state; use deribit_call_write.`);
    if (cls === 'blocked') return fail(`${method} is not available: ${policy.reason(method)}.`);
    const result = await client.call(method, params);
    if (save_to) {
      // Save the full list (not capped by limit): the main array, or the result itself
      const rows = Array.isArray(result) ? result : Object.values(result ?? {}).filter(Array.isArray).sort((a, b) => b.length - a.length)[0];
      const meta = Array.isArray(result) ? {} : Object.fromEntries(Object.entries(result).filter(([, v]) => v !== rows));
      return tableOrSave(deps, save_to, { method, ...meta }, 'items', rows ?? [], format);
    }
    return shapeResult(result, limit, format);
  }));

  if (!local) return;

  server.registerTool('deribit_call_write', {
    title: 'Call Deribit API (write)',
    description:
      'Call a state-changing private Deribit method (orders, edits, cancels, subaccounts, MMP, block trades). ' +
      'Always asks the user to confirm first. Funds-moving and API-key methods are blocked unless the server allows them.',
    inputSchema: z.object({
      method: z.string().describe("e.g. 'private/buy'"),
      params: z.record(z.string(), z.unknown()).default({}),
      confirm: z.boolean().optional().describe("Only set after the user approved this exact call in the conversation (clients without confirmation forms)."),
    }),
    annotations: { title: 'Call Deribit API (write)', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  }, safe(async ({ method, params, confirm }, ctx) => {
    const cls = policy.classOf(method);
    if (cls !== 'private_write') {
      return fail(cls === 'blocked' ? `${method} is not available: ${policy.reason(method)}.` : `${method} is a read method; use deribit_call.`);
    }
    validateParams(method, params); // reject bad params before asking the user to confirm them
    const gate = requireConfirmation(server, ctx, { summary: `${method} ${JSON.stringify(params)} on ${client.env}`, confirm });
    if (gate) return gate;
    return shapeResult(await client.call(method, params), 100, 'json');
  }));
}
