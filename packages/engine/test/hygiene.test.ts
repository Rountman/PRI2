import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dirs = ['config', 'packages/engine/src', 'apps/server/src', 'apps/web/src', 'scripts', 'docs'];

function walk(d: string): string[] {
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.(ts|tsx|md|css|html)$/.test(e.name) ? [path.join(d, e.name)] : []));
}

it('no mojibake (UTF-8 read as cp1252) in sources', () => {
  const bad = dirs.flatMap((d) => walk(path.join(root, d))).filter((f) => /Ã.|â€|âˆ|Ä›|Å¡/.test(fs.readFileSync(f, 'utf8')));
  expect(bad).toEqual([]);
});
