import { fmtNum, fmtPrice, sapValue } from '../format.ts';
import { skuLabel } from '../normalize.ts';
import type { ActionCard } from '../types.ts';
import { isLastRound, ruleLabel, steps, type Rule } from './common.ts';
import { needsFor } from './start.ts';
import { round2 } from '../analysis/sales.ts';

export const R11: Rule = {
  meta: {
    id: 'R11',
    name: 'Suroviny přes hranici kola',
    phases: ['konec'],
    summary: 'Na konci kola objednej suroviny na prvních 5 dní dalšího kola (deadline = den 20 − lead time).',
    why: 'Ve cvičné hře se suroviny objednaly až na začátku kola 3 a linka stála 5 dní.',
    needs: ['inventory'],
  },
  run(ctx) {
    const { a, cfg } = ctx;
    if (!a.has.inventory || isLastRound(ctx)) return [];
    // R4 already fires when the next 5 days are not covered
    if (needsFor(ctx, cfg.purchaseHorizonDays).needs.some((n) => n.shortfallNoPO > 0 && n.shortfall > 0)) return [];
    const days = a.clock.daysLeftInRound + cfg.purchaseHorizonDays;
    const { needs, basis } = needsFor(ctx, days);
    const lines = needs.filter((n) => n.shortfall > 0);
    if (!lines.length) return [];
    const deadline = cfg.roundLength - cfg.leadTimeDaysMax;
    const s = steps(ctx, 'purchase', { mat: lines.map((l) => l.material).join(', '), vendor: [...new Set(lines.map((l) => l.vendor))].join(', '), qty: '…' });
    return [
      {
        id: `R11:r${a.clock.round}`,
        ruleId: 'R11',
        priority: a.clock.day >= deadline ? 'kritické' : 'vysoká',
        title: `Objednej suroviny na start kola ${a.clock.round + 1}`,
        deadline: `do dne ${deadline} – lead time ${cfg.leadTimeDaysMax} dní`,
        tcode: s.tcode,
        steps: [s.steps[0], ...lines.map((l) => `${l.material} (${l.vendor}): ${fmtNum(l.orderQty)} ${l.unit === 'KG' ? 'kg' : 'ks'}`), s.steps.at(-1)!],
        copyValues: lines.map((l) => ({ label: l.material, value: sapValue(l.orderQty, 0) })),
        why: {
          summary: 'Na prvních 5 dní dalšího kola nejsou suroviny – objednávka musí dorazit před startem.',
          data: [{ label: 'Základ výpočtu', value: basis }, ...lines.map((l) => ({ label: l.material, value: `potřeba ${fmtNum(l.need)} · sklad ${fmtNum(l.stock)} · v cestě ${fmtNum(l.openPO)}` }))],
          rule: ruleLabel(R11.meta),
          confidence: 'pravděpodobné',
        },
      },
    ];
  },
};

export const R12: Rule = {
  meta: {
    id: 'R12',
    name: 'Doprodej',
    phases: ['konec'],
    summary: 'SKU s > 5 dny pokrytí na konci kola → mírná sleva, ať zboží neleží.',
    why: 'Sklad na konci hry se oceňuje v nákladech, takže marže z neprodaného zboží propadne.',
    needs: ['inventory', 'sales'],
  },
  run(ctx) {
    const { a, cfg } = ctx;
    const last = isLastRound(ctx);
    const cards: ActionCard[] = [];
    for (const p of a.pricing) {
      const c = p.coverage;
      if (!c || c.stock <= 0 || p.ourPrice === null || p.action === 'snížit') continue; // R7 handles big overstock
      const over = c.days > cfg.pricing.clearanceCoverageDays && (c.inStockDays >= 3 || last);
      if (!over) continue;
      const price = Math.max(round2(p.ourPrice - cfg.pricing.step), p.floor);
      if (price >= p.ourPrice) continue;
      const sellable = Math.min(c.stock, Math.max(c.avgDaily, 1) * Math.max(a.clock.daysLeftInRound, 1) * 1.5);
      const profit = last ? sellable * (price - p.unitCost) : 0;
      const s = steps(ctx, 'price', { mat: p.sku, dc: (p.dcs.length ? p.dcs : ['12']).join(', '), price: sapValue(price) });
      cards.push({
        id: `R12:${p.sku}:r${a.clock.round}`,
        ruleId: 'R12',
        priority: last ? 'vysoká' : 'střední',
        title: `Doprodej ${skuLabel(p.sku)}: cena ${fmtPrice(price)} (−${fmtPrice(cfg.pricing.step)})`,
        impactEUR: profit ? ctx.toValuation(profit) : undefined,
        profitEUR: profit || undefined,
        ...s,
        copyValues: [{ label: `${p.sku} cena`, value: sapValue(price) }],
        why: {
          summary: `${fmtNum(c.stock)} ks = ${Number.isFinite(c.days) ? fmtNum(c.days, 1) : '∞'} dní pokrytí na konci kola.`,
          data: [
            { label: 'Sklad', value: `${fmtNum(c.stock)} ks` },
            { label: 'Prodej / den', value: fmtNum(c.avgDaily) },
            { label: 'Naše cena', value: fmtPrice(p.ourPrice) },
            { label: 'Unit cost', value: fmtPrice(p.unitCost) },
            { label: 'Poslední kolo hry', value: last ? 'ano' : 'ne' },
          ],
          rule: ruleLabel(R12.meta),
          risk: last ? undefined : 'Nejde o poslední kolo – sklad se dá prodat i v dalším kole, sleva je jen mírná.',
          confidence: 'pravděpodobné',
        },
      });
    }
    return cards;
  },
};
