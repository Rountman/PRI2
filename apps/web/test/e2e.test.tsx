// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, render } from '@testing-library/react';
import * as XLSX from 'xlsx';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { isKnown, parseReport } from '@copilot/engine';
import { createApp } from '../../server/src/app.ts';
import { Store } from '../../server/src/store.ts';
import type { StateResponse } from '../src/api.ts';
import { Shell, TABS } from '../src/App.tsx';

const FIX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures');
const ALL = fs.readdirSync(FIX).filter((f) => f.endsWith('.xlsx'));

beforeAll(() => {
  // recharts ResponsiveContainer needs ResizeObserver
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

// jsdom replaces FormData/File globals, so multipart is covered by the server test; here we ingest via the parser.
async function stateFor(files: { name: string; data: Uint8Array }[]): Promise<StateResponse> {
  const store = new Store();
  const { app } = createApp(store);
  for (const f of files) {
    const r = parseReport(f.data, { roundLength: 20 });
    if (isKnown(r)) store.ingest(r, { filename: f.name });
  }
  return (await (await app.request('/api/state')).json()) as StateResponse;
}

const read = (name: string) => ({ name, data: new Uint8Array(fs.readFileSync(path.join(FIX, name))) });

function renameColumn(name: string, from: string, to: string) {
  const wb = XLSX.read(fs.readFileSync(path.join(FIX, name)));
  const ws = wb.Sheets[wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true });
  grid[0] = grid[0].map((h) => (h === from ? to : h));
  const out = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(out, XLSX.utils.aoa_to_sheet(grid), 'x');
  return { name, data: new Uint8Array(XLSX.write(out, { type: 'array', bookType: 'xlsx' })) };
}

function renderAllTabs(s: StateResponse) {
  for (const t of TABS) {
    const { container, unmount } = render(<Shell s={s} online lastOk={new Date()} initialTab={t.id} />);
    expect(container.textContent, `tab ${t.id}`).toContain('ERPsim');
    expect(container.querySelector('main')!.textContent!.length, `tab ${t.id} main`).toBeGreaterThan(10);
    unmount();
    localStorage.clear();
  }
}

describe('e2e: fixtures → every screen renders', () => {
  it('all 8 reports', async () => {
    const s = await stateFor(ALL.map(read));
    renderAllTabs(s);
    const { container } = render(<Shell s={s} online={false} lastOk={new Date()} initialTab="velin" />);
    expect(container.textContent).toContain('offline');
    expect(container.textContent).toContain('Objednej suroviny HNED');
    expect(container.textContent).toContain('DC 10');
  });

  it('empty server', async () => {
    renderAllTabs(await stateFor([]));
  });

  it.each(ALL)('without %s', async (skip) => {
    renderAllTabs(await stateFor(ALL.filter((f) => f !== skip).map(read)));
  });

  it('renamed optional column (SalesReport Cost → Kosten) still imports', async () => {
    const s = await stateFor([...ALL.filter((f) => f !== 'SalesReport.xlsx').map(read), renameColumn('SalesReport.xlsx', 'Cost', 'Kosten')]);
    expect(s.imports.sales).toBeDefined();
    renderAllTabs(s);
  });

  it('renamed required column (Material → Artikel) → report unknown, rest renders', async () => {
    const s = await stateFor([...ALL.filter((f) => f !== 'InventoryReport.xlsx').map(read), renameColumn('InventoryReport.xlsx', 'Material', 'Artikel')]);
    expect(s.imports.inventory).toBeUndefined();
    renderAllTabs(s);
  });
});
