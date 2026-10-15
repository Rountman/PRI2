// 5.3 VK32 price recommendation per SKU × DC.
import { skuLabel } from '../normalize.ts';
import { round2 } from '../analysis/sales.ts';
import { allowedDcs, marketAnchor, ourPrice, startPrice, type Model } from './model.ts';

export type Vk32Action = 'zvýšit' | 'snížit' | 'držet' | 'nastavit';

export type Vk32Cell = {
  dc: string;
  current: number | null; // our price in the DC (last days with sales)
  recommended: number;
  delta: number | null;
  action: Vk32Action;
  reason: string;
  demandPerDay: number; // in this DC
  floorHit: boolean; // recommendation clamped to unit cost
  belowCost: boolean; // current price < unit cost (alert)
  warnFixed: boolean; // recommended < unit cost + fixed cost per unit (yellow)
};

export type Vk32Row = {
  sku: string;
  mat: string;
  label: string;
  unitCost: number;
  unitCostSource: string;
  fixedPerUnit: number;
  anchor: number | null;
  stock: number;
  coverDays: number | null;
  cells: Vk32Cell[];
};

export type Vk32Table = { pregame: boolean; rows: Vk32Row[]; dcs: string[]; anchorDay: number | null };

export function vk32Table(m: Model): Vk32Table {
  const { cfg, ds } = m;
  const p = cfg.pricing;
  let anchorDay: number | null = null;
  const rows: Vk32Row[] = m.skus.map((sku) => {
    const unitCost = m.unitCost[sku];
    const anchor = m.pregame ? null : marketAnchor(ds, sku);
    if (anchor) anchorDay = Math.max(anchorDay ?? 0, anchor.gameDay);
    const d = m.demand[sku];
    const stock = Math.max(0, m.stock[sku] ?? 0);
    const cover = d.perDay > 0 ? stock / d.perDay : null;
    const cells = allowedDcs(cfg, sku).map((dc): Vk32Cell => {
      const current = m.pregame ? null : ourPrice(ds, sku, dc, m.gameDay, cfg.md61.demandWindow);
      let recommended: number;
      let action: Vk32Action = 'držet';
      let reason = '';
      if (current === null) {
        recommended = anchor ? Math.max(startPrice(cfg, sku, dc), round2(anchor.price + (cfg.startPrices.dcAdjust[dc] ?? 0))) : startPrice(cfg, sku, dc);
        action = 'nastavit';
        reason = m.pregame ? 'startovní cena z Nastavení' : anchor ? 'bez prodejů v DC – kotva trhu / startovní cena' : 'bez prodejů v DC – startovní cena';
      } else if ((stock <= 0 && d.perDay > 0) || (cover !== null && cover < p.lowCoverDays)) {
        recommended = current + p.step;
        action = 'zvýšit';
        reason = stock <= 0 ? 'vyprodáno' : `pokrytí ${cover!.toFixed(1)} dne < ${p.lowCoverDays}`;
      } else if (stock > 0 && (cover === null || cover > p.highCoverDays)) {
        const floor = anchor ? anchor.price * (1 - p.anchorFloorPct / 100) : -Infinity;
        recommended = Math.max(current - p.step, floor);
        action = recommended < current - 0.005 ? 'snížit' : 'držet';
        reason = action === 'snížit' ? `pokrytí ${cover === null ? '∞' : cover.toFixed(0)} dní > ${p.highCoverDays}` : `pokrytí vysoké, ale cena už je u kotvy trhu −${p.anchorFloorPct} %`;
      } else {
        recommended = current;
        reason = cover !== null ? `pokrytí ${cover.toFixed(1)} dne – v pásmu ${p.lowCoverDays}–${p.highCoverDays}` : 'beze změny';
      }
      recommended = round2(recommended);
      const floorHit = recommended < unitCost;
      if (floorHit) {
        recommended = round2(Math.ceil(unitCost * 100) / 100);
        reason += ' · podlaha = unit cost';
      }
      if (current !== null && action !== 'nastavit' && Math.abs(recommended - current) < 0.005) action = 'držet';
      return {
        dc,
        current,
        recommended,
        delta: current !== null ? round2(recommended - current) : null,
        action,
        reason,
        demandPerDay: d.byDc[dc] ?? 0,
        floorHit,
        belowCost: current !== null && current < unitCost,
        warnFixed: p.warnFixedPerUnit && recommended < unitCost + m.fixedPerUnit,
      };
    });
    return { sku, mat: m.mat(sku), label: skuLabel(sku), unitCost, unitCostSource: m.a.costs[sku]?.source ?? 'BOM', fixedPerUnit: m.fixedPerUnit, anchor: anchor?.price ?? null, stock, coverDays: cover, cells };
  });
  return { pregame: m.pregame, rows, dcs: cfg.channels.map((c) => c.dc), anchorDay };
}
