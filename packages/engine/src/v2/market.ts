// Market overview from the latest ZMARKET window (all teams, all 12 products) + "products we don't make but should look at".
import { fmtEUR, fmtNum, fmtPct } from '../format.ts';
import { skuLabel } from '../normalize.ts';
import type { ActionCard } from '../types.ts';
import { sapOrder, type Model } from './model.ts';

export type MarketOverviewRow = {
  sku: string;
  mat: string;
  label: string;
  qty: number; // whole market, latest window
  revenue: number;
  revenueShare: number; // of the whole market, 0..1
  price: number;
  ourQty: number; // our sales in the same 5 days
  ourShare: number; // 0..1
  unitCost: number;
  marginRate: number; // (market price − our unit cost) / market price
  score: number; // revenue × marginRate
  produced: boolean; // in the current assortment
};

export type MarketOverview = { gameDay: number; rows: MarketOverviewRow[] } | null;

const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);

export function marketOverview(m: Model): MarketOverview {
  const { ds } = m;
  if (m.pregame || !ds.market.length) return null;
  const last = Math.max(...ds.market.map((r) => r.gameDay));
  const win = ds.market.filter((r) => r.gameDay === last);
  const total = sum(win.map((r) => r.value)) || 1;
  const skus = [...new Set(win.map((r) => r.material))];
  const rows = skus.map((sku): MarketOverviewRow => {
    const mk = win.filter((r) => r.material === sku);
    const qty = sum(mk.map((r) => r.quantity));
    const revenue = sum(mk.map((r) => r.value));
    const price = qty ? revenue / qty : 0;
    const ourQty = sum(ds.sales.filter((s) => s.material === sku && s.gameDay > last - 5 && s.gameDay <= last).map((s) => s.quantity));
    const unitCost = m.a.costs[sku]?.cost ?? 0;
    const marginRate = price > 0 ? Math.max(0, (price - unitCost) / price) : 0;
    return {
      sku,
      mat: m.mat(sku),
      label: skuLabel(sku),
      qty,
      revenue,
      revenueShare: revenue / total,
      price,
      ourQty,
      ourShare: qty ? Math.min(1, ourQty / qty) : 0,
      unitCost,
      marginRate,
      score: revenue * marginRate,
      produced: m.assortment.includes(sku),
    };
  });
  rows.sort((a, b) => b.revenue - a.revenue);
  return { gameDay: last, rows };
}

/**
 * A product we don't make whose market revenue × margin beats our weakest produced product by `factor`
 * → recommendation (not automatic – the assortment only changes in Nastavení).
 */
export function missedProducts(m: Model, mo: MarketOverview, factor = 1.2): ActionCard[] {
  if (!mo) return [];
  const produced = mo.rows.filter((r) => r.produced);
  if (!produced.length) return [];
  const weakest = [...produced].sort((a, b) => a.score - b.score)[0];
  const ourShare = sum(produced.map((r) => r.ourQty)) / Math.max(1, sum(produced.map((r) => r.qty)));
  return mo.rows
    .filter((r) => !r.produced && r.score > weakest.score * factor)
    .slice(0, 2)
    .map((r) => {
      // extra margin if we sold the candidate instead of the weakest at our usual market share, for the rest of the game
      const per5 = (r.score - weakest.score) * ourShare;
      const profit = Math.max(0, per5) * (m.remainingDays / 5);
      return {
        id: `market:missed:${r.sku}:d${mo.gameDay}`,
        kind: 'trh',
        priority: 'běžné' as const,
        observation: `${r.mat} má ${fmtPct(r.revenueShare, 1)} tržeb trhu (cena ${fmtNum(r.price, 2)} €) a my ho nevyrábíme; náš nejslabší ${weakest.mat} má ${fmtPct(weakest.revenueShare, 1)}`,
        title: `Zvážit zařazení ${r.mat} do sortimentu místo ${weakest.mat} (Nastavení → Sortiment)`,
        profitEUR: profit,
        impactEUR: m.toValuation(profit),
        tcode: 'Nastavení → Sortiment, VK32, MD61',
        steps: [
          `Rozšířené → Nastavení → Sortiment: zaškrtnout ${r.sku}${m.cfg.assortmentAuto ? '' : `, odškrtnout ${weakest.sku}`}.`,
          `VK32: ceny ${r.mat} (appka je dopočítá v tabulce VK32).`,
          'MD61: prognóza podle tabulky MD61 při dalším cyklu.',
        ],
        why: {
          summary: `Podle posledního ZMARKET (všechny týmy) vychází ${r.mat} lépe než náš nejslabší výrobek – tržby trhu × marže o víc než ${Math.round((factor - 1) * 100)} %.`,
          data: [
            { label: r.mat, value: `trh ${fmtNum(r.qty)} ks · ${fmtEUR(r.revenue)} · marže ${fmtPct(r.marginRate)}` },
            { label: weakest.mat, value: `trh ${fmtNum(weakest.qty)} ks · ${fmtEUR(weakest.revenue)} · marže ${fmtPct(weakest.marginRate)}` },
            { label: 'Náš podíl na trhu (vyráběné)', value: fmtPct(ourShare, 1) },
            { label: 'Vyrábíme teď', value: sapOrder(m.assortment).map(m.mat).join(', ') },
          ],
          rule: 'Trh: nevyráběný výrobek > nejslabší vyráběný × 1,2',
          risk: `Každý výrobek navíc = přestavba linky v každém cyklu. ${r.sku.endsWith('5') || r.sku.endsWith('6') ? 'Recept Original/Mixed v appce není ověřený v SAPu [OVĚŘIT].' : ''}`.trim(),
          confidence: 'odhad',
        },
      };
    });
}
