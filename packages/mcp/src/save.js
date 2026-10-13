/**
 * Local-only: write large tables to CSV files instead of returning them inline.
 * Files go under one output directory (DERIBIT_OUTPUT_DIR, default ./deribit-data);
 * paths that are absolute or escape it are refused.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { toCsv } from './format.js';

export function createSaver(outputDir) {
  const root = path.resolve(outputDir);
  return async function save(relativePath, rows) {
    if (path.isAbsolute(relativePath)) throw new Error(`save_to must be a relative path inside ${root}`);
    const target = path.resolve(root, relativePath.endsWith('.csv') ? relativePath : `${relativePath}.csv`);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error(`save_to must stay inside ${root}`);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${toCsv(rows)}\n`);
    return target;
  };
}
