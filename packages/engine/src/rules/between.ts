import { setupHours } from '@copilot/config';
import { fmtEUR, fmtNum, fmtPrice, sapValue } from '../format.ts';
import { skuLabel, skuSize } from '../normalize.ts';
import type { ActionCard } from '../types.ts';
import { avgMargin, ruleLabel, steps, type Rule } from './common.ts';
import { round2 } from '../analysis/sales.ts';

export const R1: Rule = {
  meta: {
    id: 'R1',
    name: 'Lot size a delší běhy',
    phases: ['pred', 'konec'],
    summary: 'Hodně přestaveb v kole → větší lot size (MM02, jen mezi koly) a běhy ≥ 2–3 dávek.',
    why: 'Každá přestavba = 8 h = ~8 000 ks ztracené kapacity. Méně přestaveb = víc vyrobeného zboží za stejné fixní náklady.',
    needs: ['production'],
  },
  run(ctx) {
    const { a, cfg } = ctx;
    const recent = a.production.filter((p) => p.round >= a.clock.round - 1 && p.orders > 0);
    const worst = [...recent].sort((x, y) => y.setups - x.setups)[0];
    if (!worst || worst.setups <= cfg.maxChangeoversPerRound) return [];
    const perHour = cfg.capacityPerDay / 24;
    const excess = worst.setups - cfg.maxChangeoversPerRound;
    const savedUnits = excess * setupHours(cfg) * perHour;
    const remainingRounds = Math.max(1, cfg.rounds - a.clock.round + (a.clock.phase === 'pred' ? 1 : 0));
    const profit = savedUnits * avgMargin(a) * remainingRounds;
    const top = Object.values(a.econLatest).sort((x, y) => y.marginPerCapacity - x.marginPerCapacity).slice(0, cfg.sortimentSize);
    const lot = Math.max(cfg.lotMax, 3 * cfg.lotMin);
    const s = steps(ctx, 'lotsize', { mat: top.map((t) => t.sku).join(', '), qty: fmtNum(lot) });
    return [
      {
        id: `R1:r${worst.round}`,
        ruleId: 'R1',
        priority: 'vysoká',
        title: `Méně přestaveb: v kole ${worst.round} bylo ${worst.setups} setupů (${fmtNum(worst.setupHours)} h)`,
        impactEUR: ctx.toValuation(profit),
        profitEUR: profit,
        deadline: 'mezi koly (MM02 jde měnit jen mezi koly)',
        ...s,
        steps: [...s.steps, 'Ve výrobě plánuj stejný SKU ve ≥ 2–3 dávkách po sobě (viz R8).'],
        copyValues: [{ label: 'Max lot size', value: sapValue(lot, 0) }],
        why: {
          summary: `Setupy v kole ${worst.round} spolkly ${fmtNum(worst.setupLossUnits)} ks kapacity – to je ${fmtNum(worst.setupLossUnits / cfg.capacityPerDay, 1)} dne výroby.`,
          data: [
            { label: 'Výrobních zakázek', value: fmtNum(worst.orders) },
            { label: 'Přestaveb', value: `${worst.setups} × ${fmtNum(setupHours(cfg), 1)} h` },
            { label: 'Ztracená kapacita', value: `${fmtNum(worst.setupLossUnits)} ks` },
            { label: 'Prům. marže / ks', value: fmtPrice(avgMargin(a)) },
            { label: 'Limit přestaveb (config)', value: String(cfg.maxChangeoversPerRound) },
          ],
          rule: ruleLabel(R1.meta),
          risk: 'Delší běhy zvyšují sklad jednoho SKU – hlídej pokrytí ostatních SKU, ať nevypadnou z prodeje.',
          confidence: 'pravděpodobné',
        },
      },
    ];
  },
};

export const R2: Rule = {
  meta: {
    id: 'R2',
    name: 'Sortiment',
    phases: ['pred', 'start'],
    summary: 'Vyber 4–6 SKU s nejvyšší marží na kus kapacity a s poptávkou.',
    why: 'Méně SKU = méně přestaveb. Kapacita se počítá v kusech, takže 1 kg balení nese víc marže na kapacitní slot.',
    needs: ['sales', 'production'],
  },
  run(ctx) {
    const { a, cfg } = ctx;
    const ranked = Object.values(a.econLatest)
      .filter((e) => e.marginPerCapacity > 0)
      .sort((x, y) => y.marginPerCapacity - x.marginPerCapacity);
    if (!ranked.length) return [];
    const pick = ranked.slice(0, cfg.sortimentSize);
    const drop = ranked.slice(cfg.sortimentSize);
    // niches: SKUs the market buys but we don't sell
    const niches = a.pricing
      .filter((p) => p.ourPrice === null && p.marketAvg !== null && p.marketAvg - p.unitCost > (pick.at(-1)?.marginPerUnit ?? 0))
      .map((p) => `${p.sku} (trh ${fmtPrice(p.marketAvg)}, náklad ${fmtPrice(p.unitCost)})`);
    return [
      {
        id: `R2:r${a.clock.round}`,
        ruleId: 'R2',
        priority: 'střední',
        title: `Sortiment: ${pick.map((p) => p.sku).join(', ')}`,
        tcode: 'MD61 / CO41',
        steps: [
          `Vyráběj přednostně: ${pick.map((p) => `${p.sku} (${fmtPrice(p.marginPerCapacity)}/ks)`).join(', ')}`,
          drop.length ? `Omez / vyřaď: ${drop.map((p) => p.sku).join(', ')}` : 'Ostatní SKU jen na doprodej.',
          ...(niches.length ? [`Zvaž niku: ${niches.join('; ')}`] : []),
        ],
        why: {
          summary: 'Řazeno podle marže na kus kapacity (průměrná cena − unit cost) z posledního kola.',
          data: ranked.map((e) => ({ label: skuLabel(e.sku), value: `${fmtPrice(e.marginPerCapacity)}/ks · prodáno ${fmtNum(e.qty)} ks` })),
          rule: ruleLabel(R2.meta),
          risk: 'Marže je z minulých cen; trh se hýbe. 1 kg nejde do DC 14, 500 g nejde do DC 10.',
          confidence: 'pravděpodobné',
        },
      },
    ];
  },
};

export const R3: Rule = {
  meta: {
    id: 'R3',
    name: 'Nevyužité kanály',
    phases: ['pred', 'start', 'beh', 'konec'],
    summary: 'DC s nulovými prodeji, kam smí naše balení → nastav cenu ve VK32.',
    why: 'Bez ceny ve VK32 se v kanálu neprodá nic. DC 10 bere jen 1 kg, DC 14 jen 500 g, DC 12 obojí.',
    needs: ['sales'],
  },
  run(ctx) {
    const { a, cfg } = ctx;
    if (!a.has.sales) return [];
    const cards: ActionCard[] = [];
    const remainingDays = Math.max(a.clock.daysLeftInGame, 0);
    for (const ch of a.channels) {
      if (ch.qty > 0) continue;
      const conf = cfg.channels.find((c) => c.dc === ch.dc)!;
      const skus = a.pricing.filter((p) => conf.sizes.includes(skuSize(p.sku)) && (p.ourPrice !== null || a.econLatest[p.sku]));
      const list = (skus.length ? skus : a.pricing.filter((p) => conf.sizes.includes(skuSize(p.sku)) && p.marketAvg !== null)).map((p) => {
        const price = Math.max(round2(Math.round(((p.marketAvg ?? p.ourPrice ?? p.unitCost * 2) * 20)) / 20), p.floor);
        return { sku: p.sku, price, margin: price - p.unitCost };
      });
      if (!list.length) continue;
      const marginRatio = list.reduce((s, x) => s + x.margin / x.price, 0) / list.length;
      const profit = (conf.marketPer5DaysPerTeam * remainingDays) / 5 * marginRatio;
      const first = list[0];
      const s = steps(ctx, 'price', { mat: first.sku, dc: ch.dc, price: sapValue(first.price) });
      cards.push({
        id: `R3:DC${ch.dc}`,
        ruleId: 'R3',
        priority: 'vysoká',
        title: `DC ${ch.dc} (${ch.name}) má 0 prodejů – nastav ceny ve VK32`,
        impactEUR: ctx.toValuation(profit),
        profitEUR: profit,
        tcode: s.tcode,
        steps: [s.steps[0], ...list.map((x) => `Materiál ${x.sku}, DC ${ch.dc} → cena ${fmtPrice(x.price)}`), s.steps.at(-1)!],
        copyValues: list.map((x) => ({ label: `${x.sku} DC ${ch.dc}`, value: sapValue(x.price) })),
        why: {
          summary: `V DC ${ch.dc} jsme za celou hru neprodali ani kus. Pravděpodobně tam chybí cena ve VK32.`,
          data: [
            { label: 'Balení povolené v kanálu', value: conf.sizes.join(', ') },
            { label: 'Trh kanálu / tým / 5 dní (briefing)', value: fmtEUR(conf.marketPer5DaysPerTeam) },
            { label: 'Citlivost na reklamu', value: conf.marketingSensitivity },
            { label: 'Zbývá dní hry', value: fmtNum(remainingDays) },
            { label: 'Prům. marže (%)', value: `${fmtNum(marginRatio * 100)} %` },
          ],
          rule: ruleLabel(R3.meta),
          risk: 'Zboží je jen jedno – prodej v novém kanálu bere sklad z DC 12. Vyplatí se hlavně když máme přebytek nebo vyšší cenu.',
          confidence: 'odhad',
        },
      });
    }
    return cards;
  },
};
