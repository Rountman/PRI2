// Shared inputs for every v2 decision function: built once per snapshot, pure.
import { fixedPerDay, setupHours, type GameConfig } from '@copilot/config';
import type { Analysis } from '../analysis/index.ts';
import { dailySales, finishedStock, round2 } from '../analysis/sales.ts';
import { recentDemand, type StockPath } from '../analysis/stock.ts';
import { latestFinance, profitToValuation } from '../finance/index.ts';
import { isFinishedGood, SKUS, skuSize } from '../normalize.ts';
import type { Dataset, FinanceSnapshot } from '../types.ts';
import { assortmentReview, effectiveAssortment, type AssortmentReview } from './assortment.ts';

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
  source: 'prodeje' | 'preset' | 'trh';
  inStockDays: number;
  stockoutDays: number;
  boosted: boolean;
  capFactor: number; // < 1 when scaled down to the team's total daily sales (SKUs compete for the same customers)
  byDc: Record<string, number>; // units/day per DC
};

/** Demand without history: team's market per channel split over our assortment, converted by start price. */
export function presetDemand(cfg: GameConfig, sku: string, assortment: string[] = cfg.assortment): Demand {
  const pool = new Set([...assortment, sku]);
  const byDc: Record<string, number> = {};
  for (const ch of cfg.channels) {
    if (!ch.sizes.includes(skuSize(sku))) continue;
    const n = [...pool].filter((s) => ch.sizes.includes(skuSize(s))).length;
    byDc[ch.dc] = ch.marketPer5DaysPerTeam / 5 / n / startPrice(cfg, sku, ch.dc);
  }
  const perDay = sum(Object.values(byDc));
  return { sku, perDay, base: perDay, source: 'preset', inStockDays: 0, stockoutDays: 0, boosted: false, capFactor: 1, byDc };
}

/**
 * dailyDemand = average sales over the last `demandWindow` days, counting only days the SKU was in stock.
 * Sold out on ≥ `stockoutBoostDays` of those days → × `stockoutBoost`. No history → preset.
 */
export function dailyDemand(ds: Dataset, cfg: GameConfig, gameDay: number, path: StockPath, sku: string, daily = dailySales(ds), assortment: string[] = cfg.assortment): Demand {
  const m = daily.get(sku);
  if (!m || ![...m.values()].some((v) => v.qty > 0)) return presetDemand(cfg, sku, assortment);
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
    const p = presetDemand(cfg, sku, assortment);
    for (const [dc, v] of Object.entries(p.byDc)) byDc[dc] = (v / (p.perDay || 1)) * perDay;
  }
  return { sku, perDay, base, source: 'prodeje', inStockDays: inStock, stockoutDays: out, boosted, capFactor: 1, byDc };
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

/**
 * Team cap: our total sales per day (all SKUs) on days we sold anything, × stock-out boost when any SKU ran out.
 * Per-SKU in-stock averages overstate demand when only one SKU is on the shelf at a time (it takes the customers
 * of the sold-out ones), so Σ per-SKU demand of the assortment is scaled down to this cap.
 */
export type TeamDemand = { perDay: number; cap: number; days: number; sumSkus: number; factor: number };

export function teamDemand(cfg: GameConfig, gameDay: number, daily: ReturnType<typeof dailySales>, demand: Record<string, Demand>, assortment: string[]): TeamDemand | null {
  const W = cfg.md61.demandWindow;
  const totals: number[] = [];
  for (let g = Math.max(1, gameDay - W + 1); g <= gameDay; g++) {
    let t = 0;
    for (const m of daily.values()) t += m.get(g)?.qty ?? 0;
    if (t > 0) totals.push(t);
  }
  if (!totals.length) return null;
  const perDay = sum(totals) / totals.length;
  const inAssort = assortment.filter((s) => demand[s]);
  const boosted = inAssort.some((s) => demand[s].boosted);
  const cap = perDay * (boosted ? cfg.md61.stockoutBoost : 1);
  const sumSkus = sum(inAssort.map((s) => demand[s].perDay));
  return { perDay, cap, days: totals.length, sumSkus, factor: sumSkus > cap ? cap / sumSkus : 1 };
}

/** Units/day of a SKU at our average market share (latest ZMARKET window, SKUs we sold there). Null without data. */
export function marketDemand(ds: Dataset, cfg: GameConfig): ((sku: string) => number) | null {
  if (!ds.market.length) return null;
  const last = Math.max(...ds.market.map((r) => r.gameDay));
  const win = ds.market.filter((r) => r.gameDay === last);
  const mkt = (sku: string) => sum(win.filter((r) => r.material === sku).map((r) => r.quantity));
  const ours = (sku: string) => sum(ds.sales.filter((s) => s.material === sku && s.gameDay > last - 5 && s.gameDay <= last).map((s) => s.quantity));
  const sold = [...new Set(win.map((r) => r.material))].filter((s) => ours(s) > 0);
  if (!sold.length) return null;
  const share = sum(sold.map(ours)) / Math.max(1, sum(sold.map(mkt)));
  const days = cfg.md61.demandWindow || 5;
  return (sku) => (mkt(sku) / days) * share;
}

// ---------- model ----------
export type Model = {
  ds: Dataset;
  cfg: GameConfig;
  a: Analysis;
  pregame: boolean;
  assortment: string[]; // what we produce now (round 1: settings; later: review)
  review: AssortmentReview | null;
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
  rawStock: { kg: number; packaging: number; byMaterial: Record<string, number> };
  teamDemand: TeamDemand | null;
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
  const review = assortmentReview(ds, cfg, a);
  const assortment = effectiveAssortment(cfg, review);
  const recentSold = new Set(ds.sales.filter((s) => s.gameDay > g - cfg.md61.demandWindow).map((s) => s.material));
  const skus = pregame
    ? sapOrder(assortment)
    : sapOrder([...assortment, ...Object.keys(stock).filter((s) => stock[s] > 0), ...recentSold, ...Object.keys(wip)].filter(isFinishedGood));
  const demand: Record<string, Demand> = {};
  const unitCost: Record<string, number> = {};
  const price: Record<string, number> = {};
  const margin: Record<string, number> = {};
  for (const sku of skus) {
    demand[sku] = pregame ? presetDemand(cfg, sku, assortment) : dailyDemand(ds, cfg, g, a.stockPath, sku, daily, assortment);
    unitCost[sku] = a.costs[sku]?.cost ?? 0;
    const dcs = allowedDcs(cfg, sku);
    price[sku] = (!pregame && ourPrice(ds, sku, null, g, cfg.md61.demandWindow)) || round2(sum(dcs.map((dc) => startPrice(cfg, sku, dc))) / (dcs.length || 1));
    margin[sku] = round2(price[sku] - unitCost[sku]);
  }
  // in the assortment but no sales in the window (sold out / newly added) → our usual share of its market (ZMARKET)
  if (!pregame) {
    const est = marketDemand(ds, cfg);
    for (const sku of assortment) {
      const d = demand[sku];
      if (!d || (d.perDay > 0 && d.source !== 'preset')) continue;
      const perDay = est?.(sku) ?? presetDemand(cfg, sku, assortment).perDay;
      const p = presetDemand(cfg, sku, assortment);
      demand[sku] = { ...d, perDay, base: perDay, source: est ? 'trh' : 'preset', byDc: Object.fromEntries(Object.entries(p.byDc).map(([k, v]) => [k, (v / (p.perDay || 1)) * perDay])) };
    }
  }
  const team_ = pregame ? null : teamDemand(cfg, g, daily, demand, assortment);
  if (team_ && team_.factor < 1)
    for (const sku of skus) {
      const d = demand[sku];
      if (d.source !== 'prodeje') continue;
      const f = team_.factor;
      demand[sku] = { ...d, perDay: d.perDay * f, capFactor: f, byDc: Object.fromEntries(Object.entries(d.byDc).map(([k, v]) => [k, v * f])) };
    }
  const finance = latestFinance(ds);
  const team = teamOf(cfg, ds);
  const setupSpend = Math.max(cfg.setup.spend, finance?.setupSpend ?? 0);
  const remainingDays = a.clock.daysLeftInGame;
  let kg = 0;
  let packaging = 0;
  const byMaterial: Record<string, number> = {};
  if (!pregame)
    for (const r of ds.inventory) {
      if (isFinishedGood(r.material)) continue;
      byMaterial[r.material] = (byMaterial[r.material] ?? 0) + r.stock;
      if (/^P/.test(r.material)) packaging += r.stock;
      else kg += r.stock;
    }
  return {
    ds,
    cfg,
    a,
    pregame,
    assortment,
    review,
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
    rawStock: { kg, packaging, byMaterial },
    teamDemand: team_,
    toValuation: (p) => profitToValuation(p, cfg, a.discount.rate),
  };
}
