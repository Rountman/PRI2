// "What is happening" tables for the main screen: channels (DC) and production / storage.
import { isFinishedGood } from '../normalize.ts';
import type { Md61Plan } from './md61.ts';
import type { Model } from './model.ts';

export type DcRow = { dc: string; name: string; sizes: string[]; qty: number; revenue: number; avgPrice: number | null; skus: number; status: 'prodává' | 'bez prodejů' };

export type PlantStatus = {
  queueUnits: number | null; // production orders not finished yet (null = no ProductionReport)
  queueDays: number | null;
  utilization: number | null; // last round with production
  utilizationRound: number | null;
  setupHours: number;
  fg: { qty: number; limit: number };
  raw: { qty: number; limit: number };
  packaging: { qty: number; limit: number };
};

const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);

/** Sales per DC over the last `demandWindow` days. Empty before the game / without SalesReport. */
export function dcStatus(m: Model): DcRow[] {
  if (m.pregame || !m.a.has.sales) return [];
  const W = m.cfg.md61.demandWindow;
  return m.cfg.channels.map((ch) => {
    const rows = m.ds.sales.filter((s) => s.dc === ch.dc && s.gameDay > m.gameDay - W && s.gameDay <= m.gameDay);
    const qty = sum(rows.map((r) => r.quantity));
    const revenue = sum(rows.map((r) => r.netValue));
    return { dc: ch.dc, name: ch.name, sizes: ch.sizes, qty, revenue, avgPrice: qty ? revenue / qty : null, skus: new Set(rows.map((r) => r.material)).size, status: qty > 0 ? 'prodává' : 'bez prodejů' };
  });
}

export function plantStatus(m: Model, md: Md61Plan): PlantStatus {
  const { cfg } = m;
  const queue = m.wipKnown ? sum(Object.values(m.wip)) : null;
  const played = m.a.production.filter((p) => p.orders > 0);
  const last = played.at(-1) ?? null;
  const fg = sum(Object.entries(m.stock).filter(([s]) => isFinishedGood(s)).map(([, v]) => Math.max(0, v)));
  return {
    queueUnits: queue,
    queueDays: queue === null ? null : queue / cfg.capacityPerDay,
    utilization: last?.utilization ?? null,
    utilizationRound: last?.round ?? null,
    setupHours: md.capacity.setupHours,
    fg: { qty: fg, limit: cfg.storage.finishedGoods },
    raw: { qty: m.rawStock.kg, limit: cfg.storage.raw },
    packaging: { qty: m.rawStock.packaging, limit: cfg.storage.packaging },
  };
}
