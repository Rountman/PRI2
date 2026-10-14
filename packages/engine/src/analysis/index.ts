import type { GameConfig } from '@copilot/config';
import { priceList, unitCostFromBom, type PriceList } from '../bom.ts';
import { currentDiscount } from '../finance/index.ts';
import { calibrate, type Calibration } from '../finance/whatif.ts';
import { clockOf, type Clock, type ClockOverride } from '../phase.ts';
import type { Dataset } from '../types.ts';
import { productionByRound, productionPlan, openOrders, type ProductionPlan, type RoundProduction } from './production.ts';
import {
  channelStats,
  coverage,
  latestEconomics,
  marketShare,
  pricePositions,
  skuEconomics,
  stockouts,
  unitCosts,
  type ChannelStat,
  type Coverage,
  type PricePosition,
  type ShareRow,
  type SkuRound,
  type Stockouts,
  type UnitCost,
} from './sales.ts';
import { valuationTrend, type ValuationTrend } from './valuation.ts';
import { stockPath, type StockPath } from './stock.ts';

export * from './stock.ts';
export * from './sales.ts';
export * from './production.ts';
export * from './valuation.ts';

export type Analysis = {
  clock: Clock;
  prices: PriceList;
  costs: Record<string, UnitCost>;
  economics: SkuRound[];
  econLatest: Record<string, SkuRound>;
  coverage: Coverage[];
  stockPath: StockPath;
  channels: ChannelStat[];
  stockouts: Stockouts;
  share: ShareRow[];
  pricing: PricePosition[];
  production: RoundProduction[];
  openOrders: Dataset['production'];
  plan: ProductionPlan;
  valuation: ValuationTrend;
  discount: ReturnType<typeof currentDiscount>;
  calibration: Calibration;
  /** which inputs are present – UI uses it to degrade gracefully */
  has: Record<'valuation' | 'market' | 'sales' | 'summary' | 'inventory' | 'production' | 'sourcing' | 'purchases' | 'finance', boolean>;
};

export function analyze(ds: Dataset, cfg: GameConfig, ov: ClockOverride = {}): Analysis {
  const clock = clockOf(ds, cfg, ov);
  const prices = priceList(ds, cfg);
  const costs = unitCosts(ds, (sku) => unitCostFromBom(sku, cfg, prices));
  const economics = skuEconomics(ds, cfg, costs);
  const econLatest = latestEconomics(economics);
  const path = stockPath(ds, cfg, clock.gameDay);
  const cov = coverage(ds, cfg, clock, path);
  return {
    clock,
    prices,
    costs,
    economics,
    econLatest,
    coverage: cov,
    channels: channelStats(ds, cfg),
    stockPath: path,
    stockouts: stockouts(ds, cfg, clock, econLatest, path),
    share: marketShare(ds),
    pricing: pricePositions(ds, cfg, clock, cov, costs),
    production: productionByRound(ds, cfg, clock),
    openOrders: openOrders(ds, clock),
    plan: productionPlan(ds, cfg, clock, econLatest, path, Math.max(cfg.purchaseHorizonDays, 10)),
    valuation: valuationTrend(ds, cfg),
    discount: currentDiscount(ds, cfg),
    calibration: calibrate(ds, cfg),
    has: {
      valuation: ds.valuation.length > 0,
      market: ds.market.length > 0,
      sales: ds.sales.length > 0,
      summary: ds.summary.length > 0,
      inventory: ds.inventory.length > 0,
      production: ds.production.length > 0,
      sourcing: ds.sourcing.length > 0,
      purchases: ds.purchases.length > 0,
      finance: ds.finance.length > 0,
    },
  };
}
