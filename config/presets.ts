// Preset values. `extended` = school round of BIZ SIM CUP 2026 (CLAUDE.md kap. 2, DEFAULT).
// `intro` exists only for tests over fixtures/ (practice data are from Manufacturing Introduction).
import type { DeepPartial, GameConfig, PresetName, RatingRow, RawKey, Recipe } from './game.ts';

export const RATING_TABLE: RatingRow[] = [
  { threshold: 0, rating: 'AAA+', premium: 3.0 },
  { threshold: -1e6, rating: 'AA+', premium: 3.75 },
  { threshold: -2e6, rating: 'AA', premium: 4.0 },
  { threshold: -3e6, rating: 'AA−', premium: 4.25 },
  { threshold: -4e6, rating: 'A+', premium: 4.75 },
  { threshold: -5e6, rating: 'A', premium: 5.0 },
  { threshold: -6e6, rating: 'A−', premium: 5.25 },
  { threshold: -7e6, rating: 'BBB+', premium: 5.75 },
  { threshold: -8e6, rating: 'BBB', premium: 6.0 },
  { threshold: -9e6, rating: 'BBB−', premium: 6.25 },
  { threshold: -10e6, rating: 'BB+', premium: 6.75 },
  { threshold: -11e6, rating: 'BB', premium: 7.0 },
  { threshold: -12e6, rating: 'BB−', premium: 7.25 },
  { threshold: -13e6, rating: 'B+', premium: 7.75 },
  { threshold: -14e6, rating: 'B', premium: 8.0 },
  { threshold: -15e6, rating: 'B−', premium: 8.25 },
  { threshold: -16e6, rating: 'CCC+', premium: 9.0 },
  { threshold: -17e6, rating: 'CCC', premium: 10.0 },
  { threshold: -18e6, rating: 'CCC−', premium: 11.0 },
  { threshold: -19e6, rating: 'CC', premium: 12.0 },
  { threshold: -20e6, rating: 'C', premium: 15.0 },
];

// Default BOM: 35 % oats (R06), 35 % wheat (R05), 30 % flavor. Verified against Unit Cost in practice data.
const STD = (flavor: RawKey): Recipe => ({ R06: 0.35, R05: 0.35, [flavor]: 0.3 });

const EXTENDED: GameConfig = {
  preset: 'extended',
  teamCode: 'GG',
  roundLength: 20,
  rounds: 5, // potvrzeno týmem GG: 5 simulačních kol
  initial: { cash: 2_000_000, loan: 8_000_000, machines: 24_000_000, finishedGoodsPerSku: 0 },
  capacityPerDay: 24_000,
  capacityInUnits: true,
  capacityCostPer1000: 1_000_000,
  setup: { minHours: 2, varHours: 6, k: 250_000, spend: 0 },
  setupSteps: [50_000, 125_000, 250_000, 500_000, 1_250_000],
  lotMin: 16_000,
  lotMax: 48_000,
  lotRounding: 1_000,
  fixedCosts: { periodDays: 5, labor: 20_000, overhead: 15_000, sga: 40_000, depBuilding: 1_250, depMachines: 50_000 },
  depreciationPerDayPerM: 10_000 / 24, // 50 000 / 5 days / €24M
  interestPerDayPerM: 2_644.8 / 8,
  riskFreeRate: 0.07,
  ratingTable: RATING_TABLE,
  defaultRating: 'A−', // start: 2M − 8M = −6M → A− → 12,25 %
  extraCapacityUtilization: 0.5,

  // round 1 broad (all flavors except Original/Mixed), after round 1 keep the best 5 by market revenue × our margin
  assortment: ['F01', 'F02', 'F03', 'F04', 'F11', 'F12', 'F13', 'F14'],
  assortmentTarget: 5,
  assortmentAuto: true,
  startPrices: { '500g': 5.2, '1kg': 7.5, dcAdjust: { '10': -0.3, '12': 0, '14': 0.3 }, overrides: {} }, // [ODHAD]
  setupProposal: 125_000, // [ODHAD]
  md61: {
    firstCycleQty: { '500g': 16_000, '1kg': 24_000 }, // 8 SKUs + 8 setups must fit 10 days of capacity; 1 kg sells better
    nextMrpDays: 5,
    leadTimeMax: 5,
    stockoutBoost: 1.2,
    stockoutBoostDays: 2,
    demandWindow: 5,
    mode: 'celková',
    changeoversPerRound: 10,
  },
  pricing: { step: 0.3, lowCoverDays: 3, highCoverDays: 8, anchorFloorPct: 10, warnFixedPerUnit: true },
  reserve: { fixedDays: 10, buffer: 200_000 },
  investPayback: 2,
  maxCards: 12, // rows in the 'Co se děje' table
  maxCritical: 2,

  marketingEurPerRegionDay: 1_000,
  // market size per team per week: Job aid Manufacturing Extended (HEC Montréal, 2020) – DC12 €220k, DC14 €130k
  channels: [
    { dc: '10', name: 'Hypermarkety', sizes: ['1kg'], marketPer5DaysPerTeam: 90_000, priceSensitivity: 'velmi vysoká', marketingSensitivity: 'nízká' },
    { dc: '12', name: 'Grocery chains', sizes: ['500g', '1kg'], marketPer5DaysPerTeam: 220_000, priceSensitivity: 'vysoká', marketingSensitivity: 'střední' },
    { dc: '14', name: 'Independent grocers', sizes: ['500g'], marketPer5DaysPerTeam: 130_000, priceSensitivity: 'střední', marketingSensitivity: 'vysoká' },
  ],
  areas: ['N', 'S', 'W'],
  recipes: {
    '1': STD('R01'),
    '2': STD('R02'),
    '3': STD('R03'),
    '4': STD('R04'),
    '5': { R06: 0.5, R05: 0.5 }, // Original [OVĚŘIT]
    '6': { R06: 0.35, R05: 0.35, R01: 0.075, R02: 0.075, R03: 0.075, R04: 0.075 }, // Mixed [OVĚŘIT]
  },
  recipeMin: { oats: 0.3, wheat: 0.2, flavor: 0.2, mixedFruitNuts: 0.3, mixedEachMin: 0.01 },
  rawPrices: { R01: 1.82, R02: 4.0, R03: 4.02, R04: 1.07, R05: 0.99, R06: 0.92, P01: 0.28, P02: 0.12, P03: 0.21, P04: 0.09 },
  storage: { finishedGoods: 250_000, raw: 250_000, packaging: 750_000 },
  storageExtraPerDay: { finishedGoods: 500, raw: 1_000, packaging: 100 },
  valuationChartSkipDays: 2,
  calibrationTolerance: 0.05,
  financeMatchTolerance: 0.005,
  dataAgeSec: { green: 360, orange: 900 }, // upload rhythm = every 5 game days (~5 min)
  ignoreVendors: ['V03'],
};

export const PRESETS: Record<PresetName, GameConfig> = {
  extended: EXTENDED,
  // Calibrated on fixtures (Manufacturing Introduction, team GG) – tests only.
  intro: {
    ...EXTENDED,
    preset: 'intro',
    initial: { cash: 2_000_000, loan: 0, machines: 16_000_000, finishedGoodsPerSku: 30_000 },
    // aggregated: gross margin − net income ≈ €14 600/day [PRAVDĚP.]
    fixedCosts: { periodDays: 5, labor: 0, overhead: 73_000, sga: 0, depBuilding: 0, depMachines: 0 },
    defaultRating: 'AAA+',
  },
};

export const DEFAULT_PRESET: PresetName = 'extended';

/** Deep-merge a partial override (from UI/SQLite) over a preset. Arrays are replaced, not merged. */
export function resolveConfig(override: DeepPartial<GameConfig> = {}): GameConfig {
  const preset = PRESETS[(override.preset as PresetName) ?? DEFAULT_PRESET] ?? PRESETS[DEFAULT_PRESET];
  return deepMerge(structuredClone(preset), override) as GameConfig;
}

function deepMerge(base: any, over: any): any {
  if (over === undefined || over === null) return base;
  if (Array.isArray(over) || typeof over !== 'object') return over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = base && typeof base[k] === 'object' && base[k] !== null && !Array.isArray(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}
