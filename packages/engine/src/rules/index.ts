import type { ActionCard, Phase } from '../types.ts';
import { R1, R2, R3 } from './between.ts';
import type { Rule, RuleCtx, RuleMeta } from './common.ts';
import { R11, R12 } from './end.ts';
import { R6, R7, R8, R9, R10 } from './run.ts';
import { R4, R4b, R5, R15 } from './start.ts';
import { R13, R14 } from './finance.ts';

export * from './common.ts';
export { needsFor } from './start.ts';

/** Playbook order (also the order on the Strategie tab). */
export const RULES: Rule[] = [R1, R2, R3, R4, R4b, R15, R5, R6, R7, R8, R9, R10, R11, R12, R13, R14];

export const PRIORITY_ORDER: Record<ActionCard['priority'], number> = { kritické: 0, vysoká: 1, střední: 2 };

export function sortCards(cards: ActionCard[]): ActionCard[] {
  return [...cards].sort(
    (a, b) =>
      Number(!!a.done) - Number(!!b.done) ||
      PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
      (b.impactEUR ?? 0) - (a.impactEUR ?? 0),
  );
}

export type RuleError = { ruleId: string; message: string };

/** Run all rules relevant for the current phase. A failing rule never breaks the others. */
export function runRules(ctx: RuleCtx, phase: Phase = ctx.a.clock.phase): { cards: ActionCard[]; errors: RuleError[] } {
  const cards: ActionCard[] = [];
  const errors: RuleError[] = [];
  for (const r of RULES) {
    if (!r.meta.phases.includes(phase)) continue;
    try {
      cards.push(...r.run(ctx));
    } catch (e) {
      errors.push({ ruleId: r.meta.id, message: (e as Error).message });
    }
  }
  return { cards: sortCards(cards), errors };
}

export const ruleCatalog = (): RuleMeta[] => RULES.map((r) => r.meta);
