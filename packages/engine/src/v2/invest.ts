// 5.4 Investments: loan repayment, setup reduction (marginal table), capacity break-even.
import { cashReserve, setupHours, type GameConfig } from '@copilot/config';
import { debtLoading, discountRate, ratingFor } from '../finance/index.ts';
import type { Model } from './model.ts';

export type SetupStep = {
  from: number; // cumulative 478000 balance before
  to: number;
  spend: number; // marginal spend
  hoursFrom: number;
  hoursTo: number;
  savedHours: number;
  gain: number; // € margin over the remaining rounds
  ratio: number; // gain / spend
  recommended: boolean;
};

export type SetupInput = { currentSpend: number; changeoversPerRound: number; marginPerUnit: number; remainingRounds: number };

/**
 * Marginal table: saved hours × changeovers/round × units/hour × margin × remaining rounds vs. marginal spend.
 * The spend hits valuation once (not annualised). Recommended = contiguous steps with gain > payback × spend.
 */
export function setupMarginalTable(cfg: GameConfig, inp: SetupInput): SetupStep[] {
  const out: SetupStep[] = [];
  let from = inp.currentSpend;
  let ok = true;
  for (const to of cfg.setupSteps) {
    if (to <= from) continue;
    const hoursFrom = setupHours(cfg, from);
    const hoursTo = setupHours(cfg, to);
    const savedHours = hoursFrom - hoursTo;
    const gain = savedHours * inp.changeoversPerRound * (cfg.capacityPerDay / 24) * inp.marginPerUnit * inp.remainingRounds;
    const spend = to - from;
    const ratio = spend > 0 ? gain / spend : 0;
    ok = ok && ratio > cfg.investPayback;
    out.push({ from, to, spend, hoursFrom, hoursTo, savedHours, gain, ratio, recommended: ok });
    from = to;
  }
  return out;
}

export type LoanAdvice = {
  cash: number | null;
  loan: number;
  reserve: number;
  repay: number; // 0 when unknown
  interestSavedPerDay: number;
  interestSaved: number; // over the remaining days
  perMillionPerDay: number;
  generic: boolean; // no finance data → generic card
};

/** Repay `cash − reserve`; rating does not change (DebtLoading is unchanged), interest falls. */
export function loanAdvice(cfg: GameConfig, inp: { cash: number | null; loan: number; rawNextCycle: number; remainingDays: number }): LoanAdvice {
  const reserve = cashReserve(cfg, inp.rawNextCycle);
  const repay = inp.cash === null ? 0 : Math.max(0, Math.min(inp.loan, Math.floor((inp.cash - reserve) / 10_000) * 10_000));
  const perDay = (repay / 1e6) * cfg.interestPerDayPerM;
  return {
    cash: inp.cash,
    loan: inp.loan,
    reserve,
    repay,
    interestSavedPerDay: perDay,
    interestSaved: perDay * inp.remainingDays,
    perMillionPerDay: cfg.interestPerDayPerM,
    generic: inp.cash === null,
  };
}

export type CapacityAdvice = {
  relevant: boolean; // demand persistently above capacity
  demandPerDay: number;
  capacityPerDay: number;
  extraUnits: number; // per €1M
  gain: number;
  depreciation: number;
  ratingBefore: string | null;
  ratingAfter: string | null;
  discountBefore: number | null;
  discountAfter: number | null;
  net: number;
};

/** +1 000 units/day for €1M: margin × remaining days vs. depreciation (+ rating drop when finance is known). */
export function capacityAdvice(m: Model, demandPerDay: number, stockouts: number): CapacityAdvice {
  const { cfg } = m;
  const extraUnits = (1e6 / cfg.capacityCostPer1000) * 1000;
  const usable = Math.max(0, Math.min(extraUnits, demandPerDay - cfg.capacityPerDay));
  const avgMargin = m.skus.length ? m.skus.reduce((a, s) => a + m.margin[s] * m.demand[s].perDay, 0) / Math.max(1, m.skus.reduce((a, s) => a + m.demand[s].perDay, 0)) : 0;
  const gain = usable * avgMargin * m.remainingDays;
  const depreciation = cfg.depreciationPerDayPerM * m.remainingDays;
  let rb: string | null = null;
  let ra: string | null = null;
  let db: number | null = null;
  let da: number | null = null;
  if (m.finance) {
    const before = ratingFor(debtLoading(m.finance), cfg.ratingTable);
    const after = ratingFor(debtLoading({ ...m.finance, cash: m.finance.cash - 1e6 }), cfg.ratingTable);
    rb = before.rating;
    ra = after.rating;
    db = discountRate(before.premium, cfg);
    da = discountRate(after.premium, cfg);
  }
  return {
    relevant: demandPerDay > cfg.capacityPerDay && stockouts > 0,
    demandPerDay,
    capacityPerDay: cfg.capacityPerDay,
    extraUnits,
    gain,
    depreciation,
    ratingBefore: rb,
    ratingAfter: ra,
    discountBefore: db,
    discountAfter: da,
    net: gain - depreciation,
  };
}

/** Average changeovers per played round from ProductionReport, else preset default. */
export function changeoversPerRound(m: Model): number {
  const played = m.a.production.filter((p) => p.orders > 0);
  return played.length ? played.reduce((a, p) => a + p.setups, 0) / played.length : m.cfg.md61.changeoversPerRound;
}

export function avgMargin(m: Model): number {
  const w = m.skus.reduce((a, s) => a + m.demand[s].perDay, 0);
  return w ? m.skus.reduce((a, s) => a + m.margin[s] * m.demand[s].perDay, 0) / w : 0;
}
