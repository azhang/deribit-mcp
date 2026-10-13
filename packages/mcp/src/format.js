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
    const hints = {
      10028: 'Deribit is rate limiting; wait a few seconds and retry with fewer instruments.',
      11060: "Trades and charts aren't available for Coinbase-routed spot pairs; pass kind 'future' or 'option' (not 'spot'/'any'), or use the order book or ticker.",
    };
    const hint = hints[error.code] ? ` ${hints[error.code]}` : '';
    return fail(`Deribit rejected the call: ${error.message}.${hint}`); // message already names the method
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

// ---- Tables ----

function csvCell(value) {
  if (value === undefined || value === null) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Rows (array of objects) to CSV. Columns: union of keys in first-seen order; nested values as JSON. */
export function toCsv(rows) {
  const columns = [];
  const seen = new Set();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  return [columns.join(','), ...rows.map((row) => columns.map((c) => csvCell(row[c])).join(','))].join('\n');
}

/** Whether a value is a list of plain objects that reads well as a table. */
export function isTable(value) {
  return Array.isArray(value) && value.length > 0 && value.every((v) => v && typeof v === 'object' && !Array.isArray(v));
}

/**
 * Tabular result: CSV by default (a JSON metadata line, a blank line, then the CSV),
 * or JSON with the rows under `key` when format is 'json'.
 */
export function table(meta, key, rows, format = 'csv') {
  if (format === 'json' || !isTable(rows)) return ok({ ...meta, [key]: rows });
  const header = Object.values(meta).some((v) => v !== undefined) ? `${JSON.stringify({ ...meta, rows: rows.length })}\n\n` : '';
  return { content: [{ type: 'text', text: `${header}${toCsv(rows)}` }] };
}
