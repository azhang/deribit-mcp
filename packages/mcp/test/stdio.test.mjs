// Local mode runs over stdio. These spawn the real entry point, and the single-file bundle
// built from it, with a fake key on the test environment; the user declines every
// confirmation, so nothing reaches Deribit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { buildStdio } from '../scripts/build-stdio.mjs';

const entries = {
  source: fileURLToPath(new URL('../src/stdio.js', import.meta.url)),
  bundle: await buildStdio(path.join(await mkdtemp(path.join(tmpdir(), 'deribit-stdio-')), 'deribit-mcp.mjs')),
};

async function connectStdio({ entry, era, env }) {
  const prompts = [];
  const client = new Client(
    { name: 'test', version: '1.0.0' },
    { capabilities: { elicitation: { form: {} } }, ...(era === 'legacy' ? {} : { versionNegotiation: { mode: { pin: era } } }) },
  );
  client.setRequestHandler('elicitation/create', async (req) => {
    prompts.push(req.params.message);
    return { action: 'decline' };
  });
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], env: { ...process.env, ...env }, stderr: 'pipe' });
  await client.connect(transport);
  return { client, prompts };
}

for (const [kind, entry] of Object.entries(entries)) {
  for (const era of ['2026-07-28', 'legacy']) {
    test(`stdio ${kind} (${era}): write tools ask the user, and a declined form runs nothing`, async () => {
      const { client, prompts } = await connectStdio({
        entry,
        era,
        env: { DERIBIT_CLIENT_ID: 'fake', DERIBIT_CLIENT_SECRET: 'fake', DERIBIT_ENV: 'test' },
      });
      const { tools } = await client.listTools();
      assert.ok(tools.some((t) => t.name === 'cancel_orders'));
      const r = await client.callTool({ name: 'cancel_orders', arguments: { scope: 'all', confirm: true } });
      assert.equal(prompts.length, 1);
      assert.match(prompts[0], /Cancel ALL open orders on test/);
      assert.match(r.content[0].text, /did not confirm/);
      await client.close();
    });
  }

  test(`stdio ${kind} without a key serves public tools only`, async () => {
    const { client } = await connectStdio({ entry, era: '2026-07-28', env: { DERIBIT_CLIENT_ID: '', DERIBIT_CLIENT_SECRET: '' } });
    const names = (await client.listTools()).tools.map((t) => t.name);
    assert.ok(!names.includes('account') && !names.includes('cancel_orders') && !names.includes('deribit_call_write'));
    await client.close();
  });

  // The proxy path loads undici, which is CommonJS: the case a bundle is most likely to break.
  test(`stdio ${kind} starts with HTTPS_PROXY set`, async () => {
    const { client } = await connectStdio({ entry, era: '2026-07-28', env: { HTTPS_PROXY: 'http://127.0.0.1:9' } });
    assert.ok((await client.listTools()).tools.length > 0);
    await client.close();
  });
}
