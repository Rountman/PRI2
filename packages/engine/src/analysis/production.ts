import type { GameConfig } from '@copilot/config';
import type { Clock } from '../phase.ts';
import type { Dataset } from '../types.ts';

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

