// Game parameters. Defaults only â€” every value can be overridden in UI (NastavenÃ­ hry), stored in SQLite.
// Anything marked [OVÄšÅ˜IT] is listed in docs/assumptions.md.

export type PresetName = 'intro' | 'extended';
export type Area = 'N' | 'S' | 'W';
export type RawKey = 'R01' | 'R02' | 'R03' | 'R04' | 'R05' | 'R06';
export type PackKey = 'P01' | 'P02' | 'P03' | 'P04';
export type Recipe = Partial<Record<RawKey, number>>; // share of product mass, sums to 1

export type RatingRow = { threshold: number; rating: string; premium: number }; // premium in % points

export type ChannelConfig = {
  dc: string;
  name: string;
  sizes: ('500g' | '1kg')[];
  marketPer5DaysPerTeam: number; // â‚¬ â€“ briefing estimate
  marketingSensitivity: 'nÃ­zkÃ¡' | 'stÅ™ednÃ­' | 'vysokÃ¡';
};

export type GameConfig = {
  preset: PresetName;
  roundLength: number;
  rounds: number; // [OVÄšÅ˜IT] total rounds in the competition
  initial: { cash: number; loan: number; finishedGoodsPerSku: number };
  capacityPerDay: number; // units/day [OVÄšÅ˜IT] intro machines â‚¬16M may mean 16k/day
  capacityInUnits: boolean; // [OVÄšÅ˜IT] capacity counts boxes regardless of size
  capacityCostPer1000: number;
  setup: { minHours: number; varHours: number; k: number; spend: number };
  lotMin: number;
  lotMax: number;
  fixedCostPerDay: number;
  depreciationPerDayPerM: number;
  interestPerDayPerM: number;
  riskFreeRate: number; // 0.07
  ratingTable: RatingRow[];
  defaultRating: string; // used when no finance snapshot exists
  pricing: {
    step: number; // â‚¬ per price change
    lowCoverageDays: number; // R6
    highCoverageDays: number; // R7
    clearanceCoverageDays: number; // R12
    maxAboveMarketPct: number; // R6: raise only if our price â‰¤ market Ã— (1+x)
    includeFixedInFloor: boolean;
  };
  coverageWindowDays: number;
  leadTimeDaysMax: number;
  purchaseHorizonDays: number; // R4b
  rawOrderRoundingKg: number;
  idleThresholdDays: number; // R9
  maxChangeoversPerRound: number; // R1
  sortimentSize: number; // R2
  marketingEurPerRegionDay: number; // R10 suggestion
  marketingDcs: string[];
  channels: ChannelConfig[];
  areas: Area[];
  recipes: Record<string, Recipe>; // by flavor digit '1'..'6' â€“ current BOM
  recipeMin: { oats: number; wheat: number; flavor: number; mixedFruitNuts: number; mixedEachMin: number };
  recipeAffectsDemand: boolean; // [OVÄšÅ˜IT]
  rawPrices: Record<RawKey | PackKey, number>; // fallback when ProcSourcing missing
  storage: { finishedGoods: number; raw: number; packaging: number };
  valuationChartSkipDays: number;
  calibrationTolerance: number; // 5 % â†’ banner
  financeMatchTolerance: number; // 0.5 % â†’ âœ…
  dataAgeSec: { green: number; orange: number };
  ignoreVendors: string[]; // V03 = initial stock purchase in Intro
};

export const RATING_TABLE: RatingRow[] = [
  { threshold: 0, rating: 'AAA+', premium: 3.0 },
  { threshold: -1e6, rating: 'AA+', premium: 3.75 },
  { threshold: -2e6, rating: 'AA', premium: 4.0 },
  { threshold: -3e6, rating: 'AAâˆ’', premium: 4.25 },
  { threshold: -4e6, rating: 'A+', premium: 4.75 },
  { threshold: -5e6, rating: 'A', premium: 5.0 },
  { threshold: -6e6, rating: 'Aâˆ’', premium: 5.25 },
  { threshold: -7e6, rating: 'BBB+', premium: 5.75 },
  { threshold: -8e6, rating: 'BBB', premium: 6.0 },
  { threshold: -9e6, rating: 'BBBâˆ’', premium: 6.25 },
  { threshold: -10e6, rating: 'BB+', premium: 6.75 },
  { threshold: -11e6, rating: 'BB', premium: 7.0 },
  { threshold: -12e6, rating: 'BBâˆ’', premium: 7.25 },
  { threshold: -13e6, rating: 'B+', premium: 7.75 },
  { threshold: -14e6, rating: 'B', premium: 8.0 },
  { threshold: -15e6, rating: 'Bâˆ’', premium: 8.25 },
  { threshold: -16e6, rating: 'CCC+', premium: 9.0 },
  { threshold: -17e6, rating: 'CCC', premium: 10.0 },
  { threshold: -18e6, rating: 'CCCâˆ’', premium: 11.0 },
  { threshold: -19e6, rating: 'CC', premium: 12.0 },
  { threshold: -20e6, rating: 'C', premium: 15.0 },
];

// Current recipes: 35 % oats (R06), 35 % wheat (R05), 30 % flavor. Verified against Unit Cost for F01â€“F04, F11â€“F14.
const STD = (flavor: RawKey): Recipe => ({ R06: 0.35, R05: 0.35, [flavor]: 0.3 });

const BASE: Omit<GameConfig, 'preset'> = {
  roundLength: 20,
  rounds: 4,
  initial: { cash: 2_000_000, loan: 8_000_000, finishedGoodsPerSku: 0 },
  capacityPerDay: 24_000,
  capacityInUnits: true,
  capacityCostPer1000: 1_000_000,
  setup: { minHours: 2, varHours: 6, k: 250_000, spend: 0 },
  lotMin: 16_000,
  lotMax: 48_000,
  fixedCostPerDay: 27_894.8,
  depreciationPerDayPerM: 10_000 / 24,
  interestPerDayPerM: 2_644.8 / 8,
  riskFreeRate: 0.07,
  ratingTable: RATING_TABLE,
  defaultRating: 'Aâˆ’',
  pricing: {
    step: 0.3,
    lowCoverageDays: 3,
    highCoverageDays: 10,
    clearanceCoverageDays: 5,
    maxAboveMarketPct: 10,
    includeFixedInFloor: false,
  },
  coverageWindowDays: 5,
  leadTimeDaysMax: 5,
  purchaseHorizonDays: 5,
  rawOrderRoundingKg: 100,
  idleThresholdDays: 0.5,
  maxChangeoversPerRound: 6,
  sortimentSize: 5,
  marketingEurPerRegionDay: 1_000,
  marketingDcs: ['14'],
  channels: [
    { dc: '10', name: 'Hypermarkety', sizes: ['1kg'], marketPer5DaysPerTeam: 90_000, marketingSensitivity: 'nÃ­zkÃ¡' },
    { dc: '12', name: 'Grocery chains', sizes: ['500g', '1kg'], marketPer5DaysPerTeam: 360_000, marketingSensitivity: 'stÅ™ednÃ­' },
    { dc: '14', name: 'Independent grocers', sizes: ['500g'], marketPer5DaysPerTeam: 135_000, marketingSensitivity: 'vysokÃ¡' },
  ],
  areas: ['N', 'S', 'W'],
  recipes: {
    '1': STD('R01'),
    '2': STD('R02'),
    '3': STD('R03'),
    '4': STD('R04'),
    '5': { R06: 0.5, R05: 0.5 }, // Original [OVÄšÅ˜IT] â€“ not produced in fixtures
    '6': { R06: 0.35, R05: 0.35, R01: 0.075, R02: 0.075, R03: 0.075, R04: 0.075 }, // Mixed [OVÄšÅ˜IT]
  },
  recipeMin: { oats: 0.3, wheat: 0.2, flavor: 0.2, mixedFruitNuts: 0.3, mixedEachMin: 0.01 },
  recipeAffectsDemand: false,
  rawPrices: { R01: 1.82, R02: 4.0, R03: 4.02, R04: 1.07, R05: 0.99, R06: 0.92, P01: 0.28, P02: 0.12, P03: 0.21, P04: 0.09 },
  storage: { finishedGoods: 250_000, raw: 250_000, packaging: 750_000 },
  valuationChartSkipDays: 2,
  calibrationTolerance: 0.05,
  financeMatchTolerance: 0.005,
  dataAgeSec: { green: 120, orange: 600 },
  ignoreVendors: ['V03'],
};

export const PRESETS: Record<PresetName, GameConfig> = {
  // Calibrated on fixtures (Manufacturing Introduction, team GG).
  intro: {
    ...BASE,
    preset: 'intro',
    initial: { cash: 2_000_000, loan: 0, finishedGoodsPerSku: 30_000 },
    fixedCostPerDay: 14_600, // derived: gross margin âˆ’ net income [PRAVDÄšP.]
    defaultRating: 'AAA+',
  },
  // From the official Extended briefing.
  extended: { ...BASE, preset: 'extended' },
};

export const DEFAULT_PRESET: PresetName = 'intro';

/** Deep-merge a partial override (from UI/SQLite) over a preset. Arrays are replaced, not merged. */
export function resolveConfig(override: DeepPartial<GameConfig> = {}): GameConfig {
  const preset = PRESETS[(override.preset as PresetName) ?? DEFAULT_PRESET] ?? PRESETS[DEFAULT_PRESET];
  return deepMerge(structuredClone(preset), override) as GameConfig;
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends (infer U)[] ? U[] : T[K] extends object ? DeepPartial<T[K]> : T[K] };

function deepMerge(base: any, over: any): any {
  if (over === undefined || over === null) return base;
  if (Array.isArray(over) || typeof over !== 'object') return over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = base && typeof base[k] === 'object' && !Array.isArray(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

export function setupHours(cfg: GameConfig, spend = cfg.setup.spend): number {
  // SetupTime = 2 + (6 Ã— 250 000) / (250 000 + balance478000); balance 0 â†’ 8 h
  const { minHours, varHours, k } = cfg.setup;
  return minHours + (varHours * k) / (k + Math.max(0, spend));
}
