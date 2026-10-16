// ZADS suggestion for Rozšířené → Marketing. ZADS is planned per product × region (North / South / West),
// so there is one row per SKU × region. Advertise only when the product's channels react to ads and stock is there;
// the region where our market share is lowest gets +50 % (most room to grow).
import type { Area, Sensitivity } from '@copilot/config';
import { allowedDcs, type Model } from './model.ts';

export type MarketingRow = {
  sku: string;
  mat: string;
  area: Area;
  dcs: string[]; // channels the pack size is sold in
  sensitivity: Sensitivity; // strongest reaction among those channels
  coverDays: number | null;
  share: number | null; // our share of the market in this region (last ZMARKET window), 0..1
  eurPerDay: number;
  advise: boolean;
  reason: string;
};

const RANK: Record<Sensitivity, number> = { nízká: 0, střední: 1, vysoká: 2, 'velmi vysoká': 3 };
const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);

export function marketingTable(m: Model): MarketingRow[] {
  const { cfg, ds } = m;
  const out: MarketingRow[] = [];
  const lastMarket = ds.market.length ? Math.max(...ds.market.map((r) => r.gameDay)) : null;
  for (const sku of m.skus.filter((s) => m.assortment.includes(s))) {
    const dcs = allowedDcs(cfg, sku);
    const chans = cfg.channels.filter((c) => dcs.includes(c.dc));
    const sensitivity = chans.map((c) => c.marketingSensitivity).sort((a, b) => RANK[b] - RANK[a])[0] ?? 'nízká';
    const stock = Math.max(0, m.stock[sku] ?? 0);
    const d = m.demand[sku].perDay;
    const cover = m.pregame ? null : d > 0 ? stock / d : null;
    const reacts = RANK[sensitivity] >= RANK['střední'];
    const hasStock = m.pregame || (cover !== null ? cover >= cfg.pricing.lowCoverDays + 2 : stock > 0);
    const base = sensitivity === 'vysoká' || sensitivity === 'velmi vysoká' ? cfg.marketingEurPerRegionDay : cfg.marketingEurPerRegionDay / 2;

    // our share per region in the latest ZMARKET window (5 days)
    const share: Partial<Record<Area, number>> = {};
    if (lastMarket !== null) {
      for (const ar of cfg.areas) {
        const mk = sum(ds.market.filter((r) => r.material === sku && r.area === ar && r.gameDay === lastMarket).map((r) => r.quantity));
        const ours = sum(ds.sales.filter((s) => s.material === sku && s.area === ar && s.gameDay > lastMarket - 5 && s.gameDay <= lastMarket).map((s) => s.quantity));
        if (mk > 0) share[ar] = Math.min(1, ours / mk);
      }
    }
    const known = cfg.areas.filter((ar) => share[ar] !== undefined);
    const sorted = [...known].sort((a, b) => share[a]! - share[b]!);
    // boost only a clear loser: all regions known and the lowest share strictly below the next one
    const weakest = known.length === cfg.areas.length && share[sorted[0]]! < share[sorted[1]]! ? sorted[0] : null;

    for (const area of cfg.areas) {
      const advise = reacts && hasStock;
      const boost = advise && area === weakest ? 1.5 : 1;
      out.push({
        sku,
        mat: m.mat(sku),
        area,
        dcs,
        sensitivity,
        coverDays: cover,
        share: share[area] ?? null,
        eurPerDay: advise ? Math.round((base * boost) / 50) * 50 : 0,
        advise,
        reason: !reacts
          ? `DC ${dcs.join('/')} na reklamu skoro nereaguje`
          : !hasStock
            ? 'málo zboží – reklama by jen pálila peníze'
            : m.pregame
              ? 'start: malá částka, sleduj prodeje'
              : area === weakest
                ? 'nejnižší podíl na trhu – nejvíc prostoru růst (+50 %)'
                : `zboží je (pokrytí ${cover === null ? '∞' : cover.toFixed(1)} dne)`,
      });
    }
  }
  return out;
}
