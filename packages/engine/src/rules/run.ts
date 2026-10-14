import { fmtEUR, fmtNum, fmtPrice, sapValue } from '../format.ts';
import { AREA_CS, skuLabel, skuSize } from '../normalize.ts';
import type { ActionCard } from '../types.ts';
import { avgMargin, horizonDays, ruleLabel, steps, type Rule, type RuleCtx } from './common.ts';
import type { PricePosition } from '../analysis/sales.ts';

const priceData = (p: PricePosition) => [
  { label: 'Naše cena (posl. 5 dní)', value: fmtPrice(p.ourPrice) },
  { label: `Trh průměr (${p.marketWindow ?? '–'})`, value: fmtPrice(p.marketAvg) },
  { label: 'Trh min / max', value: `${fmtPrice(p.marketMin)} / ${fmtPrice(p.marketMax)}` },
  { label: 'Sklad', value: `${fmtNum(p.coverage?.stock ?? 0)} ks` },
  { label: 'Prodej / den (dny se skladem)', value: fmtNum(p.coverage?.avgDaily ?? 0) },
  { label: 'Dny pokrytí', value: fmtNum(p.coverage?.days ?? 0, 1) },
  { label: 'Unit cost (minimum ceny)', value: fmtPrice(p.floor) },
];

function priceCard(ctx: RuleCtx, rule: Rule, p: PricePosition, profit: number, priority: ActionCard['priority'], title: string, summary: string, risk: string): ActionCard {
  const dcs = p.dcs.length ? p.dcs : ['12'];
  const s = steps(ctx, 'price', { mat: p.sku, dc: dcs.join(', '), price: sapValue(p.recommended!) });
  return {
    id: `${rule.meta.id}:${p.sku}:d${ctx.a.clock.gameDay}`,
    ruleId: rule.meta.id,
    priority,
    title,
    impactEUR: ctx.toValuation(profit),
    profitEUR: profit,
    ...s,
    copyValues: [{ label: `${p.sku} cena`, value: sapValue(p.recommended!) }],
    why: { summary, data: priceData(p), rule: ruleLabel(rule.meta), risk, confidence: 'pravděpodobné' },
  };
}

export const R6: Rule = {
  meta: {
    id: 'R6',
    name: 'Cena nahoru',
    phases: ['start', 'beh', 'konec'],
    summary: 'Vyprodáno nebo < 3 dny pokrytí a cena ≤ trh + 10 % → zvedni o krok.',
    why: 'Když prodáváš všechno, co vyrobíš, necháváš peníze na stole. Vyšší cena = stejný objem, vyšší marže.',
    needs: ['sales', 'inventory', 'market'],
  },
  run(ctx) {
    return ctx.a.pricing
      .filter((p) => p.action === 'zvýšit' && p.recommended !== null && p.delta !== null)
      .map((p) => {
        const profit = p.delta! * (p.coverage?.avgDaily ?? 0) * horizonDays(ctx);
        return priceCard(
          ctx,
          R6,
          p,
          profit,
          'vysoká',
          `Zvyš cenu ${skuLabel(p.sku)} na ${fmtPrice(p.recommended)} (+${fmtPrice(p.delta)})`,
          `${p.reason[0].toUpperCase()}${p.reason.slice(1)} a cena je v rámci trhu – zákazníci berou vše.`,
          'Když se prodeje zastaví při plném skladu, vrať cenu o krok zpět.',
        );
      });
  },
};

export const R7: Rule = {
  meta: {
    id: 'R7',
    name: 'Cena dolů',
    phases: ['start', 'beh', 'konec'],
    summary: '> 10 dní pokrytí → sniž směrem k tržnímu průměru, nikdy pod unit cost.',
    why: 'Sklad na konci hry se oceňuje v nákladech – neprodané zboží nenese žádnou marži a blokuje sklad.',
    needs: ['sales', 'inventory', 'market'],
  },
  run(ctx) {
    const { cfg } = ctx;
    return ctx.a.pricing
      .filter((p) => p.action === 'snížit' && p.recommended !== null)
      .map((p) => {
        const c = p.coverage!;
        const excess = Math.max(0, c.stock - cfg.pricing.highCoverageDays * c.avgDaily);
        const profit = excess * Math.max(0, p.recommended! - p.unitCost) * 0.5;
        return priceCard(
          ctx,
          R7,
          p,
          profit,
          'střední',
          `Sniž cenu ${skuLabel(p.sku)} na ${fmtPrice(p.recommended)} (${fmtPrice(p.delta)})`,
          `Sklad vydrží ${fmtNum(c.days, 0)} dní – hromadí se.`,
          'Nižší cena může spustit cenovou válku; snižuj po krocích.',
        );
      });
  },
};

export const R8: Rule = {
  meta: {
    id: 'R8',
    name: 'Výrobní pořadí',
    phases: ['pred', 'start', 'beh', 'konec'],
    summary: 'Plán dávek seřazený podle marže na kus × nedostatku, sdružený do běhů ≥ 2 dávek.',
    why: 'Nejvýnosnější SKU s největším nedostatkem jdou první; běhy po více dávkách minimalizují přestavby.',
    needs: ['sales', 'production', 'inventory'],
  },
  run(ctx) {
    const { a } = ctx;
    const plan = a.plan;
    if (!plan.runs.length) return [];
    const profit = plan.runs.reduce((s, r) => s + r.qty * r.marginPerUnit, 0);
    const s = steps(ctx, 'production', { mat: plan.runs.map((r) => r.sku).join(' → ') });
    return [
      {
        id: `R8:d${a.clock.gameDay}`,
        ruleId: 'R8',
        priority: 'vysoká',
        title: `Výrobní plán ${fmtNum(plan.horizonDays)} dní: ${plan.runs.map((r) => `${r.sku} ${fmtNum(r.qty / 1000)}k`).join(' → ')}`,
        impactEUR: ctx.toValuation(profit),
        profitEUR: profit,
        tcode: s.tcode,
        steps: [
          ...plan.runs.map(
            (r, i) =>
              `${i + 1}. ${skuLabel(r.sku)}: ${fmtNum(r.qty)} ks (${r.orders.map((o) => fmtNum(o)).join(' + ')}), den +${fmtNum(r.startDay, 1)} → +${fmtNum(r.endDay, 1)}${r.setupHours ? `, setup ${fmtNum(r.setupHours, 1)} h` : ''}`,
          ),
          ...s.steps,
        ],
        copyValues: plan.runs.flatMap((r) => r.orders.map((o, i) => ({ label: `${r.sku} #${i + 1}`, value: sapValue(o, 0) }))),
        why: {
          summary: `${fmtNum(plan.plannedUnits)} ks z kapacity ${fmtNum(plan.capacityUnits)}; ${plan.changeovers} přestavby (−${fmtNum(plan.setupLossUnits)} ks).`,
          data: plan.runs.map((r) => ({
            label: skuLabel(r.sku),
            value: `poptávka ${fmtNum(r.demandPerDay)}/den · sklad ${fmtNum(r.stock)} · chybí ${fmtNum(r.need)} · marže ${fmtPrice(r.marginPerUnit)}`,
          })),
          rule: ruleLabel(R8.meta),
          risk: `Poptávka = ${plan.demandSource}. Když konkurence zlevní, poptávka klesne.`,
          confidence: 'odhad',
        },
      },
    ];
  },
};

export const R9: Rule = {
  meta: {
    id: 'R9',
    name: 'Využití kapacity',
    phases: ['start', 'beh', 'konec'],
    summary: 'Prostoj linky > 0,5 dne v kole → najdi příčinu (suroviny, chybějící zakázky).',
    why: 'Fixní náklady i odpisy běží bez ohledu na výrobu. Nevyužitá kapacita je nejdražší ztráta.',
    needs: ['production'],
  },
  run(ctx) {
    const { a, cfg } = ctx;
    const cur = a.production.find((p) => p.round === a.clock.round);
    if (!cur || cur.idleDays.length <= cfg.idleThresholdDays) return [];
    const lost = cur.idleDays.length * cfg.capacityPerDay;
    const profit = lost * avgMargin(a);
    return [
      {
        id: `R9:r${cur.round}`,
        ruleId: 'R9',
        priority: 'vysoká',
        title: `Linka stála ${cur.idleDays.length} dní v kole ${cur.round} (využití ${fmtNum(cur.utilization * 100)} %)`,
        impactEUR: ctx.toValuation(profit),
        profitEUR: profit,
        tcode: 'CO41',
        steps: [
          `Dny bez zakázky: ${cur.idleDays.join(', ')}`,
          'Drž vždy ≥ 2 zakázky dopředu (R8) a suroviny na 5 dní (R4).',
          'Zkontroluj, že MRP běží a plánované zakázky jsou převedené (CO41).',
        ],
        why: {
          summary: `${fmtNum(lost)} ks kapacity nevyužito ≈ ${fmtEUR(profit)} marže.`,
          data: [
            { label: 'Vyrobeno', value: `${fmtNum(cur.produced)} ks` },
            { label: 'Kapacita za odehrané dny', value: `${fmtNum(cur.capacity)} ks` },
            { label: 'Přestavby', value: `${cur.setups} (${fmtNum(cur.setupHours)} h)` },
          ],
          rule: ruleLabel(R9.meta),
          confidence: 'jisté',
        },
      },
    ];
  },
};

export const R10: Rule = {
  meta: {
    id: 'R10',
    name: 'Marketing',
    phases: ['start', 'beh'],
    summary: 'Reklama (ZADS) jen v DC 14 / 500 g, a jen když je zboží skladem.',
    why: 'DC 14 má vysokou citlivost na reklamu, DC 10 skoro žádnou. Bez zboží reklama jen pálí peníze.',
    needs: ['sales', 'inventory'],
  },
  run(ctx) {
    const { a, ds, cfg } = ctx;
    const cards: ActionCard[] = [];
    for (const dc of cfg.marketingDcs) {
      const ch = cfg.channels.find((c) => c.dc === dc);
      if (!ch) continue;
      const sold = new Set(ds.sales.filter((s) => s.dc === dc).map((s) => s.material));
      for (const c of a.coverage) {
        if (!sold.has(c.sku) || !ch.sizes.includes(skuSize(c.sku)) || c.days < cfg.pricing.lowCoverageDays + 2) continue;
        // pick the region where we sell the least of this SKU
        const byArea = cfg.areas.map((ar) => ({ ar, q: ds.sales.filter((s) => s.dc === dc && s.material === c.sku && s.area === ar).reduce((x, s) => x + s.quantity, 0) }));
        const area = byArea.sort((x, y) => x.q - y.q)[0].ar;
        const eur = cfg.marketingEurPerRegionDay;
        const s = steps(ctx, 'marketing', { mat: c.sku, area: `${area} (${AREA_CS[area]})`, eur: fmtEUR(eur) });
        cards.push({
          id: `R10:${c.sku}:${area}:d${a.clock.gameDay}`,
          ruleId: 'R10',
          priority: 'střední',
          title: `Reklama ${skuLabel(c.sku)} v DC ${dc}, region ${AREA_CS[area]}: ${fmtEUR(eur)}/den`,
          ...s,
          copyValues: [{ label: 'Částka', value: sapValue(eur, 0) }],
          why: {
            summary: `Máme ${fmtNum(c.days, 1)} dne pokrytí – zboží je, reklama ho pomůže prodat.`,
            data: [
              { label: 'Sklad', value: `${fmtNum(c.stock)} ks` },
              { label: 'Citlivost DC na reklamu', value: ch.marketingSensitivity },
              ...byArea.map((x) => ({ label: `Prodáno ${AREA_CS[x.ar]}`, value: `${fmtNum(x.q)} ks` })),
            ],
            rule: ruleLabel(R10.meta),
            risk: 'Efekt reklamy nemáme změřený (chybí export ZADS) – začni malou částkou a sleduj prodeje.',
            confidence: 'odhad',
          },
        });
      }
    }
    return cards;
  },
};
