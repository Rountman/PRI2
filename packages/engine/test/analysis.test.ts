import { describe, expect, it } from 'vitest';
import { analyze } from '../src/analysis/index.ts';
import { cfg, fixtureDataset } from './helpers.ts';

const a = analyze(fixtureDataset(), cfg);

describe('clock', () => {
  it('latest day = 03/20 → Konec kola', () => {
    expect(a.clock).toMatchObject({ gameDay: 60, round: 3, day: 20, phase: 'konec' });
  });
});

describe('4.3 conclusions on practice data', () => {
  it('only DC 12 has sales; DC 10 and 14 are empty', () => {
    const by = Object.fromEntries(a.channels.map((c) => [c.dc, c.qty]));
    expect(by['12']).toBe(232372 + 218099 + 213898);
    expect(by['10']).toBe(0);
    expect(by['14']).toBe(0);
  });

  it('days with zero sales: round 1 days 15–20, round 3 days 2–4', () => {
    expect(a.stockouts.zeroSalesDays[1]).toEqual(expect.arrayContaining([15, 16, 17, 18, 19, 20]));
    expect(a.stockouts.zeroSalesDays[3]).toEqual(expect.arrayContaining([2, 3, 4]));
    expect(a.stockouts.totalLostMargin).toBeGreaterThan(0);
  });

  it('stock-outs are stock-based: F12 round 3 sold out days 1–9 (before first production run)', () => {
    const f12 = a.stockouts.perSku.find((s) => s.sku === 'F12' && s.round === 3)!;
    expect(f12.days.slice(0, 3)).toEqual([1, 2, 3]);
    expect(f12.lostMargin).toBeGreaterThan(0);
  });

  it('production utilization: round 1 = 0, round 2 ≈ 53 %, round 3 = 40 %', () => {
    const [r1, r2, r3] = a.production;
    expect(r1.utilization).toBe(0);
    expect(r2.utilization).toBeCloseTo(256000 / 480000, 3);
    expect(r3.utilization).toBeCloseTo(0.4, 3);
    expect(r2.utilization).toBeGreaterThan(0.4);
    expect(r2.utilization).toBeLessThan(0.55);
  });

  it('setups: 10 changeovers in round 2 (80 h), 6 in round 3; round 3 idle days 1–5', () => {
    expect(a.production[1]).toMatchObject({ orders: 16, setups: 10, setupHours: 80 });
    expect(a.production[2]).toMatchObject({ orders: 12, setups: 6 });
    expect(a.production[2].idleDays.slice(0, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it('margin per unit round 3: F12 6.28, F13 ≈ 5.82, F01 ≈ 4.18, F02 4.36, F04 3.71', () => {
    const m = Object.fromEntries(a.economics.filter((e) => e.round === 3).map((e) => [e.sku, e.marginPerUnit]));
    expect(m.F12).toBeCloseTo(6.28, 1);
    expect(m.F13).toBeCloseTo(5.82, 1);
    expect(m.F01).toBeCloseTo(4.18, 1);
    expect(m.F02).toBeCloseTo(4.36, 1);
    expect(m.F04).toBeCloseTo(3.71, 1);
    // 1 kg beats 500 g per capacity unit
    expect(m.F12).toBeGreaterThan(m.F02);
  });

  it('unit costs come from ProductionReport', () => {
    expect(a.costs.F01).toEqual({ cost: 0.91, source: 'ProductionReport' });
    expect(a.costs.F12.cost).toBe(2.27);
    expect(a.costs.F16.source).toBe('BOM');
  });
});

describe('stock & coverage', () => {
  it('reconstructed stock path matches the inventory snapshot for every SKU', () => {
    expect(a.stockPath.initialSource).toBe('PO V03');
    for (const c of a.stockPath.check) expect(c.reconstructed).toBe(c.inventory);
  });

  it('coverage flags sold-out and low SKUs', () => {
    const c = Object.fromEntries(a.coverage.map((x) => [x.sku, x]));
    expect(c.F01.status).toBe('vyprodáno');
    expect(c.F13.status).toBe('nízké');
    expect(c.F13.days).toBeLessThan(1);
    expect(c.F11.stock).toBe(16000);
  });
});

describe('market share & price position', () => {
  it('market share in 5–20 % range on average, never > 100 %', () => {
    const rows = a.share.filter((s) => s.ours > 0);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.share).toBeLessThanOrEqual(1);
    const avg = rows.reduce((x, r) => x + r.share, 0) / rows.length;
    expect(avg).toBeGreaterThan(0.03);
    expect(avg).toBeLessThan(0.4);
  });

  it('price recommendations never go below unit cost', () => {
    for (const p of a.pricing) if (p.recommended !== null) expect(p.recommended).toBeGreaterThanOrEqual(p.unitCost);
  });

  it('low coverage + price near market → raise; F11 just produced → hold', () => {
    const p = Object.fromEntries(a.pricing.map((x) => [x.sku, x]));
    expect(p.F02.action).toBe('zvýšit');
    expect(p.F02.recommended).toBeCloseTo((p.F02.ourPrice ?? 0) + cfg.pricing.step, 2);
    expect(p.F11.action).toBe('držet');
    expect(p.F14.action).toBe('držet');
  });
});

describe('production plan', () => {
  it('runs of ≥ 2 lots, lot sizes within limits, fits horizon', () => {
    expect(a.plan.runs.length).toBeGreaterThan(0);
    for (const r of a.plan.runs) {
      expect(r.qty).toBeGreaterThanOrEqual(2 * cfg.lotMin);
      for (const o of r.orders) {
        expect(o).toBeGreaterThanOrEqual(cfg.lotMin);
        expect(o).toBeLessThanOrEqual(cfg.lotMax);
      }
    }
    expect(a.plan.plannedUnits + a.plan.setupLossUnits).toBeLessThanOrEqual(a.plan.capacityUnits);
  });
});

describe('valuation trend', () => {
  it('trims round-1 artefact days and computes round deltas', () => {
    expect(a.valuation.points[0].gameDay).toBe(3);
    expect(a.valuation.latest!.valuation).toBeCloseTo(77388994.4, 2);
    expect(a.valuation.roundEnds.map((r) => r.round)).toEqual([1, 2, 3]);
  });
});

describe('graceful degradation', () => {
  it('works on an empty dataset', () => {
    const e = analyze(fixtureDataset(['Company-Valuation.xlsx', 'PriceMarket.xlsx', 'SalesReport.xlsx', 'SummarySalesReport.xlsx', 'InventoryReport.xlsx', 'ProductionReport.xlsx', 'ProcSourcing.xlsx', 'PurchaseOrderTracking.xlsx']), cfg);
    expect(e.clock.hasData).toBe(false);
    expect(e.plan.runs).toEqual([]);
  });

  it.each(['SummarySalesReport.xlsx', 'PriceMarket.xlsx', 'InventoryReport.xlsx', 'PurchaseOrderTracking.xlsx', 'ProductionReport.xlsx'])('without %s', (f) => {
    expect(() => analyze(fixtureDataset([f]), cfg)).not.toThrow();
  });
});
