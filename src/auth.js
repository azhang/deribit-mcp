/**
 * Shared-key gate for the MCP endpoint.
 *
 * The Worker falls back to server-default Deribit credentials, so an open
 * endpoint lets anyone read that account. Callers must send `x-api-key`
 * matching the MCP_API_KEY secret; with the secret unset, everything is refused.
 */

const encoder = new TextEncoder();

async function digest(value) {
  return crypto.subtle.digest('SHA-256', encoder.encode(value));
}

export async function isAuthorized(request, env) {
  const expected = env.MCP_API_KEY;
  const provided = request.headers.get('x-api-key');
  if (!expected || !provided) return false;

  // Hash both sides so timingSafeEqual compares equal-length buffers.
  const [a, b] = await Promise.all([digest(provided), digest(expected)]);
  return crypto.subtle.timingSafeEqual(a, b);
}
