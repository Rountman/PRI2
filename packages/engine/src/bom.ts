import type { GameConfig, PackKey, RawKey, Recipe } from '@copilot/config';
import { skuFlavor, skuKg, skuSize } from './normalize.ts';
import type { Dataset } from './types.ts';

export const RAW_NAMES: Record<RawKey, string> = {
  R01: 'Nuts',
  R02: 'Blueberries',
  R03: 'Strawberries',
  R04: 'Raisins',
  R05: 'Wheat',
  R06: 'Oats',
};
export const PACK_NAMES: Record<PackKey, string> = {
  P01: 'Large Box (1kg)',
  P02: 'Large Bag (1kg)',
  P03: 'Small Box (500g)',
  P04: 'Small Bag (500g)',
};
export const FLAVOR_RAW: Record<string, RawKey | null> = { '1': 'R01', '2': 'R02', '3': 'R03', '4': 'R04', '5': null, '6': null };
const OATS: RawKey = 'R06';
const WHEAT: RawKey = 'R05';
const FRUITS_NUTS: RawKey[] = ['R01', 'R02', 'R03', 'R04'];

export type Price = { price: number; vendor: string; source: 'ProcSourcing' | 'config' };
export type PriceList = Record<RawKey | PackKey, Price>;

/** Cheapest valid source per material (Source = X preferred), falling back to config prices. */
export function priceList(ds: Dataset, cfg: GameConfig): PriceList {
  const out = {} as PriceList;
  for (const [m, p] of Object.entries(cfg.rawPrices)) {
    out[m as RawKey] = { price: p, vendor: m.startsWith('P') ? 'V02' : 'V01', source: 'config' };
  }
  const fixed = ds.sourcing.filter((s) => s.source.toUpperCase() === 'X');
  const pool = fixed.length ? fixed : ds.sourcing;
  const best = new Map<string, Price>();
  for (const s of pool) {
    if (!(s.material in out) || s.grossPrice <= 0) continue;
    const cur = best.get(s.material);
    if (!cur || s.grossPrice < cur.price) best.set(s.material, { price: s.grossPrice, vendor: s.vendor, source: 'ProcSourcing' });
  }
  for (const [m, p] of best) out[m as RawKey] = p;
  return out;
}

export function packagingFor(sku: string): [PackKey, PackKey] {
  return skuSize(sku) === '1kg' ? ['P01', 'P02'] : ['P03', 'P04'];
}

export type BomLine = { material: RawKey | PackKey; qty: number; unit: 'KG' | 'ST' };

export function bomFor(sku: string, cfg: GameConfig, recipe: Recipe = cfg.recipes[skuFlavor(sku)] ?? {}): BomLine[] {
  const kg = skuKg(sku);
  const lines: BomLine[] = Object.entries(recipe)
    .filter(([, share]) => (share ?? 0) > 0)
    .map(([m, share]) => ({ material: m as RawKey, qty: round6(kg * (share ?? 0)), unit: 'KG' as const }));
  for (const p of packagingFor(sku)) lines.push({ material: p, qty: 1, unit: 'ST' });
  return lines;
}

/**
 * BOM in the order and units of the SAP ZCS02 screen (verified on the live game, plant G2):
 * 0010 bag, 0020 box (1 ST each), 0030 oats, 0040 wheat, 0050+ flavor (KG).
 */
export function sapBom(sku: string, cfg: GameConfig, recipe?: Recipe): BomLine[] {
  const [box, bag] = packagingFor(sku);
  const lines = bomFor(sku, cfg, recipe);
  const order = (m: string) => (m === bag ? 0 : m === box ? 1 : m === OATS ? 2 : m === WHEAT ? 3 : 4 + Number(m.slice(1)) / 100);
  return [...lines].sort((a, b) => order(a.material) - order(b.material));
}

export type UnitCostSplit = { raw: number; packaging: number; total: number };

export function unitCostSplit(sku: string, cfg: GameConfig, prices: PriceList, recipe?: Recipe): UnitCostSplit {
  let raw = 0;
  let packaging = 0;
  for (const l of bomFor(sku, cfg, recipe)) {
    const c = l.qty * prices[l.material].price;
    if (l.unit === 'ST') packaging += c;
    else raw += c;
  }
  return { raw, packaging, total: raw + packaging };
}

export function recipeCostPerKg(recipe: Recipe, prices: PriceList): number {
  return Object.entries(recipe).reduce((a, [m, share]) => a + (share ?? 0) * prices[m as RawKey].price, 0);
}

export function unitCostFromBom(sku: string, cfg: GameConfig, prices: PriceList, recipe?: Recipe): number {
  return bomFor(sku, cfg, recipe).reduce((a, l) => a + l.qty * prices[l.material].price, 0);
}

export function validateRecipe(flavor: string, recipe: Recipe, cfg: GameConfig): string[] {
  const errs: string[] = [];
  const sum = Object.values(recipe).reduce((a, x) => a + (x ?? 0), 0);
  if (Math.abs(sum - 1) > 1e-6) errs.push(`Součet podílů ${(sum * 100).toFixed(1)} % ≠ 100 %`);
  const min = cfg.recipeMin;
  if ((recipe[OATS] ?? 0) < min.oats - 1e-9) errs.push(`Oats < ${min.oats * 100} %`);
  if ((recipe[WHEAT] ?? 0) < min.wheat - 1e-9) errs.push(`Wheat < ${min.wheat * 100} %`);
  const fr = FLAVOR_RAW[flavor];
  if (fr && (recipe[fr] ?? 0) < min.flavor - 1e-9) errs.push(`Příchuť < ${min.flavor * 100} %`);
  if (flavor === '6') {
    const fn = FRUITS_NUTS.reduce((a, m) => a + (recipe[m] ?? 0), 0);
    if (fn < min.mixedFruitNuts - 1e-9) errs.push(`Fruits & nuts < ${min.mixedFruitNuts * 100} %`);
    if (FRUITS_NUTS.some((m) => (recipe[m] ?? 0) <= 0)) errs.push('Mixed musí obsahovat každou surovinu');
  }
  return errs;
}

/** Cheapest valid recipe: satisfy minima, then put the remainder into the cheapest allowed ingredient. */
export function cheapestRecipe(flavor: string, cfg: GameConfig, prices: PriceList): Recipe {
  const min = cfg.recipeMin;
  const r: Recipe = { [OATS]: min.oats, [WHEAT]: min.wheat };
  const allowed: RawKey[] = [OATS, WHEAT];
  const fr = FLAVOR_RAW[flavor];
  if (fr) {
    r[fr] = min.flavor;
    allowed.push(fr);
  } else if (flavor === '6') {
    const cheapestFruit = [...FRUITS_NUTS].sort((a, b) => prices[a].price - prices[b].price)[0];
    for (const m of FRUITS_NUTS) r[m] = min.mixedEachMin;
    r[cheapestFruit] = round6(min.mixedFruitNuts - min.mixedEachMin * (FRUITS_NUTS.length - 1));
    allowed.push(...FRUITS_NUTS);
  }
  const used = Object.values(r).reduce((a, x) => a + (x ?? 0), 0);
  const cheapest = allowed.sort((a, b) => prices[a].price - prices[b].price)[0];
  r[cheapest] = round6((r[cheapest] ?? 0) + (1 - used));
  return r;
}

export function formatRecipe(recipe: Recipe): string {
  return Object.entries(recipe)
    .filter(([, s]) => (s ?? 0) > 0)
    .map(([m, s]) => `${RAW_NAMES[m as RawKey]} ${Math.round((s ?? 0) * 1000) / 10} %`)
    .join(', ');
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
