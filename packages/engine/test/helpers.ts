import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveConfig } from '@copilot/config';
import { datasetFrom } from '../src/dataset.ts';
import { isKnown, parseReport, type ParseResult } from '../src/parse/index.ts';

export const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures');
export const FIXTURE_FILES = fs.readdirSync(FIXTURES).filter((f) => f.endsWith('.xlsx'));
export const cfg = resolveConfig({ preset: 'intro' });

export function loadFixture(name: string): ParseResult {
  const r = parseReport(fs.readFileSync(path.join(FIXTURES, name)), { roundLength: 20 });
  if (!isKnown(r)) throw new Error(`fixture ${name} not recognised`);
  return r;
}

export function loadAll(except: string[] = []): ParseResult[] {
  return FIXTURE_FILES.filter((f) => !except.includes(f)).map(loadFixture);
}

export function fixtureDataset(except: string[] = []) {
  return datasetFrom(loadAll(except), { importedAt: '2026-01-01T00:00:00Z' });
}
