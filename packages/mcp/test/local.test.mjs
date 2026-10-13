// Local-only layer: live cache with idle expiry, and save_to.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LiveMarket } from '../src/live.js';
import { createSaver } from '../src/save.js';
import { stubDeribit, connect, body } from './helpers.mjs';

/** Minimal client double: records subscribe/unsubscribe and lets tests push data. */
function fakeClient({ refuse = [] } = {}) {
  const calls = [];
  const listeners = new Map();
  return {
    calls,
    push(channel, data) { for (const fn of listeners.get(channel) ?? []) fn(data, channel); },
    drop() { for (const fns of listeners.values()) for (const fn of fns) fn.onClose?.('dropped'); },
    async subscribe(channels, listener) {
      calls.push(['subscribe', channels]);
      const accepted = channels.filter((c) => !refuse.includes(c));
      for (const c of accepted) {
        if (!listeners.has(c)) listeners.set(c, new Set());
        listeners.get(c).add(listener);
        queueMicrotask(() => this.push(c, { type: 'snapshot', channel: c, v: 1 }));
      }
      return { channels: accepted, rejected: channels.filter((c) => refuse.includes(c)) };
    },
    async unsubscribe(channels, listener) {
      calls.push(['unsubscribe', channels]);
      for (const c of channels) listeners.get(c)?.delete(listener);
    },
  };
}

test('live cache: subscribes once, then answers from memory with merged updates', async () => {
  const client = fakeClient();
  const live = new LiveMarket(client, { sweepMs: 1e9 });
  const first = await live.snapshot(['a', 'b']);
  assert.equal(first.a.v, 1);
  client.push('a', { type: 'change', v: 2 });
  const second = await live.snapshot(['a']);
  assert.equal(second.a.v, 2, 'change merged');
  assert.deepEqual(client.calls, [['subscribe', ['a', 'b']]], 'no second subscribe');
  await live.close();
});

test('live cache: channels unused for the TTL are unsubscribed; used ones stay', async () => {
  let t = 0;
  const client = fakeClient();
  const live = new LiveMarket(client, { idleTtlMs: 15 * 60_000, sweepMs: 1e9, now: () => t });
  await live.snapshot(['a', 'b']);
  t = 10 * 60_000;
  await live.snapshot(['a']); // keeps a warm
  t = 20 * 60_000;
  await live.sweep();
  assert.deepEqual(client.calls.at(-1), ['unsubscribe', ['b']]);
  assert.equal(live.stats().live_channels, 1);
  t = 30 * 60_000;
  await live.sweep();
  assert.deepEqual(client.calls.at(-1), ['unsubscribe', ['a']]);
  assert.equal(live.stats().live_channels, 0);
  await live.close();
});

test('live cache: after a dropped connection, waits for fresh data instead of serving stale', async () => {
  const client = fakeClient();
  const live = new LiveMarket(client, { sweepMs: 1e9 });
  await live.snapshot(['a']);
  client.drop();
  const pending = live.snapshot(['a'], { timeoutMs: 1000 });
  setTimeout(() => client.push('a', { type: 'snapshot', v: 9 }), 20); // resubscribe delivers fresh data
  assert.equal((await pending).a.v, 9);
  await live.close();
});

test('live cache: refused channels are reported and not cached; size cap evicts LRU', async () => {
  let t = 0;
  const client = fakeClient({ refuse: ['bad'] });
  const live = new LiveMarket(client, { maxChannels: 2, sweepMs: 1e9, now: () => t });
  const r = await live.snapshot(['a', 'bad']);
  assert.deepEqual(r.rejected, ['bad']);
  assert.equal(live.stats().live_channels, 1);
  t = 1; await live.snapshot(['b']);
  t = 2; await live.snapshot(['c']); // over the cap: 'a' is least recently used
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(client.calls.at(-1), ['unsubscribe', ['a']]);
  await live.close();
});

test('save_to writes CSV inside the output folder and refuses paths outside it', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'deribit-'));
  const save = createSaver(dir);
  const file = await save('chains/btc', [{ strike: 1, iv: 50 }, { strike: 2, iv: 51 }]);
  assert.equal(file, path.join(dir, 'chains', 'btc.csv'));
  assert.equal(await readFile(file, 'utf8'), 'strike,iv\n1,50\n2,51\n');
  await assert.rejects(save('../escape', [{ a: 1 }]), /inside/);
  await assert.rejects(save('/etc/passwd', [{ a: 1 }]), /relative path/);
});

test('local tools accept save_to and return a summary instead of the table', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'deribit-'));
  const rows = Array.from({ length: 30 }, (_, i) => ({ instrument_name: `BTC-${i}`, volume_usd: 30 - i }));
  const { client } = stubDeribit({ credentials: true, routes: { 'public/get_book_summary_by_currency': () => rows } });
  const mcp = await connect({ mode: 'local', deribit: client, save: createSaver(dir) });
  const r = body(await mcp.callTool({ name: 'market_overview', arguments: { currency: 'BTC', kind: 'future', limit: 30, save_to: 'overview' } }));
  assert.equal(r.rows, 30);
  assert.equal(r.saved_to, path.join(dir, 'overview.csv'));
  assert.equal(r.preview.split('\n').length, 6); // header + 5 rows
  assert.equal((await readFile(r.saved_to, 'utf8')).trim().split('\n').length, 31);
  await mcp.close();
});

test('hosted tools have no save_to param', async () => {
  const mcp = await connect({ mode: 'hosted', deribit: stubDeribit().client });
  const { tools } = await mcp.listTools();
  assert.ok(tools.every((t) => !('save_to' in (t.inputSchema.properties ?? {}))));
  await mcp.close();
});
