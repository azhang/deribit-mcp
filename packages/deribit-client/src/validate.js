import { methods } from './generated/methods.js';
import { DeribitValidationError } from './errors.js';

function typeOf(value) {
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function matches(schema, value) {
  if (schema.oneOf) return schema.oneOf.some((s) => matches(s, value));
  if (schema.enum) {
    // The enum is authoritative: some specs declare type "string" with numeric values
    // (e.g. DVOL resolution), so compare loosely and skip the type check.
    return schema.enum.includes(value) || schema.enum.map(String).includes(String(value));
  }
  const actual = typeOf(value);
  switch (schema.type) {
    case undefined: return true;
    case 'number': return actual === 'number' || actual === 'integer';
    case 'integer': return actual === 'integer';
    case 'array':
      return actual === 'array' && (!schema.items || value.every((v) => matches(schema.items, v)));
    default: return actual === schema.type;
  }
}

function describe(schema) {
  if (schema.oneOf) return schema.oneOf.map(describe).join(' | ');
  if (schema.enum) return `one of ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`;
  if (schema.type === 'array' && schema.items) return `array of ${describe(schema.items)}`;
  return schema.type ?? 'any';
}

/**
 * Check params against the method's spec. Throws DeribitValidationError listing every problem,
 * so a caller (or a model) can fix them all in one go.
 */
export function validateParams(method, params = {}) {
  const info = methods[method];
  if (!info) {
    const close = Object.keys(methods).filter((m) => m.endsWith(`/${method.split('/').pop()}`));
    throw new DeribitValidationError(method, [
      `unknown method${close.length ? ` (did you mean ${close.join(' or ')}?)` : ''}`,
    ]);
  }

  const problems = [];
  for (const name of info.required) {
    if (params[name] === undefined || params[name] === null) problems.push(`missing required param '${name}'`);
  }
  for (const [name, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const schema = info.params[name];
    if (!schema) {
      const known = Object.keys(info.params);
      problems.push(`unknown param '${name}'${known.length ? ` (accepted: ${known.join(', ')})` : ' (takes no params)'}`);
    } else if (!matches(schema, value)) {
      problems.push(`param '${name}' must be ${describe(schema)}, got ${JSON.stringify(value)}`);
    }
  }
  if (problems.length) throw new DeribitValidationError(method, problems);
}
