import type { GameConfig } from '@copilot/config';
import { priceList, unitCostFromBom, type PriceList } from '../bom.ts';
import { currentDiscount } from '../finance/index.ts';
import { calibrate, type Calibration } from '../finance/whatif.ts';
import { clockOf, type Clock, type ClockOverride } from '../phase.ts';
import type { Dataset } from '../types.ts';
import { productionByRound, openOrders, type RoundProduction } from './production.ts';
import { channelStats, latestEconomics, marketShare, skuEconomics, unitCosts, type ChannelStat, type ShareRow, type SkuRound, type UnitCost } from './sales.ts';
import { valuationTrend, type ValuationTrend } from './valuation.ts';
import { stockPath, type StockPath } from './stock.ts';

export * from './stock.ts';
export * from './sales.ts';
export * from './production.ts';
export * from './valuation.ts';

export type Has = Record<'valuation' | 'market' | 'sales' | 'summary' | 'inventory' | 'production' | 'sourcing' | 'purchases' | 'finance', boolean>;

export type Analysis = {
  clock: Clock;
  prices: PriceList;
  costs: Record<string, UnitCost>;
  economics: SkuRound[];
  econLatest: Record<string, SkuRound>;
  stockPath: StockPath;
  channels: ChannelStat[];
  share: ShareRow[];
  production: RoundProduction[];
  openOrders: Dataset['production'];
  valuation: ValuationTrend;
  discount: ReturnType<typeof currentDiscount>;
  calibration: Calibration;
  /** which inputs are present – UI renders only what can be computed */
  has: Has;
};

export function analyze(ds: Dataset, cfg: GameConfig, ov: ClockOverride = {}): Analysis {
  const clock = clockOf(ds, cfg, ov);
  const prices = priceList(ds, cfg);
  const costs = unitCosts(ds, (sku) => unitCostFromBom(sku, cfg, prices));
  const economics = skuEconomics(ds, cfg, costs);
  return {
    clock,
    prices,
    costs,
    economics,
    econLatest: latestEconomics(economics),
    stockPath: stockPath(ds, cfg, clock.gameDay),
    channels: channelStats(ds, cfg),
    share: marketShare(ds),
    production: productionByRound(ds, cfg, clock),
    openOrders: openOrders(ds, clock),
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
