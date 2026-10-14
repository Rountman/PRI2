import { DEFAULT_HOWTO, fillSteps, type GameConfig, type Howto, type HowtoKey } from '@copilot/config';
import type { Analysis } from '../analysis/index.ts';
import { profitToValuation } from '../finance/index.ts';
import type { ActionCard, Dataset, Phase, ReportKind } from '../types.ts';

export type RuleCtx = {
  ds: Dataset;
  cfg: GameConfig;
  a: Analysis;
  howto: Record<HowtoKey, Howto>;
  /** profit delta → valuation delta (uses current discount rate) */
  toValuation: (profit: number) => number;
};

export type RuleMeta = {
  id: string; // 'R1'
  name: string; // human readable – shown in why.rule and Strategie tab
  phases: Phase[]; // when the rule is relevant
  summary: string; // one line: what it watches
  why: string; // explanation for the Strategie tab
  needs: (ReportKind | 'finance')[];
};

export type Rule = { meta: RuleMeta; run: (ctx: RuleCtx) => ActionCard[] };

export const ALL_PHASES: Phase[] = ['pred', 'start', 'beh', 'konec'];

export function makeCtx(ds: Dataset, cfg: GameConfig, a: Analysis, howto: Record<HowtoKey, Howto> = DEFAULT_HOWTO): RuleCtx {
  return { ds, cfg, a, howto, toValuation: (p) => profitToValuation(p, cfg, a.discount.rate) };
}

export function steps(ctx: RuleCtx, key: HowtoKey, values: Record<string, string | number>): { tcode: string; steps: string[] } {
  const h = ctx.howto[key] ?? DEFAULT_HOWTO[key];
  return { tcode: h.tcode, steps: fillSteps(h.steps, values) };
}

export const ruleLabel = (m: RuleMeta) => `${m.id} ${m.name}`;

/** Volume-weighted average margin per unit of the latest round (used to price lost capacity). */
export function avgMargin(a: Analysis): number {
  const e = Object.values(a.econLatest);
  const q = e.reduce((s, x) => s + x.qty, 0);
  return q ? e.reduce((s, x) => s + x.marginPerUnit * x.qty, 0) / q : 0;
}

/** Days ahead that a price/plan decision keeps paying off. */
export function horizonDays(ctx: RuleCtx): number {
  return Math.min(Math.max(ctx.a.clock.daysLeftInGame, 0), ctx.cfg.roundLength / 2);
}

export const isLastRound = (ctx: RuleCtx) => ctx.a.clock.round >= ctx.cfg.rounds;
