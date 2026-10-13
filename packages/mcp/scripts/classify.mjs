#!/usr/bin/env node
// Write src/generated/method-classes.json so classification changes show up in review.
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { classifyAll } from '../src/classify.js';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'generated', 'method-classes.json');
await mkdir(path.dirname(out), { recursive: true });
const classes = classifyAll();
await writeFile(out, `${JSON.stringify(classes, null, 1)}\n`);
const counts = Object.values(classes).reduce((acc, c) => ({ ...acc, [c]: (acc[c] ?? 0) + 1 }), {});
console.log(`Wrote ${path.relative(process.cwd(), out)}:`, counts);
