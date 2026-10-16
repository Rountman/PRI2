import { describe, expect, it } from 'vitest';
import { resolveConfig } from '@copilot/config';
import { priceList, sapBom, unitCostFromBom, unitCostSplit } from '../src/bom.ts';
import { emptyDataset } from '../src/types.ts';

const cfg = resolveConfig();
const prices = priceList(emptyDataset(), cfg);
const sap = (sku: string) => sapBom(sku, cfg).map((l) => [l.material, l.qty, l.unit]);

// Live game GG, plant G2, ZCS02 screenshots (2026-10-16)
describe('BOM = live SAP ZCS02 (incl. packaging)', () => {
  it.each([
    ['F01', 'R01'],
    ['F02', 'R02'],
    ['F03', 'R03'],
    ['F04', 'R04'],
  ])('500 g %s: bag P04, box P03, oats 0.175, wheat 0.175, %s 0.150', (sku, flavor) => {
    expect(sap(sku)).toEqual([
      ['P04', 1, 'ST'],
      ['P03', 1, 'ST'],
      ['R06', 0.175, 'KG'],
      ['R05', 0.175, 'KG'],
      [flavor, 0.15, 'KG'],
    ]);
  });

  it.each([
    ['F11', 'R01'],
    ['F12', 'R02'],
    ['F13', 'R03'],
    ['F14', 'R04'],
  ])('1 kg %s: bag P02, box P01, oats 0.350, wheat 0.350, %s 0.300', (sku, flavor) => {
    expect(sap(sku)).toEqual([
      ['P02', 1, 'ST'],
      ['P01', 1, 'ST'],
      ['R06', 0.35, 'KG'],
      ['R05', 0.35, 'KG'],
      [flavor, 0.3, 'KG'],
    ]);
  });

  it('unit cost includes packaging', () => {
    const c = unitCostSplit('F01', cfg, prices);
    expect(c.packaging).toBeCloseTo(prices.P03.price + prices.P04.price, 6);
    expect(c.total).toBeCloseTo(unitCostFromBom('F01', cfg, prices), 6);
    expect(unitCostSplit('F12', cfg, prices).packaging).toBeCloseTo(prices.P01.price + prices.P02.price, 6);
  });
});
