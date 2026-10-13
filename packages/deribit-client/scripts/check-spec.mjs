#!/usr/bin/env node
/**
 * Compare the vendored specs with the ones published on docs.deribit.com.
 *
 *   npm run check-spec            report drift; exit 1 if anything changed
 *   npm run check-spec -- --write also overwrite spec/*.json (then run `npm run generate`)
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SPECS = {
  'deribit_openapi.json': 'https://docs.deribit.com/specifications/deribit_openapi.json',
  'deribit_asyncapi.json': 'https://docs.deribit.com/specifications/deribit_asyncapi.json',
};
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const write = process.argv.includes('--write');

function resolve(spec, node) {
  while (node?.$ref) node = node.$ref.split('/').slice(1).reduce((o, k) => o?.[k], spec);
  return node;
}

/** method -> { param -> "type[!] enum" } : the parts of the spec callers depend on. */
function methodSignatures(spec) {
  const out = {};
  for (const [p, ops] of Object.entries(spec.paths)) {
    const params = {};
    for (const raw of ops.get?.parameters ?? []) {
      const param = resolve(spec, raw);
      const schema = resolve(spec, param.schema) ?? {};
      params[param.name] = `${schema.type ?? 'any'}${param.required ? '!' : ''}${schema.enum ? ` [${schema.enum.join(',')}]` : ''}`;
    }
    out[p.slice(1)] = { params, deprecated: Boolean(ops.get?.deprecated) };
  }
  return out;
}

function diffMethods(oldSpec, newSpec) {
  const a = methodSignatures(oldSpec);
  const b = methodSignatures(newSpec);
  const lines = [];
  for (const m of Object.keys(b).filter((m) => !a[m]).sort()) lines.push(`+ method ${m}`);
  for (const m of Object.keys(a).filter((m) => !b[m]).sort()) lines.push(`- method ${m}`);
  for (const m of Object.keys(a).filter((m) => b[m]).sort()) {
    if (!a[m].deprecated && b[m].deprecated) lines.push(`~ method ${m} is now deprecated`);
    const pa = a[m].params;
    const pb = b[m].params;
    for (const p of new Set([...Object.keys(pa), ...Object.keys(pb)])) {
      if (!pa[p]) lines.push(`+ ${m} param ${p}: ${pb[p]}`);
      else if (!pb[p]) lines.push(`- ${m} param ${p}`);
      else if (pa[p] !== pb[p]) lines.push(`~ ${m} param ${p}: ${pa[p]} -> ${pb[p]}`);
    }
  }
  return lines;
}

function diffChannels(oldSpec, newSpec) {
  const a = new Set(Object.values(oldSpec.channels).map((c) => c.address));
  const b = new Set(Object.values(newSpec.channels).map((c) => c.address));
  return [
    ...[...b].filter((c) => !a.has(c)).sort().map((c) => `+ channel ${c}`),
    ...[...a].filter((c) => !b.has(c)).sort().map((c) => `- channel ${c}`),
  ];
}

let drift = false;
for (const [file, url] of Object.entries(SPECS)) {
  const local = JSON.parse(await readFile(path.join(root, 'spec', file), 'utf8'));
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const text = await response.text();
  const remote = JSON.parse(text);

  const lines = file.includes('openapi') ? diffMethods(local, remote) : diffChannels(local, remote);
  const versionChanged = local.info?.version !== remote.info?.version;
  const textChanged = JSON.stringify(local) !== JSON.stringify(remote);
  console.log(`\n${file}: ${local.info?.version} (vendored) vs ${remote.info?.version} (published)`);
  if (lines.length) console.log(lines.map((l) => `  ${l}`).join('\n'));
  else if (textChanged) console.log('  no signature changes (descriptions/schemas changed)');
  else console.log('  identical');

  if (lines.length || versionChanged || textChanged) {
    drift = true;
    if (write) {
      await writeFile(path.join(root, 'spec', file), text);
      console.log(`  wrote spec/${file}; run \`npm run generate\``);
    }
  }
}
process.exitCode = drift && !write ? 1 : 0;
