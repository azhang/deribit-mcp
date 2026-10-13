/**
 * Which Deribit methods each deployment may call, and how.
 *
 *   public        public market data             hosted + local, deribit_call
 *   private_read  account reads                  local only,     deribit_call
 *   private_write state-changing private methods local only,     deribit_call_write (confirmed)
 *   blocked       session plumbing, deprecated, or funds-moving / API-key methods (local default)
 *
 * The result for the current spec is checked in as src/generated/method-classes.json
 * (`npm run classify`), and a test fails if it drifts, so every change is reviewed.
 */
import { methods } from '@deribit-mcp/client';

/** Transport/session plumbing the client handles itself. */
export const SESSION_METHODS = new Set([
  'public/auth', 'public/exchange_token', 'public/fork_token', 'public/hello', 'public/test',
  'public/set_heartbeat', 'public/disable_heartbeat',
  'public/subscribe', 'public/unsubscribe', 'public/unsubscribe_all',
  'private/subscribe', 'private/unsubscribe', 'private/unsubscribe_all', 'private/logout',
  'private/enable_cancel_on_disconnect', 'private/disable_cancel_on_disconnect',
]);

/** Private methods that only read or simulate, despite not being named get_*. */
export const PRIVATE_READ_EXTRA = new Set([
  'private/simulate_portfolio', 'private/pme/simulate', 'private/simulate_block_trade',
  'private/list_custody_accounts', 'private/list_address_beneficiaries',
]);

/**
 * Blocked in local mode by default, even with confirmation: methods that move funds
 * out of the account or manage API keys. DERIBIT_ALLOW re-enables specific ones.
 */
export const DEFAULT_DENY = [
  'private/withdraw', 'private/cancel_withdrawal',
  'private/submit_transfer_*', 'private/cancel_transfer_by_id',
  'private/add_to_address_book', 'private/update_in_address_book', 'private/remove_from_address_book',
  'private/save_address_beneficiary', 'private/delete_address_beneficiary',
  'private/set_address_requires_security_key', 'private/set_coinbase_subaccount_withdrawals_allowed',
  'private/create_api_key', 'private/edit_api_key', 'private/remove_api_key', 'private/reset_api_key',
  'private/change_api_key_name', 'private/change_scope_in_api_key',
  'private/enable_api_key', 'private/disable_api_key', 'private/list_api_keys',
];

/** Base class of a method from the spec alone, before deployment policy. */
export function baseClass(name, info = methods[name]) {
  if (!info || info.deprecated || SESSION_METHODS.has(name)) return 'blocked';
  if (info.scope === 'public') return 'public';
  if (/^private\/get_/.test(name) || PRIVATE_READ_EXTRA.has(name)) return 'private_read';
  return 'private_write';
}

function globToRegExp(glob) {
  return new RegExp(`^${glob.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
}

export function parseGlobs(value) {
  return (Array.isArray(value) ? value : String(value ?? '').split(','))
    .map((g) => g.trim()).filter(Boolean).map(globToRegExp);
}

/**
 * Build the policy for a deployment.
 * @param {{ mode: 'hosted' | 'local', allow?: string | string[], deny?: string | string[] }} options
 */
export function createPolicy({ mode, allow, deny }) {
  const allowRe = parseGlobs(allow);
  const denyRe = mode === 'local' ? [...parseGlobs(DEFAULT_DENY), ...parseGlobs(deny)] : parseGlobs(deny);
  const matches = (res, name) => res.some((re) => re.test(name));

  /** @returns {'public' | 'private_read' | 'private_write' | 'blocked'} */
  function classOf(name) {
    const base = baseClass(name);
    if (base === 'blocked') return base;
    if (mode === 'hosted' && base !== 'public') return 'blocked';
    if (matches(denyRe, name) && !matches(allowRe, name)) return 'blocked';
    return base;
  }

  function reason(name) {
    if (!methods[name]) return 'unknown method';
    const base = baseClass(name);
    if (base === 'blocked') return methods[name].deprecated ? 'deprecated' : 'session method handled by the client';
    if (mode === 'hosted' && base !== 'public') return 'private methods are only available on a local server with your own key';
    return 'blocked by policy (funds-moving or API-key management); set DERIBIT_ALLOW to enable';
  }

  return { mode, classOf, reason };
}

/** method -> base class for every method in the spec (what the checked-in snapshot records). */
export function classifyAll() {
  return Object.fromEntries(Object.keys(methods).sort().map((name) => [name, baseClass(name)]));
}
