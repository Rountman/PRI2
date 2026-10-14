import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import fs from 'node:fs';
import path from 'node:path';
import { parseNumber } from '../src/numbers.ts';
import { normArea, parseRoundDay, splitMaterial, toGameDay } from '../src/normalize.ts';
import { detectKind, isKnown, parseReport, readWorkbook } from '../src/parse/index.ts';
import { applyResults, datasetFrom, latestGameDay } from '../src/dataset.ts';
import type { SalesRow } from '../src/types.ts';
import { FIXTURES, FIXTURE_FILES, loadFixture } from './helpers.ts';

const EXPECTED: Record<string, string> = {
  'Company-Valuation.xlsx': 'valuation',
  'PriceMarket.xlsx': 'market',
  'SalesReport.xlsx': 'sales',
  'SummarySalesReport.xlsx': 'summary',
  'InventoryReport.xlsx': 'inventory',
  'ProductionReport.xlsx': 'production',
  'ProcSourcing.xlsx': 'sourcing',
  'PurchaseOrderTracking.xlsx': 'purchases',
};

const gridToTsv = (grid: unknown[][]) => grid.map((r) => r.map((c) => (c === null ? '' : String(c))).join('\t')).join('\n');

describe('numbers', () => {
  it.each([
    ['1.234,56', 'de', 1234.56],
    ['1,234.56', 'en', 1234.56],
    ['75,000-', 'en', -75000],
    ['3,376,340.64 EUR', 'en', 3376340.64],
    ['-326,988.00', 'en', -326988],
    ['1 234,5', 'de', 1234.5],
    ['4,02', 'en', 4.02],
    ['29.478', 'de', 29478],
    ['(1,000.00)', 'en', -1000],
    ['', 'en', null],
    ['Unscheduled', 'en', null],
  ] as const)('%s (%s) → %s', (s, loc, exp) => {
    expect(parseNumber(s, loc)).toBe(exp);
  });
});

describe('normalize', () => {
  it('material, area, game day', () => {
    expect(splitMaterial('GG-F12')).toEqual({ material: 'F12', teamCode: 'GG' });
    expect(splitMaterial('F12')).toEqual({ material: 'F12', teamCode: '' });
    expect(normArea('NO')).toBe('N');
    expect(normArea('North')).toBe('N');
    expect(normArea('WE')).toBe('W');
    expect(parseRoundDay('03/04')).toEqual({ round: 3, day: 4 });
    expect(parseRoundDay('Unscheduled')).toBeNull();
    expect(toGameDay(3, 4, 20)).toBe(44);
  });
});

describe('autodetect fixtures', () => {
  it('all 8 fixtures present', () => expect(FIXTURE_FILES.sort()).toEqual(Object.keys(EXPECTED).sort()));
  it.each(Object.entries(EXPECTED))('%s → %s (xlsx and TSV paste)', (file, kind) => {
    const r = loadFixture(file);
    expect(r.kind).toBe(kind);
    expect(r.rows.length).toBeGreaterThan(0);
    const grid = readWorkbook(fs.readFileSync(path.join(FIXTURES, file)));
    const tsv = parseReport(gridToTsv(grid), { roundLength: 20 });
    expect(tsv.kind).toBe(kind);
    if (isKnown(tsv)) expect(tsv.rows).toEqual(r.rows);
  });

  it('shuffled columns, extra junk row above header, extra column', () => {
    const grid = readWorkbook(fs.readFileSync(path.join(FIXTURES, 'SalesReport.xlsx')));
    const order = grid[0].map((_, i) => i).reverse();
    const shuffled = [['Export z Fiori'], ...grid.map((r) => [...order.map((i) => r[i]), 'x'])];
    shuffled[1][shuffled[1].length - 1] = 'Extra';
    const r = parseReport(gridToTsv(shuffled), { roundLength: 20 });
    expect(r.kind).toBe('sales');
    if (isKnown(r)) expect(r.rows).toEqual(loadFixture('SalesReport.xlsx').rows);
  });

  it('German locale paste', () => {
    const tsv = 'Simulation Round\tSimulation Step\tCompany Valuation\n03\t20\t77.388.994,40\n03\t19\t1.234,5';
    const r = parseReport(tsv, { roundLength: 20 });
    expect(r.kind).toBe('valuation');
    if (isKnown(r)) expect(r.rows.map((x: any) => x.valuation)).toEqual([77388994.4, 1234.5]);
  });

  it('unknown header → mapping needed, then profile works', () => {
    const tsv = 'Kolo\tDen\tHodnota\n03\t20\t100';
    const r = parseReport(tsv, { roundLength: 20 });
    expect(r.kind).toBeNull();
    const profile = { signature: (r as any).signature, kind: 'valuation' as const, columns: { round: 'Kolo', step: 'Den', valuation: 'Hodnota' } };
    const r2 = parseReport(tsv, { roundLength: 20, profiles: [profile] });
    expect(r2.kind).toBe('valuation');
    if (isKnown(r2)) expect(r2.rows[0]).toMatchObject({ gameDay: 60, valuation: 100 });
  });

  it('renamed optional column only warns', () => {
    const tsv = 'Round\tDay\tMaterial\tQuantity\tNet Value\tKosten\n01\t01\tGG-F01\t10\t40\t9';
    const r = parseReport(tsv, { roundLength: 20 });
    expect(r.kind).toBe('summary');
    expect(r.warnings.join(' ')).toContain('Cost');
  });

  it('garbage bytes never throw', () => {
    expect(parseReport(new Uint8Array([0x50, 0x4b, 1, 2, 3, 4]), { roundLength: 20 }).kind).toBeNull();
    expect(detectKind([])).toBeNull();
  });
});

describe('checksums (CLAUDE.md 4.5)', () => {
  it('SalesReport quantity per round = 232 372 / 218 099 / 213 898', () => {
    const rows = loadFixture('SalesReport.xlsx').rows as SalesRow[];
    const byRound = [1, 2, 3].map((r) => rows.filter((x) => x.round === r).reduce((a, x) => a + x.quantity, 0));
    expect(byRound).toEqual([232372, 218099, 213898]);
  });

  it('SummarySales totals equal SalesReport', () => {
    const sales = loadFixture('SalesReport.xlsx').rows as SalesRow[];
    const summ = loadFixture('SummarySalesReport.xlsx').rows as any[];
    for (const r of [1, 2, 3]) {
      const s = sales.filter((x) => x.round === r);
      const m = summ.filter((x) => x.round === r);
      expect(m.reduce((a, x) => a + x.quantity, 0)).toBe(s.reduce((a, x) => a + x.quantity, 0));
      expect(m.reduce((a, x) => a + x.netValue, 0)).toBeCloseTo(s.reduce((a, x) => a + x.netValue, 0), 2);
    }
  });

  it('valuation at end of round 3 = 77 388 994,40', () => {
    const v = loadFixture('Company-Valuation.xlsx').rows as any[];
    expect(v.find((x) => x.gameDay === 60)!.valuation).toBeCloseTo(77388994.4, 2);
    expect(v).toHaveLength(60);
  });

  it('28 production orders, inventory 22 rows, PO lines', () => {
    expect(loadFixture('ProductionReport.xlsx').rows).toHaveLength(28);
    expect(loadFixture('InventoryReport.xlsx').rows).toHaveLength(22);
    const po = loadFixture('PurchaseOrderTracking.xlsx').rows as any[];
    expect(po).toHaveLength(57);
    expect(po.find((p) => p.order === '4500000300')!.reception).toBe(44);
  });

  it('sales normalisation: DC as string, area enum, team code', () => {
    const s = loadFixture('SalesReport.xlsx').rows as SalesRow[];
    expect(new Set(s.map((x) => x.dc))).toEqual(new Set(['12']));
    expect(new Set(s.map((x) => x.area))).toEqual(new Set(['N', 'S', 'W']));
    expect(s[0]).toMatchObject({ teamCode: 'GG', location: '02' });
  });
});

describe('dataset upsert', () => {
  it('re-import is idempotent; partial export does not erase history', () => {
    const sales = loadFixture('SalesReport.xlsx');
    const ds = datasetFrom([sales]);
    const again = applyResults(ds, [sales]);
    expect(again.sales).toHaveLength(ds.sales.length);
    const onlyR3 = { ...sales, rows: sales.rows.filter((r: any) => r.round === 3), keys: sales.keys.filter((_, i) => (sales.rows[i] as any).round === 3) };
    expect(applyResults(ds, [onlyR3]).sales).toHaveLength(ds.sales.length);
  });

  it('latest game day ignores zero future rows of SummarySales', () => {
    const ds = datasetFrom([loadFixture('SummarySalesReport.xlsx'), loadFixture('Company-Valuation.xlsx')]);
    expect(latestGameDay(ds)).toBe(60);
  });

  it('xlsx built in memory parses as well', () => {
    const ws = XLSX.utils.aoa_to_sheet([['Vendor', 'Material', 'Gross Price', 'Source'], ['V01', 'GG-R06', 0.8, 'X']]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'x');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const r = parseReport(buf, { roundLength: 20 });
    expect(r.kind).toBe('sourcing');
  });
});
