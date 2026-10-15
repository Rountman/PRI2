// 5.2 MD61 forecast recommendation (main output of the app).
import { unitCostFromBom } from '../bom.ts';
import { skuKg, skuLabel } from '../normalize.ts';
import { cutLots, roundDown, roundUp } from './lotsize.ts';
import type { Demand, Model } from './model.ts';

export type Md61Row = {
  sku: string;
  mat: string; // SAP material, e.g. GG-F01
  label: string;
  stock: number;
  wip: number;
  demand: Demand;
  coverDays: number | null; // (stock + wip) / demand
  forecast: number; // value to type into MD61
  lots: number[]; // expected planned orders after MD01
  planned: number;
  margin: number;
  cut: boolean; // reduced by the capacity check
};

export type Md61Plan = {
  pregame: boolean;
  horizon: number;
  mode: 'celková' | 'doplnění';
  rows: Md61Row[];
  capacity: { perDay: number; available: number; units: number; setups: number; setupHours: number; setupUnits: number; used: number; days: number; ok: boolean; cut: string[] };
  materials: { rawKg: number; packaging: number; cost: number; rawLimit: number; packagingLimit: number; cash: number | null; ok: boolean };
  wipKnown: boolean;
};

/** Expected planned orders for a forecast: forecast − stock − WIP (mode celková), cut by lot size. */
function lotsFor(m: Model, forecast: number, stock: number, wip: number): number[] {
  return cutLots(m.cfg.md61.mode === 'doplnění' ? forecast : forecast - stock - wip, m.cfg);
}

export function md61Plan(m: Model): Md61Plan {
  const { cfg } = m;
  const perDay = cfg.capacityPerDay;
  const horizon = m.pregame ? cfg.md61.nextMrpDays + cfg.md61.leadTimeMax : Math.max(1, Math.min(cfg.md61.nextMrpDays + cfg.md61.leadTimeMax, m.remainingDays || Infinity));
  const rows: Md61Row[] = m.skus.map((sku) => {
    const stock = Math.max(0, m.stock[sku] ?? 0);
    const wip = m.wip[sku] ?? 0;
    const d = m.demand[sku];
    let forecast: number;
    if (m.pregame) forecast = cfg.md61.firstCycleQty;
    else if (cfg.md61.mode === 'doplnění') forecast = roundUp(Math.max(0, d.perDay * horizon - stock - wip), 1000);
    else forecast = roundUp(d.perDay * horizon, 1000);
    const lots = lotsFor(m, forecast, stock, wip);
    return {
      sku,
      mat: m.mat(sku),
      label: skuLabel(sku),
      stock,
      wip,
      demand: d,
      coverDays: d.perDay > 0 ? (stock + wip) / d.perDay : null,
      forecast,
      lots,
      planned: lots.reduce((a, x) => a + x, 0),
      margin: m.margin[sku],
      cut: false,
    };
  });

  // capacity check: Σ planned + setups × setup hours × capacity/24 ≤ capacity × H; cut lowest margin first
  const unitsPerHour = perDay / 24;
  const usage = () => {
    const units = rows.reduce((a, r) => a + r.planned, 0);
    const setups = rows.filter((r) => r.planned > 0).length;
    return { units, setups, setupUnits: setups * m.setupHours * unitsPerHour };
  };
  const available = perDay * horizon;
  const cutSkus: string[] = [];
  if (!m.pregame) {
    for (const r of [...rows].sort((x, y) => x.margin - y.margin)) {
      const u = usage();
      const over = u.units + u.setupUnits - available;
      if (over <= 0) break;
      if (r.planned <= 0) continue;
      let target = roundDown(r.planned - over, 1000);
      if (target < cfg.lotMin) target = 0;
      r.forecast = cfg.md61.mode === 'doplnění' ? target : Math.max(0, roundDown(target + r.stock + r.wip, 1000));
      r.lots = lotsFor(m, r.forecast, r.stock, r.wip);
      r.planned = r.lots.reduce((a, x) => a + x, 0);
      r.cut = true;
      cutSkus.push(r.sku);
    }
  }
  const u = usage();
  const used = u.units + u.setupUnits;

  let rawKg = 0;
  let packaging = 0;
  let cost = 0;
  for (const r of rows) {
    rawKg += r.planned * skuKg(r.sku);
    packaging += r.planned * 2;
    cost += r.planned * unitCostFromBom(r.sku, cfg, m.a.prices);
  }
  const rawLimit = cfg.storage.raw - m.rawStock.kg;
  const packagingLimit = cfg.storage.packaging - m.rawStock.packaging;
  return {
    pregame: m.pregame,
    horizon,
    mode: cfg.md61.mode,
    rows,
    capacity: { perDay, available, units: u.units, setups: u.setups, setupHours: m.setupHours, setupUnits: u.setupUnits, used, days: used / perDay, ok: m.pregame || used <= available + 1e-6, cut: cutSkus },
    materials: { rawKg, packaging, cost, rawLimit, packagingLimit, cash: m.cash, ok: rawKg <= rawLimit && packaging <= packagingLimit && (m.cash === null || cost <= m.cash) },
    wipKnown: m.wipKnown,
  };
}
