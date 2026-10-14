import type { Area, GameConfig } from '@copilot/config';
import { isFinishedGood, SKUS, skuKg, windowEnd } from '../normalize.ts';
import type { Dataset } from '../types.ts';
import type { Clock } from '../phase.ts';
import { inStockDemand, recentDemand, type StockPath } from './stock.ts';

const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);

export type UnitCost = { cost: number; source: 'ProductionReport' | 'BOM' };

/** Latest planned unit cost per SKU from ProductionReport, else BOM estimate. */
export function unitCosts(ds: Dataset, bomCost: (sku: string) => number): Record<string, UnitCost> {
  const out: Record<string, UnitCost> = {};
  const sorted = [...ds.production].sort((a, b) => (a.released ?? a.start ?? 0) - (b.released ?? b.start ?? 0));
  for (const p of sorted) if (p.unitCost > 0) out[p.material] = { cost: p.unitCost, source: 'ProductionReport' };
  for (const sku of SKUS) if (!out[sku]) out[sku] = { cost: bomCost(sku), source: 'BOM' };
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

// ---------- 1. Coverage ----------
export type Coverage = {
  sku: string;
  stock: number;
  avgDaily: number;
  days: number; // Infinity when no sales but stock
  status: 'vyprodáno' | 'nízké' | 'ok' | 'přebytek' | 'bez prodeje';
  inStockDays: number; // how many in-stock days the rate is based on
};

export function finishedStock(ds: Dataset): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of ds.inventory) if (isFinishedGood(r.material)) out[r.material] = (out[r.material] ?? 0) + r.stock - r.reserved;
  return out;
}

/**
 * Days of coverage = stock / daily sales. Daily sales are averaged over days when the SKU was in stock
 * within the last `coverageWindowDays` (falls back to 20 days), so a stock-out does not fake low demand.
 */
export function coverage(ds: Dataset, cfg: GameConfig, clock: Clock, path: StockPath): Coverage[] {
  const stock = finishedStock(ds);
  const daily = dailySales(ds);
  const skus = new Set([...Object.keys(stock), ...daily.keys()].filter(isFinishedGood));
  return [...skus].sort().map((sku) => {
    const dem = recentDemand(path, ds, sku, clock.gameDay, cfg.coverageWindowDays);
    const avgDaily = dem.rate;
    const st = stock[sku] ?? 0;
    const days = avgDaily > 0 ? st / avgDaily : st > 0 ? Infinity : 0;
    const status: Coverage['status'] =
      st <= 0 ? 'vyprodáno' : avgDaily === 0 ? 'bez prodeje' : days < cfg.pricing.lowCoverageDays ? 'nízké' : days > cfg.pricing.highCoverageDays ? 'přebytek' : 'ok';
    return { sku, stock: st, avgDaily, days, status, inStockDays: dem.inStockDays };
  });
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

// ---------- 2. Stockouts ----------
export type StockoutSku = { sku: string; round: number; days: number[]; avgDailyWhenSelling: number; lostUnits: number; lostMargin: number };
export type Stockouts = { zeroSalesDays: Record<number, number[]>; perSku: StockoutSku[]; totalLostMargin: number };

/**
 * Stock-out day = SKU from our assortment (sold that round) starts the day with zero reconstructed stock
 * while the market was buying it. Lost units ≈ in-stock demand rate × stock-out days.
 */
export function stockouts(ds: Dataset, cfg: GameConfig, clock: Clock, econ: Record<string, SkuRound>, path: StockPath): Stockouts {
  const daily = dailySales(ds);
  const marketQty = new Map<string, number>(); // round|window|sku
  for (const m of ds.market) {
    const k = `${m.round}|${m.day}|${m.material}`;
    marketQty.set(k, (marketQty.get(k) ?? 0) + m.quantity);
  }
  const hasMarket = ds.market.length > 0;
  // best market share we ever reached per SKU (5-day window, all regions) – caps the lost-sales estimate
  const ourWin = new Map<string, number>();
  for (const s of ds.sales) {
    const k = `${s.round}|${windowEnd(s.day)}|${s.material}`;
    ourWin.set(k, (ourWin.get(k) ?? 0) + s.quantity);
  }
  const maxShare: Record<string, number> = {};
  for (const [k, q] of ourWin) {
    const mq = marketQty.get(k) ?? 0;
    const sku = k.split('|')[2];
    if (mq > 0) maxShare[sku] = Math.min(1, Math.max(maxShare[sku] ?? 0, q / mq));
  }
  const zeroSalesDays: Record<number, number[]> = {};
  const perSku: StockoutSku[] = [];
  const lastRound = clock.round;
  const L = cfg.roundLength;
  for (let r = 1; r <= lastRound; r++) {
    const lastDay = r === lastRound ? clock.day : L;
    const zero: number[] = [];
    for (let d = 1; d <= lastDay; d++) {
      let tot = 0;
      for (const m of daily.values()) tot += m.get((r - 1) * L + d)?.qty ?? 0;
      if (tot === 0) zero.push(d);
    }
    zeroSalesDays[r] = zero;
    for (const [sku, m] of daily) {
      let soldInRound = 0;
      const days: number[] = [];
      for (let d = 1; d <= lastDay; d++) {
        const g = (r - 1) * L + d;
        const q = m.get(g)?.qty ?? 0;
        soldInRound += q;
        const empty = (path.bySku[sku]?.[g] ?? 0) <= 0 && q === 0;
        if (empty && (!hasMarket || (marketQty.get(`${r}|${windowEnd(d)}|${sku}`) ?? 0) > 0)) days.push(d);
      }
      if (!soldInRound || !days.length) continue; // SKU not in our assortment this round
      const rate = inStockDemand(path, ds, sku, (r - 1) * L + 1, (r - 1) * L + lastDay).rate;
      const margin = Math.max(0, econ[sku]?.marginPerUnit ?? 0);
      const lostUnits = days.reduce((a, d) => {
        const mk = marketQty.get(`${r}|${windowEnd(d)}|${sku}`);
        const cap = hasMarket && mk !== undefined && maxShare[sku] ? (mk / 5) * maxShare[sku] : rate;
        return a + Math.min(rate, cap);
      }, 0);
      perSku.push({ sku, round: r, days, avgDailyWhenSelling: rate, lostUnits, lostMargin: lostUnits * margin });
    }
  }
  return { zeroSalesDays, perSku, totalLostMargin: sum(perSku.map((p) => p.lostMargin)) };
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

// ---------- 4. Price position ----------
export type PricePosition = {
  sku: string;
  dcs: string[]; // channels where we sold it
  ourPrice: number | null; // latest window avg
  marketAvg: number | null;
  marketMin: number | null;
  marketMax: number | null;
  marketWindow: string | null; // "03/20"
  unitCost: number;
  floor: number;
  coverage: Coverage | null;
  soldOut: boolean;
  recommended: number | null;
  delta: number | null;
  action: 'zvýšit' | 'snížit' | 'držet' | 'nastavit';
  reason: string;
};

export function pricePositions(ds: Dataset, cfg: GameConfig, clock: Clock, cov: Coverage[], costs: Record<string, UnitCost>): PricePosition[] {
  const latestMarketDay = Math.max(0, ...ds.market.map((m) => m.gameDay));
  const out: PricePosition[] = [];
  const fixedPerUnit = cfg.pricing.includeFixedInFloor ? cfg.fixedCostPerDay / cfg.capacityPerDay : 0;
  for (const sku of SKUS) {
    const mk = ds.market.filter((m) => m.material === sku && m.gameDay === latestMarketDay && m.quantity > 0);
    const mq = sum(mk.map((m) => m.quantity));
    const marketAvg = mq ? sum(mk.map((m) => m.value)) / mq : null;
    // our latest price: last 5 days of sales of this sku
    const ourRows = ds.sales.filter((s) => s.material === sku);
    const lastDay = Math.max(0, ...ourRows.map((s) => s.gameDay));
    const recent = ourRows.filter((s) => s.gameDay > lastDay - 5);
    const rq = sum(recent.map((s) => s.quantity));
    const ourPrice = rq ? sum(recent.map((s) => s.netValue)) / rq : null;
    const c = cov.find((x) => x.sku === sku) ?? null;
    const unitCost = costs[sku]?.cost ?? 0;
    const floor = round2(unitCost + fixedPerUnit);
    const soldOut = !!c && c.stock <= 0 && c.avgDaily > 0;
    let recommended: number | null = null;
    let action: PricePosition['action'] = 'držet';
    let reason = '';
    const base = ourPrice ?? marketAvg;
    if (base !== null && c) {
      const cap = marketAvg !== null ? marketAvg * (1 + cfg.pricing.maxAboveMarketPct / 100) : Infinity;
      if ((soldOut || (c.days < cfg.pricing.lowCoverageDays && c.avgDaily > 0)) && ourPrice !== null && ourPrice <= cap) {
        recommended = ourPrice + cfg.pricing.step;
        action = 'zvýšit';
        reason = soldOut ? 'vyprodáno – prodáváme vše' : `pokrytí ${c.days.toFixed(1)} dne < ${cfg.pricing.lowCoverageDays}`;
      } else if (c.stock > 0 && c.days > cfg.pricing.highCoverageDays && c.inStockDays >= 3 && ourPrice !== null) {
        const target = marketAvg !== null ? Math.max(marketAvg, ourPrice - cfg.pricing.step * 2) : ourPrice - cfg.pricing.step;
        recommended = Math.min(ourPrice - cfg.pricing.step, target);
        action = 'snížit';
        reason = `pokrytí ${Number.isFinite(c.days) ? c.days.toFixed(0) : '∞'} dní > ${cfg.pricing.highCoverageDays}`;
      }
    }
    if (recommended !== null) {
      recommended = Math.max(round2(recommended), floor);
      if (action === 'snížit' && ourPrice !== null && recommended >= ourPrice) {
        action = 'držet';
        reason = 'cena už je na minimu (unit cost)';
        recommended = null;
      }
    }
    out.push({
      sku,
      dcs: [...new Set(ourRows.map((s) => s.dc))].sort(),
      ourPrice: ourPrice !== null ? round2(ourPrice) : null,
      marketAvg: marketAvg !== null ? round2(marketAvg) : null,
      marketMin: mk.length ? Math.min(...mk.map((m) => m.price)) : null,
      marketMax: mk.length ? Math.max(...mk.map((m) => m.price)) : null,
      marketWindow: latestMarketDay ? fmtRD(latestMarketDay, cfg.roundLength) : null,
      unitCost,
      floor,
      coverage: c,
      soldOut,
      recommended,
      delta: recommended !== null && ourPrice !== null ? round2(recommended - ourPrice) : null,
      action,
      reason,
    });
  }
  return out;
}

export const round2 = (x: number) => Math.round(x * 100) / 100;
export const fmtRD = (g: number, len: number) => {
  const r = Math.floor((g - 1) / len) + 1;
  const d = g - (r - 1) * len;
  return `${String(r).padStart(2, '0')}/${String(d).padStart(2, '0')}`;
};
