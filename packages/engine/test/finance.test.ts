import { describe, expect, it } from 'vitest';
import { resolveConfig, setupHours } from '@copilot/config';
import { companyValue, debtLoading, discountRate, impliedProfit, ratingDistance, ratingFor } from '../src/finance/index.ts';
import { calibrate, whatIf } from '../src/finance/whatif.ts';
import type { FinanceSnapshot } from '../src/types.ts';
import { cfg, fixtureDataset } from './helpers.ts';

const ext = resolveConfig({ preset: 'extended' });
const T = cfg.ratingTable;

// Balance Sheet / Income Statement, Intro game, start of round 4 (CLAUDE.md 4.3)
const INTRO_FIN: FinanceSnapshot = {
  gameDay: 60,
  cash: 3_376_340.64,
  receivables: 1_261_952.5,
  payables: 326_988,
  loan: 0,
  netIncome: 1_934_724.86,
  setupSpend: 0,
  roundsPlayed: 3,
};

describe('valuation formula (CLAUDE.md kap. 2)', () => {
  it('Profit 125 000, Setup −75 000, 1 round, BBB → 17 884 615', () => {
    expect(Math.round(companyValue(125_000, -75_000, 1, ratingByNameP('BBB'), cfg))).toBe(17_884_615);
  });

  it('Cash 1.5M, AR 450k, Loan −10M, AP −350k → −8.4M → BBB → 6 %', () => {
    const dl = debtLoading({ cash: 1.5e6, receivables: 450e3, loan: -10e6, payables: -350e3 });
    expect(dl).toBeCloseTo(-8.4e6, 2);
    const r = ratingFor(dl, T);
    expect(r.rating).toBe('BBB');
    expect(r.premium).toBe(6);
  });

  it('initial state (2M cash, −8M loan) → −6M → A− → discount 12.25 %', () => {
    const r = ratingFor(debtLoading({ cash: ext.initial.cash, receivables: 0, loan: ext.initial.loan, payables: 0 }), T);
    expect(r.rating).toBe('A−');
    expect(discountRate(r.premium, ext)).toBeCloseTo(0.1225, 10);
  });

  it('rating boundaries: 0 → AAA+, −20M and below → C', () => {
    expect(ratingFor(4_311_305, T).rating).toBe('AAA+');
    expect(ratingFor(0, T).rating).toBe('AAA+');
    expect(ratingFor(-1, T).rating).toBe('AAA+');
    expect(ratingFor(-1e6, T).rating).toBe('AA+');
    expect(ratingFor(-25e6, T).rating).toBe('C');
  });

  it('distance to next rating step', () => {
    const d = ratingDistance(-8.4e6, T);
    expect(d.current.rating).toBe('BBB');
    expect(d.toUp).toBeCloseTo(0.4e6, -1); // need DL > −8M
    expect(d.toDown).toBeCloseTo(0.6e6, -1); // −9M → BBB−
  });

  it('setup time formula control values', () => {
    const h = (s: number) => setupHours(cfg, s);
    expect(h(0)).toBe(8);
    expect(h(50_000)).toBeCloseTo(7, 5);
    expect(h(125_000)).toBeCloseTo(6, 5);
    expect(h(250_000)).toBeCloseTo(5, 5);
    expect(h(500_000)).toBeCloseTo(4, 5);
    expect(h(1_250_000)).toBeCloseTo(3, 5);
  });
});

describe('MANDATORY: Intro balance sheet → 77 388 994,40', () => {
  it('DebtLoading +4 311 305 → AAA+ (3 %) → 77 388 994.40', () => {
    const dl = debtLoading(INTRO_FIN);
    expect(dl).toBeCloseTo(4_311_305.14, 2);
    const r = ratingFor(dl, T);
    expect(r.rating).toBe('AAA+');
    expect(companyValue(INTRO_FIN.netIncome, 0, 3, r.premium, cfg)).toBeCloseTo(77_388_994.4, 1);
  });

  it('calibration against reported Company Valuation: ✅ match', () => {
    const ds = { ...fixtureDataset(), finance: [INTRO_FIN] };
    const c = calibrate(ds, cfg);
    expect(c.source).toBe('finance');
    expect(c.reported).toBeCloseTo(77_388_994.4, 2);
    expect(c.match).toBe(true);
    expect(c.factor).toBe(1);
    expect(Math.abs(c.deviation!)).toBeLessThan(1e-9);
  });

  it('mistyped numbers → no match, correction factor and warning', () => {
    const ds = { ...fixtureDataset(), finance: [{ ...INTRO_FIN, netIncome: 1_500_000 }] };
    const c = calibrate(ds, cfg);
    expect(c.match).toBe(false);
    expect(c.factor).toBeGreaterThan(1);
  });

  it('fallback without finance: implied profit from reported valuation', () => {
    const c = calibrate(fixtureDataset(), cfg);
    expect(c.source).toBe('implied');
    expect(c.rating).toBe('AAA+');
    expect(c.profit).toBeCloseTo(impliedProfit(77_388_994.4, 3, 3, cfg), 2);
    expect(c.profit).toBeCloseTo(1_934_724.86, 1);
  });
});

describe('what-if', () => {
  const extFin: FinanceSnapshot = { gameDay: 20, cash: 4_000_000, receivables: 500_000, payables: 300_000, loan: 8_000_000, netIncome: 400_000, setupSpend: 0, roundsPlayed: 1 };

  it('loan repayment keeps rating, increases valuation by saved interest', () => {
    const w = whatIf(extFin, ext, { repayLoan: 1_000_000, capacityEUR: 0, setupEUR: 0, marginPerUnit: 5, changeoversPerRound: 8 });
    expect(w.ratingChanged).toBe(false);
    expect(w.after.debtLoading).toBeCloseTo(w.before.debtLoading, 2);
    expect(w.effects[0].profit).toBeCloseTo(330.6 * 60, 0); // 3 rounds × 20 days left
    expect(w.deltaValuation).toBeGreaterThan(0);
  });

  it('machines for €3M → 3 rating steps down', () => {
    const w = whatIf(extFin, ext, { repayLoan: 0, capacityEUR: 3_000_000, setupEUR: 0, marginPerUnit: 5, changeoversPerRound: 8 });
    const idx = (n: string) => ext.ratingTable.findIndex((r) => r.rating === n);
    expect(idx(w.after.rating) - idx(w.before.rating)).toBe(3);
  });

  it('setup spend is a one-off cost (not annualised) and lowers DebtLoading', () => {
    // DL −3.8M (AA−); −100k stays above −4M
    const w = whatIf(extFin, ext, { repayLoan: 0, capacityEUR: 0, setupEUR: 100_000, marginPerUnit: 0, changeoversPerRound: 0 });
    expect(w.after.debtLoading).toBeCloseTo(w.before.debtLoading - 100_000, 2);
    // with zero benefit: ΔV = −S / discount (same rating)
    expect(w.ratingChanged).toBe(false);
    expect(w.after.valuation - w.before.valuation).toBeCloseTo(-100_000 / w.before.discount, 0);
    // crossing −4M changes the rating
    expect(whatIf(extFin, ext, { repayLoan: 0, capacityEUR: 0, setupEUR: 250_000, marginPerUnit: 0, changeoversPerRound: 0 }).ratingChanged).toBe(true);
  });

  it('warns when cash drops below reserve', () => {
    const w = whatIf(extFin, ext, { repayLoan: 3_900_000, capacityEUR: 0, setupEUR: 0, marginPerUnit: 5, changeoversPerRound: 8 });
    expect(w.warnings.join(' ')).toMatch(/rezerv/);
  });
});

function ratingByNameP(name: string) {
  return T.find((r) => r.rating === name)!.premium;
}
