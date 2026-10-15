import type { GameConfig } from '@copilot/config';
import { analyze, type Analysis } from './analysis/index.ts';
import type { ClockOverride } from './phase.ts';
import type { ActionCard, Dataset } from './types.ts';
import { alerts, roundCards, selectCards } from './v2/cards.ts';
import { pregameChecklist } from './v2/checklist.ts';
import { avgMargin, capacityAdvice, changeoversPerRound, loanAdvice, setupMarginalTable, type CapacityAdvice, type LoanAdvice, type SetupStep } from './v2/invest.ts';
import type { AssortmentReview } from './v2/assortment.ts';
import { marketingTable, type MarketingRow } from './v2/marketing.ts';
import { md61Plan, type Md61Plan } from './v2/md61.ts';
import { buildModel } from './v2/model.ts';
import { vk32Table, type Vk32Table } from './v2/vk32.ts';

export type Header = { valuation: number | null; valuationSource: 'Company-Valuation' | 'finance' | null; rating: string; discount: number; ratingSource: 'finance' | 'config' };

export type Snapshot = {
  generatedAt: string;
  clock: Analysis['clock'];
  header: Header;
  cards: ActionCard[]; // already selected (≤ maxCards, ≤ maxCritical) – checklist before the game
  md61: Md61Plan;
  vk32: Vk32Table;
  marketing: MarketingRow[];
  assortment: { current: string[]; review: AssortmentReview | null };
  invest: { loan: LoanAdvice; setup: SetupStep[]; capacity: CapacityAdvice; avgMargin: number; changeoversPerRound: number };
  analysis: Analysis; // for Rozšířené
  errors: string[];
};

export type SnapshotOptions = { clock?: ClockOverride; done?: Record<string, boolean>; now?: string };

export function buildSnapshot(ds: Dataset, cfg: GameConfig, opts: SnapshotOptions = {}): Snapshot {
  const analysis = analyze(ds, cfg, opts.clock);
  const m = buildModel(ds, cfg, analysis);
  const md61 = md61Plan(m);
  const vk32 = vk32Table(m);
  const errors: string[] = [];
  const safe = (name: string, f: () => ActionCard[]) => {
    try {
      return f();
    } catch (e) {
      errors.push(`${name}: ${(e as Error).message}`);
      return [];
    }
  };
  let cards = m.pregame
    ? safe('checklist', () => pregameChecklist(m, md61, vk32))
    : selectCards([...safe('alerts', () => alerts(m, md61, vk32)), ...safe('round', () => roundCards(m, md61, vk32))], cfg.maxCards, cfg.maxCritical);
  cards = cards.map((c) => ({ ...c, done: !!opts.done?.[c.id] }));

  const margin = avgMargin(m);
  const changeovers = changeoversPerRound(m);
  const demand = m.skus.reduce((x, s) => x + m.demand[s].perDay, 0);
  const latest = analysis.valuation.latest;
  return {
    generatedAt: opts.now ?? new Date().toISOString(),
    clock: analysis.clock,
    header: {
      valuation: latest?.valuation ?? analysis.calibration.computed ?? null,
      valuationSource: latest ? 'Company-Valuation' : analysis.calibration.computed !== null ? 'finance' : null,
      rating: analysis.discount.rating,
      discount: analysis.discount.rate,
      ratingSource: analysis.discount.source,
    },
    cards,
    md61,
    vk32,
    marketing: marketingTable(m),
    assortment: { current: m.assortment, review: m.review },
    invest: {
      loan: loanAdvice(cfg, { cash: m.cash, loan: m.loan, rawNextCycle: md61.materials.cost, remainingDays: m.remainingDays }),
      setup: setupMarginalTable(cfg, { currentSpend: m.setupSpend, changeoversPerRound: changeovers, marginPerUnit: margin, remainingRounds: m.remainingRounds }),
      capacity: capacityAdvice(m, demand, md61.rows.filter((r) => r.stock <= 0 && r.demand.perDay > 0).length),
      avgMargin: margin,
      changeoversPerRound: changeovers,
    },
    analysis,
    errors,
  };
}
