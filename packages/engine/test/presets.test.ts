import { describe, expect, it } from 'vitest';
import { DEFAULT_PRESET, fixedPerDay, PRESETS, resolveConfig, setupHours } from '@copilot/config';
import { buildSnapshot } from '../src/engine.ts';
import { emptyDataset } from '../src/types.ts';

const ext = PRESETS.extended;

describe('preset extended (CLAUDE.md kap. 2)', () => {
  it('is the default', () => {
    expect(DEFAULT_PRESET).toBe('extended');
    expect(resolveConfig().preset).toBe('extended');
  });

  it('values from the briefing / job aid', () => {
    expect(ext.initial).toEqual({ cash: 2_000_000, loan: 8_000_000, machines: 24_000_000, finishedGoodsPerSku: 0 });
    expect(ext.capacityPerDay).toBe(24_000);
    expect(ext.capacityCostPer1000).toBe(1_000_000);
    expect(setupHours(ext)).toBe(8);
    expect([ext.lotMin, ext.lotMax, ext.lotRounding]).toEqual([16_000, 48_000, 16_000]);
    const f = ext.fixedCosts;
    expect(f.labor + f.overhead + f.sga + f.depBuilding + f.depMachines).toBe(126_250);
    expect(f.periodDays).toBe(5);
    expect(fixedPerDay(ext)).toBeCloseTo(126_250 / 5 + 2_644.8, 6);
    expect(ext.storage).toEqual({ finishedGoods: 250_000, raw: 250_000, packaging: 750_000 });
    expect(ext.storageExtraPerDay).toEqual({ finishedGoods: 500, raw: 1_000, packaging: 100 });
    expect(ext.channels.map((c) => [c.dc, c.sizes, c.marketPer5DaysPerTeam])).toEqual([
      ['10', ['1kg'], 90_000],
      ['12', ['500g', '1kg'], 220_000],
      ['14', ['500g'], 130_000],
    ]);
    expect(ext.recipeMin).toMatchObject({ oats: 0.3, wheat: 0.2, flavor: 0.2, mixedFruitNuts: 0.3 });
    expect(ext.recipes['2']).toEqual({ R06: 0.35, R05: 0.35, R02: 0.3 });
    expect(ext.rounds).toBe(5);
    expect(ext.defaultRating).toBe('A−');
    expect(ext.assortment).toEqual(['F01', 'F02', 'F03', 'F04', 'F11', 'F12', 'F13', 'F14']);
    expect([ext.assortmentTarget, ext.assortmentAuto]).toEqual([5, true]);
    expect(ext.md61.firstCycleQty).toEqual({ '500g': 16_000, '1kg': 16_000 });
  });

  it('snapshot', () => {
    expect(ext).toMatchSnapshot();
  });

  it('setup table 50k→7 h, 125k→6, 250k→5, 500k→4, 1,25M→3', () => {
    expect([50_000, 125_000, 250_000, 500_000, 1_250_000].map((s) => setupHours(ext, s))).toEqual([7, 6, 5, 4, 3]);
  });

  it('no data → A− / 12,25 % (not AAA+ / 10 %)', () => {
    const s = buildSnapshot(emptyDataset(), resolveConfig());
    expect(s.header.rating).toBe('A−');
    expect(s.header.discount).toBeCloseTo(0.1225, 10);
    expect(s.header.valuation).toBeNull();
  });
});
