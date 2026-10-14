import type { PackKey, RawKey } from '@copilot/config';
import { mixAtCapacity, materialNeeds, plannedUnitsWithin, type MaterialNeed } from '../analysis/production.ts';
import { cheapestRecipe, formatRecipe, PACK_NAMES, RAW_NAMES, recipeCostPerKg, unitCostFromBom } from '../bom.ts';
import { fmtEUR, fmtNum, fmtPrice, sapValue } from '../format.ts';
import { skuFlavor, skuKg, skuLabel } from '../normalize.ts';
import { avgMargin, ruleLabel, steps, type Rule, type RuleCtx } from './common.ts';

const matName = (m: string) => RAW_NAMES[m as RawKey] ?? PACK_NAMES[m as PackKey] ?? m;

/** Planned consumption for the next `days` days: production plan, else latest mix at full capacity. */
export function needsFor(ctx: RuleCtx, days: number): { needs: MaterialNeed[]; basis: string } {
  const { a, ds, cfg } = ctx;
  let units = plannedUnitsWithin(a.plan, days);
  let basis = `plán výroby na ${fmtNum(days)} dní`;
  const planned = Object.values(units).reduce((s, x) => s + x, 0);
  if (days > a.plan.horizonDays || planned === 0) {
    // beyond the plan horizon (or no plan): assume full capacity with latest product mix
    const extra = mixAtCapacity(a.econLatest, cfg, Math.max(0, days - (planned ? a.plan.horizonDays : 0)));
    for (const [k, v] of Object.entries(extra)) units[k] = (units[k] ?? 0) + v;
    basis = planned ? `plán výroby + plná kapacita do ${fmtNum(days)} dní` : `plná kapacita × mix posledního kola, ${fmtNum(days)} dní`;
  }
  return { needs: materialNeeds(ds, cfg, units, a.prices), basis };
}

function purchaseSteps(ctx: RuleCtx, lines: MaterialNeed[]): { tcode: string; steps: string[]; copy: { label: string; value: string }[] } {
  const byVendor = new Map<string, MaterialNeed[]>();
  for (const l of lines) byVendor.set(l.vendor, [...(byVendor.get(l.vendor) ?? []), l]);
  const out: string[] = [];
  let tcode = 'ME59N';
  for (const [vendor, ls] of byVendor) {
    const s = steps(ctx, 'purchase', { mat: ls.map((l) => l.material).join(', '), vendor, qty: '…' });
    tcode = s.tcode;
    out.push(`${s.steps[0]} – dodavatel ${vendor}`);
    for (const l of ls) out.push(`${l.material} ${matName(l.material)}: ${fmtNum(l.orderQty)} ${l.unit === 'KG' ? 'kg' : 'ks'}`);
    out.push(s.steps.at(-1)!);
  }
  return { tcode, steps: out, copy: lines.map((l) => ({ label: `${l.material} (${l.vendor})`, value: sapValue(l.orderQty, 0) })) };
}

const needData = (lines: MaterialNeed[]) =>
  lines.map((l) => ({
    label: `${l.material} ${matName(l.material)}`,
    value: `potřeba ${fmtNum(l.need)} · sklad ${fmtNum(l.stock)} · v cestě ${fmtNum(l.openPO)} → objednat ${fmtNum(l.orderQty)}`,
  }));

export const R4: Rule = {
  meta: {
    id: 'R4',
    name: 'Suroviny na rozjezd',
    phases: ['pred', 'start', 'beh', 'konec'],
    summary: 'Sklad surovin/obalů nepokryje spotřebu na příštích N dní → objednej hned.',
    why: 'Lead time 1–5 dní. Ve cvičné hře stála výroba na začátku kola 3 pět dní, protože suroviny se objednaly až v ten den.',
    needs: ['inventory'],
  },
  run(ctx) {
    const { a, cfg } = ctx;
    if (!a.has.inventory) return [];
    // critical = not covered for the next N days; at round end the quantity also covers the next round's start
    const short = needsFor(ctx, cfg.purchaseHorizonDays).needs.filter((n) => n.shortfallNoPO > 0 && n.shortfall > 0);
    if (!short.length) return [];
    const days = cfg.purchaseHorizonDays + (a.clock.phase === 'konec' ? a.clock.daysLeftInRound : 0);
    const { needs, basis } = needsFor(ctx, days);
    const critical = needs.filter((n) => n.shortfall > 0);
    const p = purchaseSteps(ctx, critical);
    const leadAvg = (1 + cfg.leadTimeDaysMax) / 2;
    const profit = leadAvg * cfg.capacityPerDay * avgMargin(a);
    const value = critical.reduce((s, l) => s + l.orderQty * l.price, 0);
    return [
      {
        id: `R4:d${a.clock.gameDay}`,
        ruleId: 'R4',
        priority: 'kritické',
        title: `Objednej suroviny HNED – ${critical.length} materiálů nepokryje ${fmtNum(days)} dní výroby`,
        impactEUR: ctx.toValuation(profit),
        profitEUR: profit,
        deadline: 'teď – dodání trvá 1–5 dní',
        tcode: p.tcode,
        steps: p.steps,
        copyValues: p.copy,
        why: {
          summary: `Bez surovin se zastaví výroba; průměrné čekání ${fmtNum(leadAvg, 1)} dne = ${fmtNum(leadAvg * cfg.capacityPerDay)} ks nevyrobeno.`,
          data: [{ label: 'Základ výpočtu', value: basis }, { label: 'Hodnota objednávky', value: fmtEUR(value) }, ...needData(critical)],
          rule: ruleLabel(R4.meta),
          risk: 'Spotřeba je odvozená z plánu výroby a výchozího receptu – při jiném plánu uprav množství.',
          confidence: 'pravděpodobné',
        },
      },
    ];
  },
};

export const R4b: Rule = {
  meta: {
    id: 'R4b',
    name: 'Nákupní plán',
    phases: ['start', 'beh'],
    summary: 'Potřeba (BOM × plán výroby) − sklad − otevřené PO > 0 → objednej konkrétní množství.',
    why: 'Průběžné objednávání podle plánu udrží linku v chodu bez zbytečného skladu. Obaly se zaokrouhlují na násobky dávky.',
    needs: ['inventory', 'purchases'],
  },
  run(ctx) {
    const { a, cfg } = ctx;
    if (!a.has.inventory) return [];
    const days = cfg.purchaseHorizonDays + cfg.leadTimeDaysMax;
    const short = needsFor(ctx, cfg.purchaseHorizonDays).needs.filter((n) => n.shortfallNoPO > 0 && n.shortfall > 0);
    if (short.length) return []; // R4 covers it
    const { needs, basis } = needsFor(ctx, days);
    const lines = needs.filter((n) => n.shortfall > 0);
    if (!lines.length) return [];
    const p = purchaseSteps(ctx, lines);
    return [
      {
        id: `R4b:d${a.clock.gameDay}`,
        ruleId: 'R4b',
        priority: 'vysoká',
        title: `Nákupní plán: objednej ${lines.length} materiálů na dalších ${fmtNum(days)} dní`,
        deadline: `do ${fmtNum(cfg.purchaseHorizonDays)} dní`,
        tcode: p.tcode,
        steps: p.steps,
        copyValues: p.copy,
        why: {
          summary: 'Současný sklad a objednávky na cestě pokryjí nejbližší dny, ale ne celý horizont včetně lead time.',
          data: [{ label: 'Základ výpočtu', value: basis }, ...needData(lines)],
          rule: ruleLabel(R4b.meta),
          confidence: 'pravděpodobné',
        },
      },
    ];
  },
};

export const R5: Rule = {
  meta: {
    id: 'R5',
    name: 'Výroba musí běžet',
    phases: ['pred', 'start', 'beh', 'konec'],
    summary: 'Žádná otevřená výrobní zakázka → linka stojí.',
    why: 'Každý den bez výroby = 24 000 ks nevyrobených s marží. Fixní náklady běží dál.',
    needs: ['production'],
  },
  run(ctx) {
    const { a, cfg } = ctx;
    if (!a.has.production || a.openOrders.length) return [];
    const run = a.plan.runs[0];
    const profit = cfg.capacityPerDay * avgMargin(a);
    const s = steps(ctx, 'production', { mat: run ? `${run.sku} (${run.orders.map((o) => fmtNum(o)).join(' + ')} ks)` : 'podle plánu R8' });
    return [
      {
        id: `R5:d${a.clock.gameDay}`,
        ruleId: 'R5',
        priority: 'kritické',
        title: run ? `Linka stojí – pusť výrobu ${skuLabel(run.sku)}, ${fmtNum(run.qty)} ks` : 'Linka stojí – žádná otevřená výrobní zakázka',
        impactEUR: ctx.toValuation(profit),
        profitEUR: profit,
        deadline: 'teď',
        ...s,
        copyValues: run ? [{ label: run.sku, value: sapValue(run.qty, 0) }] : [],
        why: {
          summary: 'V ProductionReport není žádná zakázka, která by ještě běžela nebo čekala.',
          data: [
            { label: 'Poslední zakázka končí', value: `den ${Math.max(0, ...ctx.ds.production.map((p) => p.finish ?? 0))}` },
            { label: 'Aktuální herní den', value: String(a.clock.gameDay) },
            { label: 'Ztráta za 1 den stání', value: fmtEUR(profit) },
          ],
          rule: ruleLabel(R5.meta),
          risk: 'Zkontroluj suroviny (R4) – bez nich zakázka nepoběží.',
          confidence: 'jisté',
        },
      },
    ];
  },
};

export const R15: Rule = {
  meta: {
    id: 'R15',
    name: 'Levnější recept',
    phases: ['pred', 'start', 'beh', 'konec'],
    summary: 'Recepty jsou minima – nejlevnější validní recept (víc ovsa) šetří náklad na kus.',
    why: 'Minimum je ≥ 30 % oats, ≥ 20 % wheat, ≥ 20 % příchuť. Zbytek do nejlevnější suroviny (oats 0,92 €/kg). Úspora se násobí celým objemem výroby.',
    needs: ['sourcing'],
  },
  run(ctx) {
    const { a, cfg } = ctx;
    const remainingRounds = Math.max(1, cfg.rounds - a.clock.round + (a.clock.phase === 'pred' || a.clock.day < cfg.roundLength / 2 ? 1 : 0));
    const rows = Object.values(a.econLatest)
      .map((e) => {
        const flavor = skuFlavor(e.sku);
        const cur = cfg.recipes[flavor];
        const best = cheapestRecipe(flavor, cfg, a.prices);
        const saving = (recipeCostPerKg(cur, a.prices) - recipeCostPerKg(best, a.prices)) * skuKg(e.sku);
        return { sku: e.sku, saving, best, qty: e.qty, newCost: unitCostFromBom(e.sku, cfg, a.prices, best) };
      })
      .filter((r) => r.saving > 0.005)
      .sort((x, y) => y.saving * y.qty - x.saving * x.qty);
    if (!rows.length) return [];
    const perRound = rows.reduce((s, r) => s + r.saving * r.qty, 0);
    const profit = perRound * remainingRounds;
    const first = rows[0];
    const s = steps(ctx, 'bom', { mat: first.sku, recipe: formatRecipe(first.best) });
    return [
      {
        id: 'R15',
        ruleId: 'R15',
        priority: 'střední',
        title: `Levnější recept: úspora až ${fmtPrice(first.saving)}/ks u ${first.sku}, ~${fmtEUR(perRound)} za kolo`,
        impactEUR: ctx.toValuation(profit),
        profitEUR: profit,
        tcode: s.tcode,
        steps: [
          'Nejdřív otestuj na jednom SKU a sleduj poptávku 2–3 dny.',
          ...rows.map((r) => `${r.sku}: ${formatRecipe(r.best)} → unit cost ${fmtPrice(r.newCost)} (−${fmtPrice(r.saving)})`),
          ...s.steps,
        ],
        why: {
          summary: 'Aktuální recept 35/35/30 je dražší než nejlevnější validní recept podle cen z ProcSourcing.',
          data: rows.map((r) => ({ label: skuLabel(r.sku), value: `−${fmtPrice(r.saving)}/ks × ${fmtNum(r.qty)} ks/kolo = ${fmtEUR(r.saving * r.qty)}` })),
          rule: ruleLabel(R15.meta),
          risk: cfg.recipeAffectsDemand
            ? 'Složení podle nastavení OVLIVŇUJE poptávku – úspora může být menší než ztráta prodejů.'
            : 'Možný vliv na poptávku [OVĚŘIT] – nejdřív otestuj na jednom SKU. Ověř, že BOM jde v této verzi hry měnit.',
          confidence: 'odhad',
        },
      },
    ];
  },
};
