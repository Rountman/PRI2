import type { GameConfig } from '@copilot/config';
import { latestGameDay } from './dataset.ts';
import { fromGameDay } from './normalize.ts';
import type { Dataset, Phase } from './types.ts';

export const PHASE_LABEL: Record<Phase, string> = {
  pred: 'Před kolem',
  start: 'Start kola',
  beh: 'Běh kola',
  konec: 'Konec kola',
};

export type Clock = {
  gameDay: number; // last day with data (or operator override)
  round: number;
  day: number;
  phase: Phase;
  daysLeftInRound: number;
  daysLeftInGame: number;
  hasData: boolean;
};

export type ClockOverride = { gameDay?: number | null; betweenRounds?: boolean };

export function phaseOf(day: number, roundLength: number, betweenRounds = false): Phase {
  if (betweenRounds) return 'pred';
  if (day <= 3) return 'start';
  if (day >= roundLength - 4) return 'konec';
  return 'beh';
}

export function clockOf(ds: Dataset, cfg: GameConfig, ov: ClockOverride = {}): Clock {
  const latest = ov.gameDay ?? latestGameDay(ds);
  if (!latest) {
    return { gameDay: 0, round: 1, day: 0, phase: 'pred', daysLeftInRound: cfg.roundLength, daysLeftInGame: cfg.roundLength * cfg.rounds, hasData: false };
  }
  const { round, day } = fromGameDay(latest, cfg.roundLength);
  return {
    gameDay: latest,
    round,
    day,
    phase: phaseOf(day, cfg.roundLength, ov.betweenRounds),
    daysLeftInRound: ov.betweenRounds ? cfg.roundLength : cfg.roundLength - day,
    daysLeftInGame: Math.max(0, cfg.roundLength * cfg.rounds - latest),
    hasData: true,
  };
}
