import { z } from 'zod';
import { ok, fail, safe, table } from '../format.js';
import { requireConfirmation } from '../confirm.js';

const CURRENCY = z.string().describe("e.g. 'BTC', 'ETH', 'USDC'");

/** Local mode only: the user's own account. */
export function registerAccountTools(server, client) {
  server.registerTool('account', {
    title: 'Account',
    description: "Your Deribit account: balances and margin ('summary'), open positions with greeks ('positions'), open orders, recent fills ('trades'), or order history.",
    inputSchema: z.object({
      view: z.enum(['summary', 'positions', 'open_orders', 'trades', 'order_history']),
      currency: CURRENCY.optional().describe("Required except for open_orders, e.g. 'BTC'"),
      kind: z.enum(['future', 'option', 'spot', 'future_combo', 'option_combo']).optional(),
      count: z.number().int().min(1).max(1000).default(50).describe('For trades and order_history.'),
      format: z.enum(['csv', 'json']).default('csv').describe("Lists come back as CSV by default; 'json' keeps them as JSON."),
    }),
    annotations: { title: 'Account', readOnlyHint: true, openWorldHint: true },
  }, safe(async ({ view, currency, kind, count, format }) => {
    if (view !== 'open_orders' && !currency) return fail(`view '${view}' needs a currency.`);
    const call = {
      summary: () => client.private.get_account_summary({ currency, extended: true }),
      positions: () => client.private.get_positions({ currency, kind }),
      open_orders: () => (currency
        ? client.private.get_open_orders_by_currency({ currency, kind })
        : client.private.get_open_orders({ kind })),
      trades: () => client.private.get_user_trades_by_currency({ currency, kind, count, sorting: 'desc' }),
      order_history: () => client.private.get_order_history_by_currency({ currency, kind, count }),
    }[view];
    const result = await call();
    const rows = Array.isArray(result) ? result : result?.trades; // get_user_trades_by_currency returns { trades, has_more }
    if (Array.isArray(rows)) {
      return table({ environment: client.env, view, currency, ...(result.has_more !== undefined ? { has_more: result.has_more } : {}) }, view, rows, format);
    }
    return ok({ environment: client.env, view, result });
  }));

  server.registerTool('cancel_orders', {
    title: 'Cancel orders',
    description:
      "Cancel open orders by currency (optionally kind/type), by instrument, or by label; scope 'all' cancels every order. Asks the user to confirm first.",
    inputSchema: z.object({
      scope: z.enum(['currency', 'instrument', 'label', 'all']),
      currency: CURRENCY.optional(),
      kind: z.enum(['future', 'option', 'spot', 'future_combo', 'option_combo', 'combo', 'any']).optional(),
      type: z.enum(['all', 'limit', 'trigger_all', 'stop', 'take', 'trailing_stop']).optional(),
      instrument_name: z.string().optional(),
      label: z.string().optional(),
      confirm: z.boolean().optional().describe('Only set after the user approved this exact cancel in the conversation (clients without confirmation forms).'),
    }),
    annotations: { title: 'Cancel orders', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  }, safe(async ({ scope, currency, kind, type, instrument_name, label, confirm }, ctx) => {
    let method;
    let params;
    if (scope === 'currency') {
      if (!currency) return fail("scope 'currency' needs currency.");
      [method, params] = ['private/cancel_all_by_currency', { currency, kind, type }];
    } else if (scope === 'instrument') {
      if (!instrument_name) return fail("scope 'instrument' needs instrument_name.");
      [method, params] = ['private/cancel_all_by_instrument', { instrument_name, type }];
    } else if (scope === 'label') {
      if (!label) return fail("scope 'label' needs label.");
      [method, params] = ['private/cancel_by_label', { label, currency }];
    } else {
      if (currency || kind || type || instrument_name || label) return fail("scope 'all' takes no filters; use scope 'currency' or 'instrument' to filter.");
      [method, params] = ['private/cancel_all', {}];
    }
    params = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined));
    const what = scope === 'all' ? 'Cancel ALL open orders' : `Cancel orders (${method.replace('private/', '')} ${JSON.stringify(params)})`;
    const gate = requireConfirmation(server, ctx, { summary: `${what} on ${client.env}`, confirm });
    if (gate) return gate;
    return ok({ environment: client.env, method, params, cancelled: await client.call(method, params) });
  }));
}
