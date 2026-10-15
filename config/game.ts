// Game parameter types + pure helpers. Values live in presets.ts; every value can be overridden
// in UI (Rozšířené → Nastavení), stored in SQLite.

export type PresetName = 'intro' | 'extended';
export type Area = 'N' | 'S' | 'W';
export type RawKey = 'R01' | 'R02' | 'R03' | 'R04' | 'R05' | 'R06';
export type PackKey = 'P01' | 'P02' | 'P03' | 'P04';
export type Recipe = Partial<Record<RawKey, number>>; // share of product mass, sums to 1
export type Size = '500g' | '1kg';

export type RatingRow = { threshold: number; rating: string; premium: number }; // premium in % points

export type Sensitivity = 'nízká' | 'střední' | 'vysoká' | 'velmi vysoká';

export type ChannelConfig = {
  dc: string;
  name: string;
  sizes: Size[];
  marketPer5DaysPerTeam: number; // € – briefing
  priceSensitivity: Sensitivity;
  marketingSensitivity: Sensitivity;
};

/** Fixed costs charged every `periodDays` days (Extended briefing: €126 250 / 5 days). */
export type FixedCosts = { periodDays: number; labor: number; overhead: number; sga: number; depBuilding: number; depMachines: number };

export type GameConfig = {
  preset: PresetName;
  teamCode: string; // SAP material prefix, e.g. 'GG' → GG-F01 (empty = detect from data)
  roundLength: number;
  rounds: number; // [OVĚŘIT] total rounds in the competition
  initial: { cash: number; loan: number; machines: number; finishedGoodsPerSku: number };
  capacityPerDay: number; // units/day = account 11000 / 1000
  capacityInUnits: boolean; // capacity counts boxes regardless of size
  capacityCostPer1000: number; // € per +1 000 units/day
  setup: { minHours: number; varHours: number; k: number; spend: number };
  setupSteps: number[]; // cumulative 478000 balances for the marginal table
  lotMin: number;
  lotMax: number;
  lotRounding: number;
  fixedCosts: FixedCosts;
  depreciationPerDayPerM: number; // machines: €50 000 / 5 days per €24M ≈ €417/day per €1M
  interestPerDayPerM: number; // ZCK11 example: €2 644,80/day at €8M
  riskFreeRate: number; // 0.07
  ratingTable: RatingRow[];
  defaultRating: string; // used when no finance snapshot exists
  extraCapacityUtilization: number; // what-if: share of added capacity that will actually sell (0..1)

  // ---- v2 decision parameters ----
  assortment: string[]; // SKUs we produce
  startPrices: { '500g': number; '1kg': number; dcAdjust: Record<string, number>; overrides: Record<string, number> }; // overrides key "F12:12"
  setupProposal: number; // € proposed before round 1 [ODHAD]
  md61: {
    firstCycleQty: Record<Size, number>; // per SKU before round 1, by pack size
    nextMrpDays: number; // days to the next planned MRP run
    leadTimeMax: number; // supplier lead time max (days)
    stockoutBoost: number; // demand × this when sold out ≥ stockoutBoostDays [ODHAD]
    stockoutBoostDays: number;
    demandWindow: number; // days for the demand average
    mode: 'celková' | 'doplnění'; // [OVĚŘIT] how MD61 forecast is consumed
    changeoversPerRound: number; // default for setup what-if without production data
  };
  pricing: { step: number; lowCoverDays: number; highCoverDays: number; anchorFloorPct: number; warnFixedPerUnit: boolean };
  reserve: { fixedDays: number; buffer: number }; // cash reserve for loan repayment
  investPayback: number; // recommend investment when return > x × spend
  maxCards: number;
  maxCritical: number;

  marketingEurPerRegionDay: number;
  channels: ChannelConfig[];
  areas: Area[];
  recipes: Record<string, Recipe>; // by flavor digit '1'..'6' – current BOM
  recipeMin: { oats: number; wheat: number; flavor: number; mixedFruitNuts: number; mixedEachMin: number };
  rawPrices: Record<RawKey | PackKey, number>; // fallback when ProcSourcing missing
  storage: { finishedGoods: number; raw: number; packaging: number };
  storageExtraPerDay: { finishedGoods: number; raw: number; packaging: number }; // € per day per +50k
  valuationChartSkipDays: number;
  calibrationTolerance: number;
  financeMatchTolerance: number;
  dataAgeSec: { green: number; orange: number };
  ignoreVendors: string[]; // V03 = initial stock purchase in Intro
};

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends (infer U)[] ? U[] : T[K] extends object ? DeepPartial<T[K]> : T[K] };

export function setupHours(cfg: GameConfig, spend = cfg.setup.spend): number {
  // SetupTime = 2 + (6 × 250 000) / (250 000 + balance478000); balance 0 → 8 h
  const { minHours, varHours, k } = cfg.setup;
  return minHours + (varHours * k) / (k + Math.max(0, spend));
}

export function interestPerDay(cfg: GameConfig, loan = cfg.initial.loan): number {
  return (Math.abs(loan) / 1e6) * cfg.interestPerDayPerM;
}

/** Fixed costs per day incl. interest on `loan` (Extended: 126 250 / 5 + 2 644,80 = 27 894,80). */
export function fixedPerDay(cfg: GameConfig, loan = cfg.initial.loan): number {
  const f = cfg.fixedCosts;
  return (f.labor + f.overhead + f.sga + f.depBuilding + f.depMachines) / f.periodDays + interestPerDay(cfg, loan);
}

/** Cash to keep before repaying the loan: fixed costs N days + next cycle raw materials + buffer. */
export function cashReserve(cfg: GameConfig, rawNextCycle = 0): number {
  return fixedPerDay(cfg) * cfg.reserve.fixedDays + rawNextCycle + cfg.reserve.buffer;
}
