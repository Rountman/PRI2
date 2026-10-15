import type { GameConfig } from '@copilot/config';
import { latestGameDay } from './dataset.ts';
import { fromGameDay } from './normalize.ts';
import type { Dataset, Phase } from './types.ts';

export type Clock = {
  gameDay: number; // last day with data (or operator override); 0 = before the game
  round: number;
  day: number;
  phase: Phase;
  label: string; // "Před hrou" / "Kolo 2 · den 9/20" / "Mezi koly (po kole 1)"
  daysLeftInRound: number;
  daysLeftInGame: number;
  hasData: boolean;
};

/** Manual override from Nastavení. `phase` forces the phase regardless of data. */
export type ClockOverride = { gameDay?: number | null; betweenRounds?: boolean; phase?: Phase | null };

export function clockOf(ds: Dataset, cfg: GameConfig, ov: ClockOverride = {}): Clock {
  const latest = ov.gameDay ?? latestGameDay(ds);
  const total = cfg.roundLength * cfg.rounds;
  if (ov.phase === 'pred-hrou' || (!latest && !ov.betweenRounds && ov.phase !== 'kolo' && ov.phase !== 'mezi-koly')) {
    return { gameDay: 0, round: 1, day: 0, phase: 'pred-hrou', label: 'Před hrou', daysLeftInRound: cfg.roundLength, daysLeftInGame: total, hasData: !!latest };
  }
  const g = latest ?? 0;
  const { round, day } = g ? fromGameDay(g, cfg.roundLength) : { round: 1, day: 0 };
  const between = ov.phase === 'mezi-koly' || (ov.phase !== 'kolo' && !!ov.betweenRounds);
  return {
    gameDay: g,
    round,
    day,
    phase: between ? 'mezi-koly' : 'kolo',
    label: between ? `Mezi koly (po kole ${round})` : `Kolo ${round} · den ${day}/${cfg.roundLength}`,
    daysLeftInRound: between ? cfg.roundLength : cfg.roundLength - day,
    daysLeftInGame: Math.max(0, total - g),
    hasData: !!latest,
  };
}
