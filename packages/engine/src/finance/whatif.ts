import { cashReserve, setupHours, type GameConfig } from '@copilot/config';
import type { Dataset, FinanceSnapshot } from '../types.ts';
import { companyValue, debtLoading, discountRate, latestFinance, ratingByName, ratingDistance, ratingFor, impliedProfit } from './index.ts';

export type Calibration = {
  source: 'finance' | 'implied';
  gameDay: number | null;
  computed: number | null;
  reported: number | null;
  deviation: number | null; // computed/reported − 1
  match: boolean | null; // within financeMatchTolerance
  factor: number; // reported/computed when deviation > calibrationTolerance, else 1
  debtLoading: number | null;
  rating: string;
  premium: number;
  discount: number;
  toUp: number | null;
  toDown: number | null;
  profit: number | null; // cumulative profit (reported, or implied from valuation)
  roundsPlayed: number | null;
};

function reportedAt(ds: Dataset, gameDay: number): number | null {
  const rows = ds.valuation.filter((v) => v.gameDay <= gameDay).sort((a, b) => b.gameDay - a.gameDay);
  return rows[0]?.valuation ?? null;
}

/** Compare our valuation formula against the reported Company Valuation (CLAUDE.md 6b.3). */
export function calibrate(ds: Dataset, cfg: GameConfig): Calibration {
  const f = latestFinance(ds);
  if (f) {
    const dl = debtLoading(f);
    const r = ratingFor(dl, cfg.ratingTable);
    const dist = ratingDistance(dl, cfg.ratingTable);
    const computed = companyValue(f.netIncome, f.setupSpend, f.roundsPlayed, r.premium, cfg);
    const reported = reportedAt(ds, f.gameDay);
    const deviation = reported ? computed / reported - 1 : null;
    return {
      source: 'finance',
      gameDay: f.gameDay,
      computed,
      reported,
      deviation,
      match: deviation === null ? null : Math.abs(deviation) < cfg.financeMatchTolerance,
      factor: deviation !== null && Math.abs(deviation) > cfg.calibrationTolerance && computed ? reported! / computed : 1,
      debtLoading: dl,
      rating: r.rating,
      premium: r.premium,
      discount: discountRate(r.premium, cfg),
      toUp: dist.toUp,
      toDown: dist.toDown,
      profit: f.netIncome,
      roundsPlayed: f.roundsPlayed,
    };
  }
  const r = ratingByName(cfg.defaultRating, cfg.ratingTable);
  const last = [...ds.valuation].sort((a, b) => b.gameDay - a.gameDay)[0];
  const roundsPlayed = last ? last.gameDay / cfg.roundLength : null;
  return {
    source: 'implied',
    gameDay: last?.gameDay ?? null,
    computed: null,
    reported: last?.valuation ?? null,
    deviation: null,
    match: null,
    factor: 1,
    debtLoading: null,
    rating: r.rating,
    premium: r.premium,
    discount: discountRate(r.premium, cfg),
    toUp: null,
    toDown: null,
    profit: last && roundsPlayed ? impliedProfit(last.valuation, r.premium, roundsPlayed, cfg) : null,
    roundsPlayed,
  };
}

export type WhatIfInput = {
  repayLoan: number; // €
  capacityEUR: number; // € invested in machines
  setupEUR: number; // € invested in setup-time reduction
  marginPerUnit: number; // € / unit (from analysis)
  changeoversPerRound: number; // recent average
  extraCapacityUtilization?: number; // 0..1
};

export type WhatIfState = { debtLoading: number; rating: string; discount: number; profitEnd: number; setup: number; valuation: number };

export type WhatIfResult = {
  remainingDays: number;
  before: WhatIfState;
  after: WhatIfState;
  deltaValuation: number; // × calibration factor
  effects: { label: string; profit: number }[];
  ratingChanged: boolean;
  warnings: string[];
};

/**
 * End-of-game what-if. Profit is projected linearly to the last round, then each action adds its
 * profit effect over the remaining days. Setup spend hits profit once and is not annualised.
 */
export function whatIf(f: FinanceSnapshot, cfg: GameConfig, inp: WhatIfInput, factor = 1): WhatIfResult {
  const totalDays = cfg.rounds * cfg.roundLength;
  const playedDays = Math.max(1, f.roundsPlayed * cfg.roundLength);
  const remainingDays = Math.max(0, totalDays - playedDays);
  const warnings: string[] = [];
  const repay = Math.min(Math.max(0, inp.repayLoan), f.loan);
  if (inp.repayLoan > f.loan) warnings.push('Splátka je vyšší než úvěr – omezeno na zůstatek úvěru.');

  const state = (cash: number, loan: number, profitEnd: number, setup: number): WhatIfState => {
    const dl = debtLoading({ cash, receivables: f.receivables, loan, payables: f.payables });
    const r = ratingFor(dl, cfg.ratingTable);
    return { debtLoading: dl, rating: r.rating, discount: discountRate(r.premium, cfg), profitEnd, setup, valuation: companyValue(profitEnd, setup, cfg.rounds, r.premium, cfg) };
  };

  const profitEnd = (f.netIncome / Math.max(f.roundsPlayed, 1e-9)) * cfg.rounds;
  const before = state(f.cash, f.loan, profitEnd, f.setupSpend);

  const effects: { label: string; profit: number }[] = [];
  if (repay > 0) effects.push({ label: 'Úspora úroků', profit: (repay / 1e6) * cfg.interestPerDayPerM * remainingDays });
  if (inp.capacityEUR > 0) {
    const units = (inp.capacityEUR / cfg.capacityCostPer1000) * 1000;
    const util = inp.extraCapacityUtilization ?? cfg.extraCapacityUtilization;
    effects.push({ label: `Marže z +${Math.round(units)} ks/den (využito ${Math.round(util * 100)} %)`, profit: units * util * inp.marginPerUnit * remainingDays });
    effects.push({ label: 'Odpisy nových strojů', profit: -(inp.capacityEUR / 1e6) * cfg.depreciationPerDayPerM * remainingDays });
  }
  if (inp.setupEUR > 0) {
    const saved = setupHours(cfg, f.setupSpend) - setupHours(cfg, f.setupSpend + inp.setupEUR);
    const changeovers = inp.changeoversPerRound * (remainingDays / cfg.roundLength);
    effects.push({ label: `Kratší setup −${saved.toFixed(2)} h × ${Math.round(changeovers)} přestaveb`, profit: saved * (cfg.capacityPerDay / 24) * changeovers * inp.marginPerUnit });
    effects.push({ label: 'Investice do setupu (jednorázový náklad)', profit: -inp.setupEUR });
  }
  const dProfit = effects.reduce((s, e) => s + e.profit, 0);
  const cash = f.cash - repay - inp.capacityEUR - inp.setupEUR;
  const reserve = cashReserve(cfg);
  if (cash < reserve) warnings.push(`Cash klesne na ${Math.round(cash).toLocaleString('cs-CZ')} € – pod rezervou ${Math.round(reserve).toLocaleString('cs-CZ')} € (fixní náklady ${cfg.reserve.fixedDays} dní + buffer).`);
  const after = state(cash, f.loan - repay, profitEnd + dProfit, f.setupSpend + inp.setupEUR);
  return {
    remainingDays,
    before,
    after,
    deltaValuation: (after.valuation - before.valuation) * factor,
    effects,
    ratingChanged: after.rating !== before.rating,
    warnings,
  };
}
