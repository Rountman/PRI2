import type { Area, GameConfig } from '@copilot/config';
import { isFinishedGood, SKUS, skuKg, windowEnd } from '../normalize.ts';
import type { Dataset } from '../types.ts';

const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);

export type UnitCost = { cost: number; source: 'SalesReport' | 'ProductionReport' | 'BOM' };

/**
 * Unit cost per SKU: SalesReport Cost / Quantity over the SKU's last 5 sales days (= ZCK11 replacement),
 * else latest planned unit cost from ProductionReport, else BOM estimate.
 */
export function unitCosts(ds: Dataset, bomCost: (sku: string) => number): Record<string, UnitCost> {
  const out: Record<string, UnitCost> = {};
  for (const sku of SKUS) out[sku] = { cost: bomCost(sku), source: 'BOM' };
  const sorted = [...ds.production].sort((a, b) => (a.released ?? a.start ?? 0) - (b.released ?? b.start ?? 0));
  for (const p of sorted) if (p.unitCost > 0) out[p.material] = { cost: p.unitCost, source: 'ProductionReport' };
  const bySku = new Map<string, typeof ds.sales>();
  for (const s of ds.sales) if (s.quantity > 0 && s.cost > 0) bySku.set(s.material, [...(bySku.get(s.material) ?? []), s]);
  for (const [sku, rows] of bySku) {
    const last = Math.max(...rows.map((r) => r.gameDay));
    const recent = rows.filter((r) => r.gameDay > last - 5);
    const q = sum(recent.map((r) => r.quantity));
    if (q > 0) out[sku] = { cost: Math.round((sum(recent.map((r) => r.cost)) / q) * 100) / 100, source: 'SalesReport' };
  }
  return out;
}

/** Daily sales per SKU: summary preferred (has explicit zeros), else aggregated SalesReport. */
export function dailySales(ds: Dataset): Map<string, Map<number, { qty: number; value: number }>> {
  const m = new Map<string, Map<number, { qty: number; value: number }>>();
  const add = (sku: string, d: number, qty: number, value: number) => {
    if (!m.has(sku)) m.set(sku, new Map());
    const cur = m.get(sku)!.get(d) ?? { qty: 0, value: 0 };
    m.get(sku)!.set(d, { qty: cur.qty + qty, value: cur.value + value });
  };
  if (ds.summary.length) for (const s of ds.summary) add(s.material, s.gameDay, s.quantity, s.netValue);
  else for (const s of ds.sales) add(s.material, s.gameDay, s.quantity, s.netValue);
  return m;
}

export function finishedStock(ds: Dataset): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of ds.inventory) if (isFinishedGood(r.material)) out[r.material] = (out[r.material] ?? 0) + r.stock - r.reserved;
  return out;
}

// ---------- SKU economics ----------
export type SkuRound = { sku: string; round: number; qty: number; revenue: number; avgPrice: number; unitCost: number; marginPerUnit: number; marginPerCapacity: number };

export function skuEconomics(ds: Dataset, cfg: GameConfig, costs: Record<string, UnitCost>): SkuRound[] {
  const agg = new Map<string, { qty: number; revenue: number }>();
  const src = ds.sales.length ? ds.sales : ds.summary;
  for (const s of src) {
    const k = `${s.material}|${s.round}`;
    const a = agg.get(k) ?? { qty: 0, revenue: 0 };
    a.qty += s.quantity;
    a.revenue += s.netValue;
    agg.set(k, a);
  }
  const out: SkuRound[] = [];
  for (const [k, a] of agg) {
    if (!a.qty) continue;
    const [sku, r] = k.split('|');
    const avgPrice = a.revenue / a.qty;
    const unitCost = costs[sku]?.cost ?? 0;
    const m = avgPrice - unitCost;
    out.push({ sku, round: Number(r), qty: a.qty, revenue: a.revenue, avgPrice, unitCost, marginPerUnit: m, marginPerCapacity: cfg.capacityInUnits ? m : m / skuKg(sku) });
  }
  return out.sort((a, b) => a.round - b.round || a.sku.localeCompare(b.sku));
}

/** Latest round's economics per SKU (falls back to older rounds). */
export function latestEconomics(econ: SkuRound[]): Record<string, SkuRound> {
  const out: Record<string, SkuRound> = {};
  for (const e of econ) if (!out[e.sku] || e.round > out[e.sku].round) out[e.sku] = e;
  return out;
}

// ---------- Channels ----------
export type ChannelStat = { dc: string; name: string; qty: number; revenue: number; sizes: string[] };

export function channelStats(ds: Dataset, cfg: GameConfig): ChannelStat[] {
  return cfg.channels.map((ch) => {
    const rows = ds.sales.filter((s) => s.dc === ch.dc);
    return { dc: ch.dc, name: ch.name, sizes: ch.sizes, qty: sum(rows.map((r) => r.quantity)), revenue: sum(rows.map((r) => r.netValue)) };
  });
}

// ---------- 3. Market share ----------
export type ShareRow = { round: number; window: number; sku: string; area: Area; ours: number; market: number; share: number; ourPrice: number | null; marketPrice: number };

export function marketShare(ds: Dataset): ShareRow[] {
  const ours = new Map<string, { qty: number; value: number }>();
  for (const s of ds.sales) {
    const k = `${s.round}|${windowEnd(s.day)}|${s.material}|${s.area}`;
    const a = ours.get(k) ?? { qty: 0, value: 0 };
    a.qty += s.quantity;
    a.value += s.netValue;
    ours.set(k, a);
  }
  return ds.market
    .map((m) => {
      const o = ours.get(`${m.round}|${m.day}|${m.material}|${m.area}`);
      return {
        round: m.round,
        window: m.day,
        sku: m.material,
        area: m.area,
        ours: o?.qty ?? 0,
        market: m.quantity,
        share: m.quantity > 0 ? (o?.qty ?? 0) / m.quantity : 0,
        ourPrice: o && o.qty ? o.value / o.qty : null,
        marketPrice: m.price,
      };
    })
    .sort((a, b) => a.round - b.round || a.window - b.window || a.sku.localeCompare(b.sku) || a.area.localeCompare(b.area));
}

export const round2 = (x: number) => Math.round(x * 100) / 100;
export const fmtRD = (g: number, len: number) => {
  const r = Math.floor((g - 1) / len) + 1;
  const d = g - (r - 1) * len;
  return `${String(r).padStart(2, '0')}/${String(d).padStart(2, '0')}`;
};
