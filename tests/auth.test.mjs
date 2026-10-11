import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timingSafeEqual } from 'node:crypto';
import { isAuthorized } from '../src/auth.js';

// Workers-only extension of SubtleCrypto; stand in with Node's.
crypto.subtle.timingSafeEqual ??= (a, b) => timingSafeEqual(Buffer.from(a), Buffer.from(b));

const req = (key) => new Request('https://mcp.x.zip/deribit/mcp', {
  method: 'POST',
  headers: key === undefined ? {} : { 'x-api-key': key },
});

test('rejects a missing header', async () => {
  assert.equal(await isAuthorized(req(), { MCP_API_KEY: 'k' }), false);
});

test('rejects a wrong key, including a prefix of the right one', async () => {
  assert.equal(await isAuthorized(req('nope'), { MCP_API_KEY: 'secret' }), false);
  assert.equal(await isAuthorized(req('secre'), { MCP_API_KEY: 'secret' }), false);
});

test('fails closed when the secret is unset', async () => {
  assert.equal(await isAuthorized(req(''), {}), false);
  assert.equal(await isAuthorized(req('anything'), {}), false);
});

test('accepts the right key', async () => {
  assert.equal(await isAuthorized(req('secret'), { MCP_API_KEY: 'secret' }), true);
});
