import { setupHours } from '@copilot/config';
import { latestFinance } from '../finance/index.ts';
import { whatIf } from '../finance/whatif.ts';
import { fmtEUR, fmtNum, sapValue } from '../format.ts';
import type { ActionCard } from '../types.ts';
import { avgMargin, ruleLabel, steps, type Rule, type RuleCtx } from './common.ts';

const changeoversPerRound = (ctx: RuleCtx) => {
  const played = ctx.a.production.filter((p) => p.orders > 0);
  return played.length ? played.reduce((s, p) => s + p.setups, 0) / played.length : 0;
};

export const R13: Rule = {
  meta: {
    id: 'R13',
    name: 'Splátka úvěru',
    phases: ['pred', 'start', 'beh', 'konec'],
    summary: 'Volný cash nad rezervu → splať úvěr. Rating se nemění, úrok klesá.',
    why: 'Splátka sníží cash i úvěr o stejnou částku → DebtLoading a rating beze změny, ale každý €1M ušetří ~330 €/den úroku. Profit je kumulativní, takže splácet co nejdřív.',
    needs: ['finance'],
  },
  run(ctx) {
    const { cfg, a } = ctx;
    const f = latestFinance(ctx.ds);
    if (!f || f.loan <= 0) return [];
    const free = f.cash - cfg.cashReserve;
    if (free <= 50_000) return [];
    const amount = Math.floor(Math.min(free, f.loan) / 10_000) * 10_000;
    const w = whatIf(f, cfg, { repayLoan: amount, capacityEUR: 0, setupEUR: 0, marginPerUnit: avgMargin(a), changeoversPerRound: 0 }, a.calibration.factor);
    const s = steps(ctx, 'loan', { eur: fmtEUR(amount) });
    return [
      {
        id: `R13:d${f.gameDay}`,
        ruleId: 'R13',
        priority: 'vysoká',
        title: `Splať ${fmtEUR(amount)} úvěru`,
        impactEUR: w.deltaValuation,
        profitEUR: w.effects[0]?.profit,
        ...s,
        copyValues: [{ label: 'Částka', value: sapValue(amount, 0) }],
        why: {
          summary: `Rating zůstane ${w.after.rating}, úrok klesne o ~${fmtEUR((amount / 1e6) * cfg.interestPerDayPerM)}/den na zbývajících ${fmtNum(w.remainingDays)} dní.`,
          data: [
            { label: 'Cash (výkaz)', value: fmtEUR(f.cash) },
            { label: 'Rezerva (config)', value: fmtEUR(cfg.cashReserve) },
            { label: 'Úvěr', value: fmtEUR(f.loan) },
            { label: 'DebtLoading před / po', value: `${fmtEUR(w.before.debtLoading)} / ${fmtEUR(w.after.debtLoading)}` },
            { label: 'Rating před / po', value: `${w.before.rating} / ${w.after.rating}` },
          ],
          rule: ruleLabel(R13.meta),
          risk: 'Záporný cash [OVĚŘIT] – nech rezervu na suroviny a fixní náklady (viz ZFF7B).',
          confidence: 'pravděpodobné',
        },
      },
    ];
  },
};

export const R14: Rule = {
  meta: {
    id: 'R14',
    name: 'Volný cash → investice',
    phases: ['pred', 'start', 'beh', 'konec'],
    summary: 'Když investice nezhorší rating a výroba je úzké hrdlo → doporuč kapacitu/setup a ukaž break-even.',
    why: 'Rating je jmenovatel valuace. Investice, která rating nezmění a přinese víc marže než odpisy, zvyšuje valuaci.',
    needs: ['finance', 'production'],
  },
  run(ctx) {
    const { cfg, a } = ctx;
    const f = latestFinance(ctx.ds);
    if (!f) return [];
    const m = avgMargin(a);
    const cards: ActionCard[] = [];
    const last = [...a.production].reverse().find((p) => p.orders > 0);
    const bottleneck = !!last && last.utilization > 0.85;
    const options: { kind: string; eur: number; label: string }[] = [];
    if (bottleneck) options.push({ kind: 'kapacita', eur: 1_000_000, label: '+1 000 ks/den kapacity' });
    if (changeoversPerRound(ctx) >= cfg.maxChangeoversPerRound) {
      options.push({ kind: 'setup', eur: 250_000, label: `setup ${fmtNum(setupHours(cfg, f.setupSpend), 1)} → ${fmtNum(setupHours(cfg, f.setupSpend + 250_000), 1)} h` });
    }
    for (const o of options) {
      const w = whatIf(
        f,
        cfg,
        { repayLoan: 0, capacityEUR: o.kind === 'kapacita' ? o.eur : 0, setupEUR: o.kind === 'setup' ? o.eur : 0, marginPerUnit: m, changeoversPerRound: changeoversPerRound(ctx) },
        a.calibration.factor,
      );
      if (w.ratingChanged || w.deltaValuation <= 0) continue;
      const s = steps(ctx, 'investment', { kind: o.kind === 'kapacita' ? 'Capacity (stroje, účet 11000)' : 'Setup time reduction (účet 478000)', eur: fmtEUR(o.eur) });
      cards.push({
        id: `R14:${o.kind}:d${f.gameDay}`,
        ruleId: 'R14',
        priority: 'střední',
        title: `Investuj ${fmtEUR(o.eur)} do ${o.kind === 'kapacita' ? 'kapacity' : 'zkrácení setupu'} (${o.label})`,
        impactEUR: w.deltaValuation,
        profitEUR: w.effects.reduce((x, e) => x + e.profit, 0),
        ...s,
        copyValues: [{ label: 'Částka', value: sapValue(o.eur, 0) }],
        why: {
          summary: `Rating zůstane ${w.after.rating} (DebtLoading ${fmtEUR(w.after.debtLoading)}); efekty do konce hry převáží náklad.`,
          data: w.effects.map((e) => ({ label: e.label, value: fmtEUR(e.profit) })),
          rule: ruleLabel(R14.meta),
          risk: o.kind === 'kapacita' ? `Předpoklad: prodá se ${Math.round(cfg.extraCapacityUtilization * 100)} % extra kapacity. Bez poptávky jsou to jen odpisy.` : 'Úspora platí jen pokud budeme dál přestavovat linku.',
          confidence: 'odhad',
        },
      });
    }
    return cards;
  },
};
