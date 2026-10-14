import { setupHours, type GameConfig, type PackKey, type RawKey } from '@copilot/config';
import { bomFor, type PriceList } from '../bom.ts';
import { isFinishedGood } from '../normalize.ts';
import type { Clock } from '../phase.ts';
import type { Dataset } from '../types.ts';
import { dailySales, finishedStock, type SkuRound } from './sales.ts';
import { inStockDemand, type StockPath } from './stock.ts';

// ---------- 5. Utilization ----------
export type RoundProduction = {
  round: number;
  orders: number;
  produced: number;
  capacity: number;
  utilization: number; // 0..1
  setups: number;
  setupHours: number;
  setupLossUnits: number;
  idleDays: number[]; // days in round without any running order
  daysCounted: number;
};

export function productionByRound(ds: Dataset, cfg: GameConfig, clock: Clock): RoundProduction[] {
  const out: RoundProduction[] = [];
  const L = cfg.roundLength;
  for (let r = 1; r <= Math.max(clock.round, 1); r++) {
    const lastDay = r === clock.round ? Math.max(clock.day, 0) : L;
    const start = (r - 1) * L;
    const orders = ds.production.filter((p) => p.start !== null && p.start > start && p.start <= start + L);
    const produced = orders.reduce((a, p) => a + (p.confirmed || p.target), 0);
    const setups = orders.filter((p) => p.setupHours > 0);
    const sh = setups.reduce((a, p) => a + p.setupHours, 0);
    const idle: number[] = [];
    for (let d = 1; d <= lastDay; d++) {
      const g = start + d;
      if (!ds.production.some((p) => p.start !== null && p.finish !== null && p.start <= g && g < Math.max(p.finish, p.start + 1))) idle.push(d);
    }
    const capacity = cfg.capacityPerDay * lastDay;
    out.push({
      round: r,
      orders: orders.length,
      produced,
      capacity,
      utilization: capacity ? produced / capacity : 0,
      setups: setups.length,
      setupHours: sh,
      setupLossUnits: (sh * cfg.capacityPerDay) / 24,
      idleDays: idle,
      daysCounted: lastDay,
    });
  }
  return out;
}

export function openOrders(ds: Dataset, clock: Clock) {
  return ds.production.filter((p) => p.finish === null || p.finish > clock.gameDay || (p.confirmed < p.target && p.target > 0));
}

// ---------- 6. Production plan ----------
export type PlanRun = {
  sku: string;
  qty: number;
  orders: number[];
  setupHours: number;
  startDay: number; // offset in days from now
  endDay: number;
  marginPerUnit: number;
  demandPerDay: number;
  stock: number;
  need: number;
};

export type ProductionPlan = {
  horizonDays: number;
  runs: PlanRun[];
  changeovers: number;
  setupLossUnits: number;
  plannedUnits: number;
  capacityUnits: number;
  demandSource: string;
};

/** Demand per SKU per day = sales / in-stock days over the lookback window (stock-outs don't dilute it). */
export function demandPerDay(ds: Dataset, clock: Clock, path: StockPath, lookback = 20): Record<string, number> {
  const out: Record<string, number> = {};
  for (const sku of dailySales(ds).keys()) {
    const d = inStockDemand(path, ds, sku, clock.gameDay - lookback + 1, clock.gameDay);
    if (d.rate > 0) out[sku] = d.rate;
  }
  return out;
}

export function productionPlan(ds: Dataset, cfg: GameConfig, clock: Clock, econ: Record<string, SkuRound>, path: StockPath, horizonDays = 10): ProductionPlan {
  const demand = demandPerDay(ds, clock, path);
  const stock = finishedStock(ds);
  const open = openOrders(ds, clock);
  const openQty: Record<string, number> = {};
  for (const o of open) openQty[o.material] = (openQty[o.material] ?? 0) + Math.max(0, o.target - o.confirmed);
  const sh = setupHours(cfg);
  const perHour = cfg.capacityPerDay / 24;
  const capacityUnits = cfg.capacityPerDay * horizonDays;
  const candidates = Object.keys(demand)
    .filter((s) => isFinishedGood(s) && (econ[s]?.marginPerUnit ?? 0) > 0)
    .map((sku) => {
      const need = Math.max(0, demand[sku] * horizonDays - (stock[sku] ?? 0) - (openQty[sku] ?? 0));
      return { sku, need, margin: econ[sku].marginPerCapacity, mpu: econ[sku].marginPerUnit };
    })
    .filter((c) => c.need > 0)
    .sort((a, b) => b.margin * Math.min(b.need, capacityUnits) - a.margin * Math.min(a.need, capacityUnits));

  // continue the SKU that is currently on the line without a setup
  const lastOnLine = [...ds.production].sort((a, b) => (a.start ?? 0) - (b.start ?? 0)).at(-1)?.material;
  let usedUnits = 0;
  let t = 0;
  const runs: PlanRun[] = [];
  for (const c of candidates) {
    const setupH = runs.length === 0 && c.sku === lastOnLine ? 0 : sh;
    const setupUnits = setupH * perHour;
    const free = capacityUnits - usedUnits - setupUnits;
    if (free < cfg.lotMin) break;
    let qty = Math.max(2 * cfg.lotMin, Math.ceil(c.need / cfg.lotMin) * cfg.lotMin);
    qty = Math.min(qty, Math.floor(free / cfg.lotMin) * cfg.lotMin);
    if (qty < cfg.lotMin) continue;
    const orders: number[] = [];
    let left = qty;
    while (left > 0) {
      const o = Math.min(cfg.lotMax, left);
      orders.push(o);
      left -= o;
    }
    const days = (qty + setupUnits) / cfg.capacityPerDay;
    runs.push({ sku: c.sku, qty, orders, setupHours: setupH, startDay: t, endDay: t + days, marginPerUnit: c.mpu, demandPerDay: demand[c.sku], stock: stock[c.sku] ?? 0, need: c.need });
    t += days;
    usedUnits += qty + setupUnits;
  }
  const setupLossUnits = runs.reduce((a, r) => a + r.setupHours * perHour, 0);
  return {
    horizonDays,
    runs,
    changeovers: runs.filter((r) => r.setupHours > 0).length,
    setupLossUnits,
    plannedUnits: runs.reduce((a, r) => a + r.qty, 0),
    capacityUnits,
    demandSource: 'prodeje / dny se skladem (posledních 20 dní)',
  };
}

// ---------- Material requirements (R4/R4b/R11) ----------
export type MaterialNeed = {
  material: RawKey | PackKey;
  unit: 'KG' | 'ST';
  need: number;
  stock: number;
  openPO: number;
  shortfall: number; // need − stock − openPO
  shortfallNoPO: number; // need − stock
  orderQty: number; // rounded
  vendor: string;
  price: number;
};

/** Units produced per SKU within the first `days` days of the plan (linear within a run). */
export function plannedUnitsWithin(plan: ProductionPlan, days: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of plan.runs) {
    if (r.startDay >= days) continue;
    const frac = Math.min(1, (days - r.startDay) / Math.max(r.endDay - r.startDay, 1e-9));
    out[r.sku] = (out[r.sku] ?? 0) + r.qty * frac;
  }
  return out;
}

export function materialNeeds(ds: Dataset, cfg: GameConfig, units: Record<string, number>, prices: PriceList): MaterialNeed[] {
  const need = new Map<string, { qty: number; unit: 'KG' | 'ST' }>();
  for (const [sku, u] of Object.entries(units)) {
    for (const l of bomFor(sku, cfg)) {
      const cur = need.get(l.material) ?? { qty: 0, unit: l.unit };
      cur.qty += l.qty * u;
      need.set(l.material, cur);
    }
  }
  const stock: Record<string, number> = {};
  for (const r of ds.inventory) if (!isFinishedGood(r.material)) stock[r.material] = (stock[r.material] ?? 0) + r.stock - r.reserved;
  const openPO: Record<string, number> = {};
  for (const p of ds.purchases) {
    if (cfg.ignoreVendors.includes(p.vendor) || /deliver/i.test(p.status)) continue;
    openPO[p.material] = (openPO[p.material] ?? 0) + p.quantity;
  }
  const out: MaterialNeed[] = [];
  for (const [m, n] of need) {
    const st = stock[m] ?? 0;
    const po = openPO[m] ?? 0;
    const shortfall = n.qty - st - po;
    const step = n.unit === 'ST' ? cfg.lotMin : cfg.rawOrderRoundingKg;
    out.push({
      material: m as RawKey,
      unit: n.unit,
      need: n.qty,
      stock: st,
      openPO: po,
      shortfall,
      shortfallNoPO: n.qty - st,
      orderQty: shortfall > 0 ? Math.ceil(shortfall / step) * step : 0,
      vendor: prices[m as RawKey].vendor,
      price: prices[m as RawKey].price,
    });
  }
  return out.sort((a, b) => a.material.localeCompare(b.material));
}

/** Fallback consumption when no plan: full capacity with the product mix of the latest round. */
export function mixAtCapacity(econ: Record<string, SkuRound>, cfg: GameConfig, days: number): Record<string, number> {
  const tot = Object.values(econ).reduce((a, e) => a + e.qty, 0);
  const out: Record<string, number> = {};
  if (!tot) return out;
  for (const e of Object.values(econ)) out[e.sku] = (e.qty / tot) * cfg.capacityPerDay * days;
  return out;
}
