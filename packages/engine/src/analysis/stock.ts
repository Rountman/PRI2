import type { GameConfig } from '@copilot/config';
import { isFinishedGood } from '../normalize.ts';
import type { Dataset } from '../types.ts';
import { dailySales, finishedStock } from './sales.ts';

export type StockPath = {
  /** sku → start-of-day available stock, index = gameDay (1..lastDay) */
  bySku: Record<string, number[]>;
  initial: Record<string, number>;
  initialSource: 'PO V03' | 'config' | 'none';
  lastDay: number;
  /** reconstructed end stock vs. inventory snapshot (sanity check) */
  check: { sku: string; reconstructed: number; inventory: number }[];
};

/**
 * Reconstruct daily finished-goods stock: initial stock + finished production − sales.
 * Initial stock = purchases from ignored vendors (V03 = starting stock in Intro), else config.
 */
export function stockPath(ds: Dataset, cfg: GameConfig, lastDay: number): StockPath {
  const sales = dailySales(ds);
  const initial: Record<string, number> = {};
  let initialSource: StockPath['initialSource'] = 'none';
  for (const p of ds.purchases) {
    if (cfg.ignoreVendors.includes(p.vendor) && isFinishedGood(p.material)) {
      initial[p.material] = (initial[p.material] ?? 0) + p.quantity;
      initialSource = 'PO V03';
    }
  }
  if (initialSource === 'none' && cfg.initial.finishedGoodsPerSku > 0) {
    // config: only SKUs that sold before they were ever produced had starting stock
    for (const [sku, m] of sales) {
      const firstProd = Math.min(...ds.production.filter((p) => p.material === sku).map((p) => p.finish ?? Infinity));
      const soldBefore = [...m.entries()].some(([g, v]) => v.qty > 0 && g < firstProd);
      if (soldBefore) initial[sku] = cfg.initial.finishedGoodsPerSku;
    }
    initialSource = 'config';
  }
  const produced = new Map<string, Map<number, number>>();
  for (const p of ds.production) {
    if (p.finish === null) continue;
    const m = produced.get(p.material) ?? new Map<number, number>();
    m.set(p.finish, (m.get(p.finish) ?? 0) + (p.confirmed || 0));
    produced.set(p.material, m);
  }
  const skus = new Set([...Object.keys(initial), ...sales.keys(), ...produced.keys()].filter(isFinishedGood));
  const bySku: Record<string, number[]> = {};
  for (const sku of skus) {
    const arr: number[] = new Array(lastDay + 2).fill(0);
    let s = initial[sku] ?? 0;
    for (let g = 1; g <= lastDay + 1; g++) {
      s += produced.get(sku)?.get(g) ?? 0; // finished on day g → sellable on day g
      arr[g] = Math.max(0, s);
      s -= sales.get(sku)?.get(g)?.qty ?? 0;
    }
    bySku[sku] = arr;
  }
  const inv = finishedStock(ds);
  const check = ds.inventory.length
    ? [...skus].sort().map((sku) => ({ sku, reconstructed: bySku[sku][lastDay + 1] ?? 0, inventory: inv[sku] ?? 0 }))
    : [];
  return { bySku, initial, initialSource, lastDay, check };
}

/**
 * Demand rate over the last `n` in-stock days (scanning back at most `maxLookback` days from `to`).
 * Stock-out days are skipped so they don't fake low demand.
 */
export function recentDemand(path: StockPath, ds: Dataset, sku: string, to: number, n: number, maxLookback = 20): { rate: number; inStockDays: number } {
  const sales = dailySales(ds).get(sku);
  let sold = 0;
  let days = 0;
  for (let g = to; g > Math.max(0, to - maxLookback) && days < n; g--) {
    const q = sales?.get(g)?.qty ?? 0;
    if ((path.bySku[sku]?.[g] ?? 0) > 0 || q > 0) {
      days++;
      sold += q;
    }
  }
  return { rate: days ? sold / days : 0, inStockDays: days };
}

/** Demand rate when in stock: units sold / days with stock (start-of-day stock > 0) in [from, to]. */
export function inStockDemand(path: StockPath, ds: Dataset, sku: string, from: number, to: number): { rate: number; inStockDays: number } {
  const sales = dailySales(ds).get(sku);
  let sold = 0;
  let days = 0;
  for (let g = Math.max(1, from); g <= to; g++) {
    const st = path.bySku[sku]?.[g] ?? 0;
    const q = sales?.get(g)?.qty ?? 0;
    if (st > 0 || q > 0) {
      days++;
      sold += q;
    }
  }
  return { rate: days ? sold / days : 0, inStockDays: days };
}
