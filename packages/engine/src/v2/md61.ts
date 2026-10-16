// 5.2 MD61 forecast recommendation (main output of the app).
import { bomFor, unitCostFromBom } from '../bom.ts';
import { skuKg, skuLabel, skuSize } from '../normalize.ts';
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
  dropped: boolean; // not in the current assortment → forecast 0, sell off the stock
};

export type Md61Plan = {
  pregame: boolean;
  horizon: number;
  mode: 'celková' | 'doplnění';
  rows: Md61Row[];
  capacity: { perDay: number; available: number; units: number; setups: number; setupHours: number; setupUnits: number; used: number; days: number; ok: boolean; cut: string[] };
  // rawKg / packaging = gross need of the planned orders; *Peak = storage after ME59N deliveries ≈ Σ max(on hand, need) per material
  materials: { rawKg: number; packaging: number; rawPeak: number; packagingPeak: number; cost: number; rawLimit: number; packagingLimit: number; cash: number | null; ok: boolean; cut: string[] };
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
    const dropped = !m.assortment.includes(sku);
    let forecast: number;
    if (dropped) forecast = 0;
    else if (m.pregame) forecast = cfg.md61.firstCycleQty[skuSize(sku)];
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
      dropped,
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
  const setPlanned = (r: Md61Row, target: number) => {
    if (target < cfg.lotMin) target = 0;
    r.forecast = cfg.md61.mode === 'doplnění' ? target : Math.max(0, roundDown(target + r.stock + r.wip, 1000));
    r.lots = lotsFor(m, r.forecast, r.stock, r.wip);
    r.planned = r.lots.reduce((a, x) => a + x, 0);
    r.cut = true;
  };
  const cutSkus: string[] = [];
  if (!m.pregame) {
    for (const r of [...rows].sort((x, y) => x.margin - y.margin)) {
      const u = usage();
      const over = u.units + u.setupUnits - available;
      if (over <= 0) break;
      if (r.planned <= 0) continue;
      setPlanned(r, roundDown(r.planned - over, 1000));
      cutSkus.push(r.sku);
    }
  }
  const u = usage();
  const used = u.units + u.setupUnits;

  // storage check: MRP buys only what is missing, so after delivery each material holds max(on hand, need)
  const store = () => {
    const need: Record<string, number> = {};
    for (const r of rows) for (const l of bomFor(r.sku, cfg)) need[l.material] = (need[l.material] ?? 0) + r.planned * l.qty;
    let rawKg = 0, packaging = 0, rawPeak = 0, packagingPeak = 0;
    for (const mat of new Set([...Object.keys(need), ...Object.keys(m.rawStock.byMaterial)])) {
      const n = need[mat] ?? 0;
      const peak = Math.max(n, m.rawStock.byMaterial[mat] ?? 0);
      if (/^P/.test(mat)) (packaging += n), (packagingPeak += peak);
      else (rawKg += n), (rawPeak += peak);
    }
    return { rawKg, packaging, rawPeak, packagingPeak };
  };
  const storeCut: string[] = [];
  for (const r of [...rows].sort((x, y) => x.margin - y.margin)) {
    const st = store();
    const overKg = st.rawPeak - cfg.storage.raw;
    const overPk = st.packagingPeak - cfg.storage.packaging;
    if (overKg <= 0 && overPk <= 0) break;
    if (r.planned <= 0) continue;
    const units = Math.max(overKg > 0 ? overKg / skuKg(r.sku) : 0, overPk > 0 ? overPk / 2 : 0);
    setPlanned(r, roundDown(r.planned - Math.ceil(units), 1000));
    storeCut.push(r.sku);
  }
  const st = store();

  let cost = 0;
  for (const r of rows) cost += r.planned * unitCostFromBom(r.sku, cfg, m.a.prices);
  const rawLimit = cfg.storage.raw;
  const packagingLimit = cfg.storage.packaging;
  return {
    pregame: m.pregame,
    horizon,
    mode: cfg.md61.mode,
    rows,
    capacity: { perDay, available, units: u.units, setups: u.setups, setupHours: m.setupHours, setupUnits: u.setupUnits, used, days: used / perDay, ok: m.pregame || used <= available + 1e-6, cut: cutSkus },
    materials: { ...st, cost, rawLimit, packagingLimit, cash: m.cash, ok: st.rawPeak <= rawLimit && st.packagingPeak <= packagingLimit && (m.cash === null || cost <= m.cash), cut: storeCut },
    wipKnown: m.wipKnown,
  };
}
