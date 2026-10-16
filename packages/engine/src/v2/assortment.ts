// "Plošně a po 1. kole rozseknout": round 1 produces the ticked assortment; once a full round of data
// exists, rank those SKUs by market revenue × our margin rate and keep the best N (≥ 1 per pack size).
import type { GameConfig } from '@copilot/config';
import type { Analysis } from '../analysis/index.ts';
import { skuSize } from '../normalize.ts';
import type { Dataset } from '../types.ts';

export type AssortmentRow = {
  sku: string;
  marketRevenue: number; // all teams, completed rounds (ZMARKET), else our own revenue
  marketShareOfRevenue: number; // 0..1 within the pool
  price: number; // market average (or ours)
  unitCost: number;
  marginRate: number; // (price − unitCost) / price
  score: number; // marketRevenue × marginRate
  keep: boolean;
};

export type AssortmentReview = {
  basis: 'ZMARKET' | 'naše prodeje';
  rounds: number; // completed rounds the review is based on
  rows: AssortmentRow[]; // best first
  keep: string[];
  drop: string[];
};

const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);

/** null until a full round (day ≥ roundLength) of market or sales data exists. */
export function assortmentReview(ds: Dataset, cfg: GameConfig, a: Analysis): AssortmentReview | null {
  const done = Math.floor(a.clock.gameDay / cfg.roundLength);
  if (a.clock.phase === 'pred-hrou' || done < 1) return null;
  const until = done * cfg.roundLength;
  const market = ds.market.filter((m) => m.gameDay <= until);
  const useMarket = market.length > 0;
  const src = useMarket
    ? market.map((m) => ({ sku: m.material, q: m.quantity, v: m.value }))
    : ds.sales.filter((s) => s.gameDay <= until).map((s) => ({ sku: s.material, q: s.quantity, v: s.netValue }));
  if (!src.length) return null;
  const pool = cfg.assortment; // only what the team ticked in Nastavení
  const total = sum(src.filter((r) => pool.includes(r.sku)).map((r) => r.v)) || 1;
  const rows: AssortmentRow[] = pool.map((sku) => {
    const mine = src.filter((r) => r.sku === sku);
    const q = sum(mine.map((r) => r.q));
    const v = sum(mine.map((r) => r.v));
    const price = q ? v / q : 0;
    const unitCost = a.costs[sku]?.cost ?? 0;
    const marginRate = price > 0 ? Math.max(0, (price - unitCost) / price) : 0;
    return { sku, marketRevenue: v, marketShareOfRevenue: v / total, price, unitCost, marginRate, score: v * marginRate, keep: false };
  });
  rows.sort((x, y) => y.score - x.score);
  const n = Math.min(cfg.assortmentTarget, rows.length);
  const keep = new Set(rows.slice(0, n).map((r) => r.sku));
  // every pack size must stay (DC 10 = 1 kg only, DC 14 = 500 g only): swap the weakest kept for the best missing
  for (const size of ['1kg', '500g'] as const) {
    if ([...keep].some((s) => skuSize(s) === size)) continue;
    const best = rows.find((r) => skuSize(r.sku) === size && r.score > 0);
    if (!best) continue;
    const weakest = [...rows].reverse().find((r) => keep.has(r.sku) && [...keep].filter((s) => skuSize(s) === skuSize(r.sku)).length > 1);
    if (weakest) keep.delete(weakest.sku);
    keep.add(best.sku);
  }
  for (const r of rows) r.keep = keep.has(r.sku);
  return {
    basis: useMarket ? 'ZMARKET' : 'naše prodeje',
    rounds: done,
    rows,
    keep: rows.filter((r) => r.keep).map((r) => r.sku),
    drop: rows.filter((r) => !r.keep).map((r) => r.sku),
  };
}

/** What MD61 plans for: round 1 = settings; afterwards the review (when auto). */
export function effectiveAssortment(cfg: GameConfig, review: AssortmentReview | null): string[] {
  return cfg.assortmentAuto && review ? review.keep : cfg.assortment;
}
