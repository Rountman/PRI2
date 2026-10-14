import { DEFAULT_HOWTO, type GameConfig, type Howto, type HowtoKey } from '@copilot/config';
import { analyze, type Analysis } from './analysis/index.ts';
import type { ClockOverride } from './phase.ts';
import { makeCtx, ruleCatalog, runRules, sortCards, type RuleError, type RuleMeta } from './rules/index.ts';
import { sanityChecks, type SanityWarning } from './sanity.ts';
import type { ActionCard, Dataset } from './types.ts';

export type Snapshot = {
  generatedAt: string;
  analysis: Analysis;
  cards: ActionCard[];
  critical: ActionCard[]; // max 3 open critical cards for the top of Velín
  warnings: SanityWarning[];
  ruleErrors: RuleError[];
  rules: RuleMeta[];
};

export type SnapshotOptions = {
  clock?: ClockOverride;
  howto?: Record<HowtoKey, Howto>;
  done?: Record<string, boolean>;
  now?: string;
};

export function buildSnapshot(ds: Dataset, cfg: GameConfig, opts: SnapshotOptions = {}): Snapshot {
  const analysis = analyze(ds, cfg, opts.clock);
  const ctx = makeCtx(ds, cfg, analysis, opts.howto ?? DEFAULT_HOWTO);
  const { cards, errors } = runRules(ctx);
  const withDone = sortCards(cards.map((c) => ({ ...c, done: !!opts.done?.[c.id] })));
  return {
    generatedAt: opts.now ?? new Date().toISOString(),
    analysis,
    cards: withDone,
    critical: withDone.filter((c) => c.priority === 'kritické' && !c.done).slice(0, 3),
    warnings: sanityChecks(ds, cfg, analysis),
    ruleErrors: errors,
    rules: ruleCatalog(),
  };
}
