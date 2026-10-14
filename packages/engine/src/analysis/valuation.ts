import type { GameConfig } from '@copilot/config';
import type { Dataset } from '../types.ts';

export type ValuationPoint = { gameDay: number; round: number; day: number; valuation: number; delta: number | null };
export type ValuationTrend = {
  points: ValuationPoint[]; // already trimmed of round-1 artefacts
  latest: ValuationPoint | null;
  dayDelta: number | null;
  roundEnds: { round: number; valuation: number; delta: number | null }[];
};

export function valuationTrend(ds: Dataset, cfg: GameConfig): ValuationTrend {
  const sorted = [...ds.valuation].sort((a, b) => a.gameDay - b.gameDay);
  const all: ValuationPoint[] = sorted.map((v, i) => ({ ...v, delta: i ? v.valuation - sorted[i - 1].valuation : null }));
  const points = all.filter((p) => !(p.round === 1 && p.day <= cfg.valuationChartSkipDays));
  const byRound = new Map<number, ValuationPoint>();
  for (const p of all) byRound.set(p.round, p); // last day of each round
  const ends = [...byRound.values()].map((p, i, arr) => ({ round: p.round, valuation: p.valuation, delta: i ? p.valuation - arr[i - 1].valuation : null }));
  const latest = all.at(-1) ?? null;
  return { points, latest, dayDelta: latest?.delta ?? null, roundEnds: ends };
}
