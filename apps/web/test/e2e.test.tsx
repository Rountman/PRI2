// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, fireEvent, render } from '@testing-library/react';
import * as XLSX from 'xlsx';
import { afterEach, describe, expect, it } from 'vitest';
import { isKnown, parseReport } from '@copilot/engine';
import { createApp } from '../../server/src/app.ts';
import { Store } from '../../server/src/store.ts';
import type { StateResponse } from '../src/api.ts';
import { DRAWER_TABS, Shell } from '../src/App.tsx';

const FIX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures');
const ALL = fs.readdirSync(FIX).filter((f) => f.endsWith('.xlsx'));
const BASIC = ['InventoryReport.xlsx', 'SalesReport.xlsx', 'PriceMarket.xlsx'];

afterEach(cleanup);

// jsdom replaces FormData/File globals, so multipart is covered by the server test; here we ingest via the parser.
async function stateFor(files: { name: string; data: Uint8Array }[], preset?: 'intro' | 'extended'): Promise<StateResponse> {
  const store = new Store();
  if (preset) store.setSetting('config', { preset });
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

/** Main screen + every drawer tab renders. */
function renderAll(s: StateResponse) {
  const { container, unmount } = render(<Shell s={s} online lastOk={new Date()} />);
  expect(container.textContent).toContain('ERPsim');
  expect(container.querySelector('[data-testid=drawer]')).toBeNull();
  unmount();
  for (const t of DRAWER_TABS) {
    const r = render(<Shell s={s} online lastOk={new Date()} initialDrawer={t.id} />);
    expect(r.container.querySelector('[data-testid=drawer]')!.textContent!.length, `drawer ${t.id}`).toBeGreaterThan(20);
    r.unmount();
  }
}

describe('e2e: one screen', () => {
  it('(a) no data → Před hrou, 7 start recommendations in a table, A−, no "0 prodejů", no "Nahraj X"', async () => {
    const s = await stateFor([]);
    renderAll(s);
    const { container, getByTestId } = render(<Shell s={s} online lastOk={new Date()} />);
    const text = container.textContent!;
    expect(getByTestId('phase').textContent).toBe('Před hrou');
    expect(text).toContain('(A−)');
    const rows = getByTestId('findings').querySelectorAll('tbody tr');
    expect(rows).toHaveLength(7);
    // a report, not a to-do list: no step lists, no ✓ buttons; reasons only under (?)
    expect(container.querySelector('ol')).toBeNull();
    expect([...container.querySelectorAll('button')].some((b) => b.textContent?.includes('✓'))).toBe(false);
    expect(getByTestId('findings').querySelectorAll('[role=tooltip]')).toHaveLength(7);
    expect(getByTestId('findings').textContent).toContain('GG-F01');
    // status tables need data – before the game they are not shown
    expect(container.querySelector('[data-testid=products]')).toBeNull();
    expect(container.querySelector('[data-testid=channels]')).toBeNull();
    expect(text).not.toMatch(/0 prodejů|bez prodejů|Nahraj [A-Z]/);
    expect(getByTestId('chips').textContent).toMatch(/⚪ Sklad.*⚪ Prodeje.*⚪ Trh/);
    expect(getByTestId('md61').textContent).toMatch(/24\s000/);
    expect(getByTestId('vk32').textContent).toContain('7,20');
  });

  it('(b) 3 basic reports → status tables + recommendations, MD61 + VK32', async () => {
    const s = await stateFor(BASIC.map(read), 'intro');
    renderAll(s);
    const { container, getByTestId } = render(<Shell s={s} online={false} lastOk={new Date()} />);
    expect(container.textContent).toContain('offline');
    expect(getByTestId('phase').textContent).toBe('Mezi koly (po kole 3)');
    expect(getByTestId('chips').textContent).toMatch(/🟢 Sklad.*🟢 Prodeje.*🟢 Trh/);
    const n = getByTestId('findings').querySelectorAll('tbody tr').length;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(12);
    expect(getByTestId('products').textContent).toMatch(/vyprodáno|dochází/);
    expect(getByTestId('channels').textContent).toContain('DC 12');
    expect(getByTestId('plant').textContent).toContain('Suroviny');
    expect(getByTestId('market').textContent).toContain('GG-F13');
    expect(getByTestId('md61').textContent).toContain('F13');
  });

  it('(c) all 8 reports', async () => {
    const s = await stateFor(ALL.map(read), 'intro');
    renderAll(s);
    const { getByTestId } = render(<Shell s={s} online lastOk={new Date()} />);
    expect(getByTestId('valuation').textContent).toBe('77,4M');
  });

  it('opens the drawer from the top bar (no modal)', async () => {
    const s = await stateFor([]);
    const { getByTestId, container } = render(<Shell s={s} online lastOk={new Date()} />);
    fireEvent.click(getByTestId('advanced'));
    expect(container.querySelector('[data-testid=drawer]')).not.toBeNull();
    expect(container.querySelector('[role=dialog]')).toBeNull();
  });

  it.each(ALL)('without %s', async (skip) => {
    renderAll(await stateFor(ALL.filter((f) => f !== skip).map(read), 'intro'));
  });

  it('renamed optional column (SalesReport Cost → Kosten) still imports', async () => {
    const s = await stateFor([...ALL.filter((f) => f !== 'SalesReport.xlsx').map(read), renameColumn('SalesReport.xlsx', 'Cost', 'Kosten')], 'intro');
    expect(s.imports.sales).toBeDefined();
    renderAll(s);
  });

  it('renamed required column (Material → Artikel) → report unknown, rest renders', async () => {
    const s = await stateFor([...ALL.filter((f) => f !== 'InventoryReport.xlsx').map(read), renameColumn('InventoryReport.xlsx', 'Material', 'Artikel')], 'intro');
    expect(s.imports.inventory).toBeUndefined();
    renderAll(s);
  });
});
