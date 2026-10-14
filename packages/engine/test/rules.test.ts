import { describe, expect, it } from 'vitest';
import { analyze } from '../src/analysis/index.ts';
import { bomFor, cheapestRecipe, priceList, recipeCostPerKg, unitCostFromBom, validateRecipe } from '../src/bom.ts';
import { buildSnapshot } from '../src/engine.ts';
import { makeCtx, RULES, runRules } from '../src/rules/index.ts';
import type { ActionCard } from '../src/types.ts';
import { cfg, fixtureDataset } from './helpers.ts';

const ds = fixtureDataset();
const a = analyze(ds, cfg);
const ctx = makeCtx(ds, cfg, a);
const rule = (id: string) => RULES.find((r) => r.meta.id === id)!;
const at = (phase: 'pred' | 'start' | 'beh' | 'konec', day: number) => {
  const an = analyze(ds, cfg, { gameDay: 40 + day, betweenRounds: phase === 'pred' });
  return makeCtx(ds, cfg, an);
};

function expectValidCard(c: ActionCard) {
  expect(c.id).toMatch(/^R\d+b?/);
  expect(c.title.length).toBeGreaterThan(5);
  expect(c.tcode).toBeTruthy();
  expect(c.steps.length).toBeGreaterThan(0);
  expect(c.steps.join(' ')).not.toMatch(/\{\w+\}/); // all placeholders filled
  expect(c.why.rule).toMatch(/^R\d+b? /);
  expect(c.why.summary).toBeTruthy();
  expect(['jisté', 'pravděpodobné', 'odhad']).toContain(c.why.confidence);
  if (c.impactEUR !== undefined) expect(Number.isFinite(c.impactEUR)).toBe(true);
}

describe('BOM from ProcSourcing prices', () => {
  const prices = priceList(ds, cfg);
  it('prices come from ProcSourcing', () => {
    expect(prices.R06).toEqual({ price: 0.92, vendor: 'V01', source: 'ProcSourcing' });
    expect(prices.P01.vendor).toBe('V02');
  });
  it('unit cost F01 = 0.91, F12 = 2.27', () => {
    expect(unitCostFromBom('F01', cfg, prices)).toBeCloseTo(0.91, 2);
    expect(unitCostFromBom('F12', cfg, prices)).toBeCloseTo(2.27, 2);
  });
  it('BOM matches Unit Cost of every production order', () => {
    for (const p of ds.production) expect(unitCostFromBom(p.material, cfg, prices)).toBeCloseTo(p.unitCost, 2);
  });
  it('500 g Nut = 0.175 oats, 0.175 wheat, 0.150 nuts + box + bag', () => {
    expect(bomFor('F01', cfg)).toEqual([
      { material: 'R06', qty: 0.175, unit: 'KG' },
      { material: 'R05', qty: 0.175, unit: 'KG' },
      { material: 'R01', qty: 0.15, unit: 'KG' },
      { material: 'P03', qty: 1, unit: 'ST' },
      { material: 'P04', qty: 1, unit: 'ST' },
    ]);
  });
  it('cheapest valid recipe = 60 % oats / 20 % wheat / 20 % flavor; F12 saves ≈ 0.32 €/ks', () => {
    const best = cheapestRecipe('2', cfg, prices);
    expect(best).toEqual({ R06: 0.6, R05: 0.2, R02: 0.2 });
    expect(validateRecipe('2', best, cfg)).toEqual([]);
    expect(recipeCostPerKg(cfg.recipes['2'], prices) - recipeCostPerKg(best, prices)).toBeCloseTo(0.3185, 3);
    expect(validateRecipe('6', cheapestRecipe('6', cfg, prices), cfg)).toEqual([]);
    expect(validateRecipe('2', { R06: 0.7, R05: 0.2, R02: 0.1 }, cfg)).not.toEqual([]);
  });
});

describe('rules on practice data (end of round 3)', () => {
  it('R3 reports DC 10 and DC 14 without sales', () => {
    const cards = rule('R3').run(ctx);
    expect(cards.map((c) => c.id).sort()).toEqual(['R3:DC10', 'R3:DC14']);
    const dc10 = cards.find((c) => c.id === 'R3:DC10')!;
    expect(dc10.steps.join(' ')).toMatch(/F1\d/); // only 1 kg in DC 10
    expect(dc10.steps.join(' ')).not.toMatch(/F0\d/);
    const dc14 = cards.find((c) => c.id === 'R3:DC14')!;
    expect(dc14.steps.join(' ')).not.toMatch(/F1\d/);
    cards.forEach(expectValidCard);
  });

  it('R4 critical: raw material stock is empty', () => {
    const [c] = rule('R4').run(ctx);
    expect(c.priority).toBe('kritické');
    expect(c.steps.join(' ')).toMatch(/R06 Oats/);
    expect(c.steps.join(' ')).toMatch(/V01/);
    expect(c.steps.join(' ')).toMatch(/V02/);
    // packaging rounded to whole lots
    for (const v of c.copyValues!.filter((x) => x.label.startsWith('P'))) expect(Number(v.value) % cfg.lotMin).toBe(0);
    expectValidCard(c);
  });

  it('R4b and R11 stay silent while R4 already fires', () => {
    expect(rule('R4b').run(ctx)).toEqual([]);
    expect(rule('R11').run(ctx)).toEqual([]);
  });

  it('R5: no open production order at day 60 → critical', () => {
    const [c] = rule('R5').run(ctx);
    expect(c.priority).toBe('kritické');
    expectValidCard(c);
  });

  it('R1: round 2 had 10 changeovers > 6', () => {
    const [c] = rule('R1').run(ctx);
    expect(c.id).toBe('R1:r2');
    expect(c.tcode).toBe('MM02');
    expectValidCard(c);
  });

  it('R2 ranks 1 kg SKUs first', () => {
    const [c] = rule('R2').run(ctx);
    expect(c.title).toMatch(/^Sortiment: F12, F13/);
  });

  it('R6 raises prices of low-coverage SKUs, never below cost', () => {
    const cards = rule('R6').run(ctx);
    expect(cards.map((c) => c.id.split(':')[1])).toEqual(expect.arrayContaining(['F02', 'F03']));
    cards.forEach(expectValidCard);
  });

  it('R8 plan, R9 idle days in round 3', () => {
    const [plan] = rule('R8').run(ctx);
    expectValidCard(plan);
    const [idle] = rule('R9').run(ctx);
    expect(idle.title).toMatch(/kole 3/);
    expect(idle.steps[0]).toMatch(/^Dny bez zakázky: 1, 2, 3, 4, 5/);
  });

  it('R10: no DC 14 sales → no marketing card', () => {
    expect(rule('R10').run(ctx)).toEqual([]);
  });

  it('R15 recipe saving ≈ 0.32 €/ks for F12', () => {
    const [c] = rule('R15').run(ctx);
    expect(c.title).toMatch(/0,32/);
    expect(c.why.confidence).toBe('odhad');
    expect(c.why.risk).toMatch(/OVĚŘIT/);
  });

  it('R11 fires at end of round when the next 5 days are covered but the next round is not', () => {
    // fake: enough raw stock for 5 days of plan, nothing beyond
    const big = { ...ds, inventory: ds.inventory.map((r) => (r.location === '88' ? { ...r, stock: r.unit === 'KG' ? 40000 : 110000 } : r)) };
    const an = analyze(big, cfg, { gameDay: 56 });
    const c2 = makeCtx(big, cfg, an);
    expect(rule('R4').run(c2)).toEqual([]);
    const [c] = rule('R11').run(c2);
    expect(c.title).toMatch(/kola 4/);
    expect(c.deadline).toMatch(/dne 15/);
  });
});

describe('all rules: valid cards in every phase', () => {
  it.each(['pred', 'start', 'beh', 'konec'] as const)('%s', (phase) => {
    const c = at(phase, phase === 'start' ? 2 : phase === 'beh' ? 10 : 18);
    const { cards, errors } = runRules(c);
    expect(errors).toEqual([]);
    cards.forEach(expectValidCard);
    expect(new Set(cards.map((x) => x.id)).size).toBe(cards.length); // unique ids
  });
});

describe('snapshot', () => {
  const snap = buildSnapshot(ds, cfg, { done: { 'R3:DC10': true } });
  it('max 3 critical, sorted by priority then impact, done cards last', () => {
    expect(snap.critical.length).toBeLessThanOrEqual(3);
    expect(snap.critical.every((c) => c.priority === 'kritické')).toBe(true);
    expect(snap.cards.at(-1)!.id).toBe('R3:DC10');
    expect(snap.ruleErrors).toEqual([]);
    expect(snap.rules.map((r) => r.id)).toContain('R15');
  });
  it('sanity: practice data is consistent with intro preset', () => {
    expect(snap.warnings.filter((w) => w.level === 'warn')).toEqual([]);
  });
  it('extended preset warns about initial stock', () => {
    const s = buildSnapshot(ds, { ...cfg, initial: { ...cfg.initial, finishedGoodsPerSku: 0 } });
    expect(s.warnings.map((w) => w.id)).toContain('initial-stock');
  });
  it('serialises to JSON', () => {
    expect(() => JSON.stringify(snap)).not.toThrow();
  });
});
