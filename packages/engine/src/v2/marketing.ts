// ZADS suggestion for Rozšířené → Marketing. ZADS is planned per product × region (North / South / West),
// so there is one row per SKU × region. Instructor feedback (round 2): marketing was 1,34 % of revenue and did not pay off
// → only symbolic amounts (≈ 50–100 €/day), only for products in stock, only in the key region (largest market for
// the product in the latest ZMARKET), everything else 0. `marketingEurPerRegionDay` = 0 switches it off.
import type { Area, Sensitivity } from '@copilot/config';
import { allowedDcs, type Model } from './model.ts';
import { fmtNum } from '../format.ts';

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
    // key region = largest market for this product in the latest ZMARKET window (none known → all regions)
    const vol: Partial<Record<Area, number>> = {};
    if (lastMarket !== null) for (const ar of cfg.areas) vol[ar] = sum(ds.market.filter((r) => r.material === sku && r.area === ar && r.gameDay === lastMarket).map((r) => r.quantity));
    const key = cfg.areas.some((ar) => (vol[ar] ?? 0) > 0) ? [...cfg.areas].sort((a, b) => (vol[b] ?? 0) - (vol[a] ?? 0))[0] : null;

    for (const area of cfg.areas) {
      const isKey = key === null || area === key;
      const advise = reacts && hasStock && isKey && base > 0;
      out.push({
        sku,
        mat: m.mat(sku),
        area,
        dcs,
        sensitivity,
        coverDays: cover,
        share: share[area] ?? null,
        eurPerDay: advise ? Math.max(10, Math.round(base / 10) * 10) : 0,
        advise,
        reason:
          base <= 0
            ? 'marketing vypnutý (Nastavení)'
            : !reacts
              ? `DC ${dcs.join('/')} na reklamu skoro nereaguje`
              : !hasStock
                ? 'málo zboží – reklama by jen pálila peníze'
                : !isKey
                  ? `jen klíčový region ${key} – jinde 0 (šetříme)`
                  : key === null
                    ? 'symbolická částka, sleduj prodeje'
                    : `klíčový region (největší trh, pokrytí ${cover === null ? '∞' : fmtNum(cover, 1)} dne) – symbolicky`,
      });
    }
  }
  return out;
}
