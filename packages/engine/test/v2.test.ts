import { describe, expect, it } from 'vitest';
import { resolveConfig } from '@copilot/config';
import { analyze } from '../src/analysis/index.ts';
import { buildSnapshot } from '../src/engine.ts';
import { emptyDataset, type ActionCard, type Dataset } from '../src/types.ts';
import { selectCards } from '../src/v2/cards.ts';
import { setupMarginalTable } from '../src/v2/invest.ts';
import { cutLots } from '../src/v2/lotsize.ts';
import { buildModel, dailyDemand } from '../src/v2/model.ts';
import { cfg, fixtureDataset } from './helpers.ts';

const ext = resolveConfig();
const BASIC = ['InventoryReport.xlsx', 'SalesReport.xlsx', 'PriceMarket.xlsx'];
const ALL = ['Company-Valuation.xlsx', 'InventoryReport.xlsx', 'PriceMarket.xlsx', 'ProcSourcing.xlsx', 'ProductionReport.xlsx', 'PurchaseOrderTracking.xlsx', 'SalesReport.xlsx', 'SummarySalesReport.xlsx'];
const only = (files: string[]) => fixtureDataset(ALL.filter((f) => !files.includes(f)));

describe('lot size (guide table)', () => {
  it.each([
    [1, [16_000]],
    [15_500, [16_000]],
    [16_001, [17_000]],
    [40_000, [40_000]],
    [47_500, [48_000]],
    [48_001, [48_000, 16_000]],
    [0, []],
    [-5, []],
    [100_000, [48_000, 48_000, 16_000]],
  ])('%d → %j', (q, lots) => expect(cutLots(q, ext)).toEqual(lots));
});

describe('Před hrou (no data)', () => {
  const s = buildSnapshot(emptyDataset(), ext);

  it('phase, rating, 7 checklist cards', () => {
    expect(s.clock.phase).toBe('pred-hrou');
    expect(s.clock.label).toBe('Před hrou');
    expect(s.header.rating).toBe('A−');
    expect(s.header.discount).toBeCloseTo(0.1225, 10);
    expect(s.cards).toHaveLength(7);
    expect(s.cards.every((c) => c.kind === 'checklist')).toBe(true);
  });

  it('never claims "0 prodejů" or asks to upload', () => {
    const text = JSON.stringify(s.cards);
    expect(text).not.toMatch(/0 prodejů|bez prodejů|Nahraj [A-Z]/);
  });

  it('MD61 first cycle: 4 × 48 000, materials within limits', () => {
    expect(s.md61.rows.map((r) => [r.sku, r.forecast, r.lots])).toEqual([
      ['F02', 48_000, [48_000]],
      ['F03', 48_000, [48_000]],
      ['F12', 48_000, [48_000]],
      ['F13', 48_000, [48_000]],
    ]);
    expect(s.md61.materials.rawKg).toBe(144_000);
    expect(s.md61.materials.packaging).toBe(384_000);
    expect(s.md61.materials.cost).toBeGreaterThan(250_000);
    expect(s.md61.materials.cost).toBeLessThan(400_000);
    expect(s.md61.materials.ok).toBe(true);
    expect(s.md61.capacity.units / s.md61.capacity.perDay).toBe(8);
    expect(s.md61.capacity.setups).toBe(4);
  });

  it('VK32 start prices only where the pack may be sold', () => {
    const cells = Object.fromEntries(s.vk32.rows.map((r) => [r.sku, Object.fromEntries(r.cells.map((c) => [c.dc, c.recommended]))]));
    expect(cells.F02).toEqual({ '12': 5.2, '14': 5.5 });
    expect(cells.F12).toEqual({ '10': 7.2, '12': 7.5 });
  });

  it('setup reduction recommends 125k (→ 6 h) with default inputs', () => {
    const card = s.cards.find((c) => c.id === 'start:4-setup')!;
    expect(card.copyValues![0].value).toBe('125000');
  });

  it('sortiment and start prices come from settings', () => {
    const s2 = buildSnapshot(emptyDataset(), resolveConfig({ assortment: ['F01', 'F11'], startPrices: { overrides: { 'F11:10': 8.88 } } }));
    expect(s2.md61.rows.map((r) => r.sku)).toEqual(['F01', 'F11']);
    expect(s2.vk32.rows[1].cells.find((c) => c.dc === '10')!.recommended).toBe(8.88);
  });
});

describe('team code (SAP material GG-F01)', () => {
  it('preset GG → all SAP texts use GG-Fxx', () => {
    const s = buildSnapshot(emptyDataset(), ext);
    expect(s.md61.rows.map((r) => r.mat)).toEqual(['GG-F02', 'GG-F03', 'GG-F12', 'GG-F13']);
    expect(s.cards[0].title).toBe('1. Sortiment: GG-F02, GG-F03, GG-F12, GG-F13');
    expect(s.cards.find((c) => c.id === 'start:5-md61')!.copyValues![0]).toEqual({ label: 'GG-F02', value: '48000' });
    expect(s.vk32.rows[0].mat).toBe('GG-F02');
  });

  it('empty team code → detected from our reports', () => {
    const s = buildSnapshot(fixtureDataset(), resolveConfig({ preset: 'intro', teamCode: '' }));
    expect(s.md61.rows[0].mat).toMatch(/^GG-F\d\d$/);
  });
});

describe('setup marginal table', () => {
  it('stops at the first step below payback', () => {
    const t = setupMarginalTable(ext, { currentSpend: 0, changeoversPerRound: 10, marginPerUnit: 4.5, remainingRounds: 4 });
    expect(t.map((x) => x.to)).toEqual([50_000, 125_000, 250_000, 500_000, 1_250_000]);
    expect(t[0].savedHours).toBeCloseTo(1, 10);
    expect(t.filter((x) => x.recommended).map((x) => x.to)).toEqual([50_000, 125_000]);
  });
});

describe('demand (5.1)', () => {
  const ds = fixtureDataset();
  const a = analyze(ds, cfg);

  it('averages only in-stock days, boosts after ≥ 2 stock-out days', () => {
    const f01 = dailyDemand(ds, cfg, 60, a.stockPath, 'F01');
    expect(f01.source).toBe('prodeje');
    expect(f01.perDay).toBeGreaterThan(0);
    if (f01.stockoutDays >= 2) expect(f01.perDay).toBeCloseTo(f01.base * 1.2, 6);
    else expect(f01.perDay).toBe(f01.base);
  });

  it('no history → preset (team market / start price)', () => {
    const d = dailyDemand(emptyDataset(), ext, 0, analyze(emptyDataset(), ext).stockPath, 'F12');
    expect(d.source).toBe('preset');
    expect(d.byDc['10']).toBeCloseTo(90_000 / 5 / 2 / 7.2, 6);
    expect(d.byDc['12']).toBeCloseTo(360_000 / 5 / 4 / 7.5, 6);
  });
});

function check(ds: Dataset) {
  const s = buildSnapshot(ds, cfg);
  expect(s.errors).toEqual([]);
  // MD61 never exceeds capacity × H
  expect(s.md61.capacity.used).toBeLessThanOrEqual(s.md61.capacity.available + 1e-6);
  for (const r of s.md61.rows) {
    for (const l of r.lots) {
      expect(l).toBeGreaterThanOrEqual(cfg.lotMin);
      expect(l).toBeLessThanOrEqual(cfg.lotMax);
    }
    expect(r.lots).toEqual(cutLots(r.forecast - r.stock - r.wip, cfg));
    expect(r.forecast % 1000).toBe(0);
  }
  // prices never below unit cost
  for (const r of s.vk32.rows) for (const c of r.cells) expect(c.recommended).toBeGreaterThanOrEqual(r.unitCost);
  // max 5 cards, max 2 critical
  expect(s.cards.length).toBeLessThanOrEqual(5);
  expect(s.cards.filter((c) => c.priority === 'kritické').length).toBeLessThanOrEqual(2);
  return s;
}

describe('fixtures (intro preset)', () => {
  it('all 8 reports', () => {
    const s = check(fixtureDataset());
    expect(s.clock.label).toBe('Kolo 3 · den 20/20');
    expect(s.header.valuation).toBeCloseTo(77_388_994.4, 1);
    expect(s.md61.wipKnown).toBe(true);
    expect(s.cards.length).toBeGreaterThan(0);
  });

  it('3 basic reports only', () => {
    const s = check(only(BASIC));
    expect(s.md61.wipKnown).toBe(false);
    expect(s.md61.rows.length).toBeGreaterThan(0);
    expect(s.vk32.rows.some((r) => r.anchor !== null)).toBe(true);
  });

  it.each(ALL)('without %s', (f) => {
    check(fixtureDataset([f]));
  });

  it('SKU cut to zero by capacity: no critical "MD61 = x" card, MD61 notes only on the cut SKU', () => {
    const s = buildSnapshot(only(BASIC), cfg);
    const zero = s.md61.rows.filter((r) => r.planned === 0 && r.cut).map((r) => r.mat);
    expect(zero.length).toBeGreaterThan(0);
    for (const c of s.cards) {
      for (const z of zero) {
        if (!c.title.startsWith(z)) continue;
        expect(c.priority).toBe('běžné');
        expect(c.title).toMatch(/kapacita plná/);
        expect(c.title).not.toMatch(/MD61/);
      }
      for (const st of c.steps.filter((x) => x.startsWith('Kapacita:'))) expect(c.steps.some((x) => x.startsWith(`MD61 ${st.split(' ')[1]}`))).toBe(true);
    }
  });

  it('tight capacity cuts the lowest-margin SKU first', () => {
    const tight = resolveConfig({ preset: 'intro', capacityPerDay: 8_000 });
    const s = buildSnapshot(fixtureDataset(), tight);
    expect(s.md61.capacity.used).toBeLessThanOrEqual(s.md61.capacity.available);
    expect(s.md61.capacity.cut.length).toBeGreaterThan(0);
    const m = buildModel(fixtureDataset(), tight, analyze(fixtureDataset(), tight));
    const firstCut = s.md61.capacity.cut[0];
    const plannedMargins = s.md61.rows.filter((r) => r.forecast > 0 || r.cut).map((r) => m.margin[r.sku]);
    expect(m.margin[firstCut]).toBe(Math.min(...plannedMargins));
  });

  it('price below unit cost → critical alert and recommendation at the floor', () => {
    const ds = fixtureDataset();
    const cheap = { ...ds, sales: ds.sales.map((r) => (r.material === 'F12' && r.gameDay > 45 ? { ...r, netValue: r.quantity * 1.0 } : r)) };
    const s = buildSnapshot(cheap, cfg);
    const f12 = s.vk32.rows.find((r) => r.sku === 'F12')!;
    expect(f12.cells.some((c) => c.belowCost)).toBe(true);
    for (const c of f12.cells) expect(c.recommended).toBeGreaterThanOrEqual(f12.unitCost);
  });
});

describe('card selection', () => {
  const mk = (id: string, priority: ActionCard['priority'], profit: number): ActionCard => ({ id, kind: 'x', priority, title: id, profitEUR: profit, tcode: 'X', steps: [], why: { summary: '', data: [], rule: '', confidence: 'odhad' } });
  it('max 5, max 2 critical, critical first then by €', () => {
    const out = selectCards([mk('a', 'kritické', 1), mk('b', 'kritické', 50), mk('c', 'kritické', 30), mk('d', 'běžné', 100), mk('e', 'běžné', 5), mk('f', 'běžné', 2), mk('g', 'běžné', 1)], 5, 2);
    expect(out.map((c) => c.id)).toEqual(['b', 'c', 'd', 'e', 'f']);
    expect(out.filter((c) => c.priority === 'kritické')).toHaveLength(2);
  });
});
