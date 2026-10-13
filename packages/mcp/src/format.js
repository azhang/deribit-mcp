import { DeribitError, DeribitTransportError, DeribitValidationError } from '@deribit-mcp/client';

/** Successful tool result: compact JSON text. */
export function ok(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

/** Tool execution error the model can act on. */
export function fail(message) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/**
 * Cap a list so one call can't flood the context. When truncated, says how to narrow it.
 * @returns {{ items: any[], total: number, truncated?: string }}
 */
export function limitList(items, limit, hint) {
  if (items.length <= limit) return { items, total: items.length };
  return {
    items: items.slice(0, limit),
    total: items.length,
    truncated: `Showing ${limit} of ${items.length}. ${hint}`,
  };
}

/** Pick a subset of keys, dropping undefined values. */
export function pick(obj, keys) {
  const out = {};
  for (const key of keys) if (obj?.[key] !== undefined) out[key] = obj[key];
  return out;
}

/** Turn a thrown error into an actionable tool error. Never rethrows. */
export function toolError(error) {
  if (error instanceof DeribitValidationError) {
    return fail(`Invalid params for ${error.method}:\n- ${error.problems.join('\n- ')}\nUse deribit_describe to see the method's params.`);
  }
  if (error instanceof DeribitError) {
    const hint = error.code === 10028 || error.code === -32000
      ? ' Deribit is rate limiting; wait a few seconds and retry with fewer instruments.'
      : '';
    return fail(`Deribit rejected ${error.method}: ${error.message}.${hint}`);
  }
  if (error instanceof DeribitTransportError) {
    return fail(`Could not reach Deribit for ${error.method}: ${error.message}. This is usually transient; retry.`);
  }
  return fail(error?.message ?? String(error));
}

/** Wrap a tool handler so any thrown error becomes an isError result. */
export function safe(handler) {
  return async (args, ctx) => {
    try {
      return await handler(args, ctx);
    } catch (error) {
      return toolError(error);
    }
  };
}
