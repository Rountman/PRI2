// Shared inputs for every v2 decision function: built once per snapshot, pure.
import { fixedPerDay, setupHours, type GameConfig } from '@copilot/config';
import type { Analysis } from '../analysis/index.ts';
import { dailySales, finishedStock, round2 } from '../analysis/sales.ts';
import { recentDemand, type StockPath } from '../analysis/stock.ts';
import { latestFinance, profitToValuation } from '../finance/index.ts';
import { isFinishedGood, SKUS, skuSize } from '../normalize.ts';
import type { Dataset, FinanceSnapshot } from '../types.ts';

const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);

/** DCs where the SKU's pack size may be sold (DC10 only 1 kg, DC14 only 500 g). */
export const allowedDcs = (cfg: GameConfig, sku: string) => cfg.channels.filter((c) => c.sizes.includes(skuSize(sku))).map((c) => c.dc);

/** Keep the order of materials as in the SAP forms (F01…F06, F11…F16). */
export const sapOrder = (skus: Iterable<string>) => {
  const set = new Set(skus);
  return SKUS.filter((s) => set.has(s));
};

/** SAP material number with team prefix: 'GG' + 'F01' → 'GG-F01'. */
export const sapMaterial = (team: string, sku: string) => (team ? `${team}-${sku}` : sku);

/** Team code from settings, else the most common prefix in our own reports. */
export function teamOf(cfg: GameConfig, ds: Dataset): string {
  if (cfg.teamCode) return cfg.teamCode;
  const n = new Map<string, number>();
  for (const r of [...ds.sales, ...ds.inventory, ...ds.production]) if (r.teamCode) n.set(r.teamCode, (n.get(r.teamCode) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}

export function startPrice(cfg: GameConfig, sku: string, dc: string): number {
  const o = cfg.startPrices.overrides?.[`${sku}:${dc}`];
  if (o) return o;
  return round2(cfg.startPrices[skuSize(sku)] + (cfg.startPrices.dcAdjust[dc] ?? 0));
}

// ---------- 5.1 demand ----------
export type Demand = {
  sku: string;
  perDay: number;
  base: number; // before stock-out boost
  source: 'prodeje' | 'preset';
  inStockDays: number;
  stockoutDays: number;
  boosted: boolean;
  byDc: Record<string, number>; // units/day per DC
};

/** Demand without history: team's market per channel split over our assortment, converted by start price. */
export function presetDemand(cfg: GameConfig, sku: string): Demand {
  const pool = new Set([...cfg.assortment, sku]);
  const byDc: Record<string, number> = {};
  for (const ch of cfg.channels) {
    if (!ch.sizes.includes(skuSize(sku))) continue;
    const n = [...pool].filter((s) => ch.sizes.includes(skuSize(s))).length;
    byDc[ch.dc] = ch.marketPer5DaysPerTeam / 5 / n / startPrice(cfg, sku, ch.dc);
  }
  const perDay = sum(Object.values(byDc));
  return { sku, perDay, base: perDay, source: 'preset', inStockDays: 0, stockoutDays: 0, boosted: false, byDc };
}

/**
 * dailyDemand = average sales over the last `demandWindow` days, counting only days the SKU was in stock.
 * Sold out on ≥ `stockoutBoostDays` of those days → × `stockoutBoost`. No history → preset.
 */
export function dailyDemand(ds: Dataset, cfg: GameConfig, gameDay: number, path: StockPath, sku: string, daily = dailySales(ds)): Demand {
  const m = daily.get(sku);
  if (!m || ![...m.values()].some((v) => v.qty > 0)) return presetDemand(cfg, sku);
  const W = cfg.md61.demandWindow;
  let sold = 0;
  let inStock = 0;
  let out = 0;
  for (let g = Math.max(1, gameDay - W + 1); g <= gameDay; g++) {
    const q = m.get(g)?.qty ?? 0;
    if ((path.bySku[sku]?.[g] ?? 0) > 0 || q > 0) {
      inStock++;
      sold += q;
    } else out++;
  }
  let base = inStock ? sold / inStock : 0;
  if (!inStock) {
    const r = recentDemand(path, ds, sku, gameDay, W, 20);
    base = r.rate;
    inStock = r.inStockDays;
  }
  const boosted = out >= cfg.md61.stockoutBoostDays && base > 0;
  const perDay = base * (boosted ? cfg.md61.stockoutBoost : 1);
  // split by DC from recent SalesReport rows (summary has no DC)
  const rows = ds.sales.filter((s) => s.material === sku && s.gameDay > gameDay - W);
  const tot = sum(rows.map((r) => r.quantity));
  const byDc: Record<string, number> = {};
  if (tot > 0) for (const r of rows) byDc[r.dc] = (byDc[r.dc] ?? 0) + (r.quantity / tot) * perDay;
  else {
    const p = presetDemand(cfg, sku);
    for (const [dc, v] of Object.entries(p.byDc)) byDc[dc] = (v / (p.perDay || 1)) * perDay;
  }
  return { sku, perDay, base, source: 'prodeje', inStockDays: inStock, stockoutDays: out, boosted, byDc };
}

/** Our average price of a SKU in a DC over the last `window` days with sales. */
export function ourPrice(ds: Dataset, sku: string, dc: string | null, gameDay: number, window: number): number | null {
  const rows = ds.sales.filter((s) => s.material === sku && (dc === null || s.dc === dc) && s.gameDay <= gameDay);
  if (!rows.length) return null;
  const last = Math.max(...rows.map((r) => r.gameDay));
  const recent = rows.filter((r) => r.gameDay > last - window);
  const q = sum(recent.map((r) => r.quantity));
  return q ? round2(sum(recent.map((r) => r.netValue)) / q) : null;
}

/** Market anchor = average market price of the SKU in the latest ZMARKET window (all regions). */
export function marketAnchor(ds: Dataset, sku: string): { price: number; gameDay: number } | null {
  const rows = ds.market.filter((m) => m.material === sku && m.quantity > 0);
  if (!rows.length) return null;
  const last = Math.max(...rows.map((r) => r.gameDay));
  const w = rows.filter((r) => r.gameDay === last);
  const q = sum(w.map((r) => r.quantity));
  return q ? { price: round2(sum(w.map((r) => r.value)) / q), gameDay: last } : null;
}

// ---------- model ----------
export type Model = {
  ds: Dataset;
  cfg: GameConfig;
  a: Analysis;
  pregame: boolean;
  team: string;
  mat: (sku: string) => string; // SAP material number
  gameDay: number;
  skus: string[]; // SAP order
  demand: Record<string, Demand>;
  stock: Record<string, number>;
  wip: Record<string, number>;
  wipKnown: boolean;
  unitCost: Record<string, number>;
  price: Record<string, number>; // avg selling price (ours, else start price)
  margin: Record<string, number>;
  fixedPerUnit: number;
  setupHours: number;
  setupSpend: number;
  finance: FinanceSnapshot | null;
  cash: number | null;
  loan: number;
  remainingDays: number;
  remainingRounds: number;
  rawStock: { kg: number; packaging: number };
  toValuation: (profit: number) => number;
};

export function buildModel(ds: Dataset, cfg: GameConfig, a: Analysis): Model {
  const pregame = a.clock.phase === 'pred-hrou';
  const g = a.clock.gameDay;
  const daily = dailySales(ds);
  const stock = pregame ? {} : finishedStock(ds);
  const wip: Record<string, number> = {};
  if (!pregame)
    for (const o of a.openOrders) {
      const left = o.finish === null || o.finish > g ? o.target : Math.max(0, o.target - o.confirmed);
      if (left > 0) wip[o.material] = (wip[o.material] ?? 0) + left;
    }
  const recentSold = new Set(ds.sales.filter((s) => s.gameDay > g - cfg.md61.demandWindow).map((s) => s.material));
  const skus = pregame
    ? sapOrder(cfg.assortment)
    : sapOrder([...cfg.assortment, ...Object.keys(stock).filter((s) => stock[s] > 0), ...recentSold, ...Object.keys(wip)].filter(isFinishedGood));
  const demand: Record<string, Demand> = {};
  const unitCost: Record<string, number> = {};
  const price: Record<string, number> = {};
  const margin: Record<string, number> = {};
  for (const sku of skus) {
    demand[sku] = pregame ? presetDemand(cfg, sku) : dailyDemand(ds, cfg, g, a.stockPath, sku, daily);
    unitCost[sku] = a.costs[sku]?.cost ?? 0;
    const dcs = allowedDcs(cfg, sku);
    price[sku] = (!pregame && ourPrice(ds, sku, null, g, cfg.md61.demandWindow)) || round2(sum(dcs.map((dc) => startPrice(cfg, sku, dc))) / (dcs.length || 1));
    margin[sku] = round2(price[sku] - unitCost[sku]);
  }
  const finance = latestFinance(ds);
  const team = teamOf(cfg, ds);
  const setupSpend = Math.max(cfg.setup.spend, finance?.setupSpend ?? 0);
  const remainingDays = a.clock.daysLeftInGame;
  let kg = 0;
  let packaging = 0;
  if (!pregame)
    for (const r of ds.inventory) {
      if (isFinishedGood(r.material)) continue;
      if (/^P/.test(r.material)) packaging += r.stock;
      else kg += r.stock;
    }
  return {
    ds,
    cfg,
    a,
    pregame,
    team,
    mat: (sku) => sapMaterial(team, sku),
    gameDay: g,
    skus,
    demand,
    stock,
    wip,
    wipKnown: a.has.production,
    unitCost,
    price,
    margin,
    fixedPerUnit: round2(fixedPerDay(cfg, finance?.loan ?? cfg.initial.loan) / cfg.capacityPerDay),
    setupHours: setupHours(cfg, setupSpend),
    setupSpend,
    finance,
    cash: finance?.cash ?? (pregame ? cfg.initial.cash : null),
    loan: finance?.loan ?? cfg.initial.loan,
    remainingDays,
    remainingRounds: remainingDays / cfg.roundLength,
    rawStock: { kg, packaging },
    toValuation: (p) => profitToValuation(p, cfg, a.discount.rate),
  };
}
