import type { GameConfig } from '@copilot/config';
import type { Analysis } from './analysis/index.ts';
import { unitCostFromBom } from './bom.ts';
import { fmtNum, fmtPrice } from './format.ts';
import { isFinishedGood, SKUS } from './normalize.ts';
import type { Dataset } from './types.ts';

export type SanityWarning = { id: string; level: 'info' | 'warn'; text: string };

/** Config vs. data checks (CLAUDE.md 6b.4). Only warnings – nothing fails. */
export function sanityChecks(ds: Dataset, cfg: GameConfig, a: Analysis): SanityWarning[] {
  const w: SanityWarning[] = [];
  const v03 = ds.purchases.filter((p) => cfg.ignoreVendors.includes(p.vendor) && isFinishedGood(p.material));
  if (v03.length && cfg.initial.finishedGoodsPerSku === 0) {
    w.push({ id: 'initial-stock', level: 'warn', text: `Data ukazují počáteční sklad (${fmtNum(v03[0].quantity)} ks/SKU od ${v03[0].vendor}), ale config má 0. Zkontroluj preset.` });
  }
  for (const sku of SKUS) {
    const c = a.costs[sku];
    if (c?.source !== 'ProductionReport') continue;
    const bom = unitCostFromBom(sku, cfg, a.prices);
    if (Math.abs(bom - c.cost) > 0.02) {
      w.push({ id: `unit-cost-${sku}`, level: 'warn', text: `${sku}: Unit Cost z výroby ${fmtPrice(c.cost)} ≠ BOM z cen ${fmtPrice(bom)}. Změnil se recept nebo ceny surovin?` });
    }
  }
  const maxDay = Math.max(0, ...ds.sales.map((s) => s.day), ...ds.summary.map((s) => s.day), ...ds.valuation.map((s) => s.day));
  if (maxDay > cfg.roundLength) w.push({ id: 'round-length', level: 'warn', text: `Data obsahují den ${maxDay}, ale délka kola v configu je ${cfg.roundLength}.` });
  const maxRound = Math.max(0, ...ds.valuation.map((v) => v.round), ...ds.sales.map((s) => s.round));
  if (maxRound > cfg.rounds) w.push({ id: 'rounds', level: 'warn', text: `Data obsahují kolo ${maxRound}, config počítá s ${cfg.rounds} koly.` });
  const known = new Set(cfg.channels.map((c) => c.dc));
  const dcs = [...new Set(ds.sales.map((s) => s.dc))].filter((d) => !known.has(d));
  if (dcs.length) w.push({ id: 'unknown-dc', level: 'warn', text: `Neznámé distribuční kanály v datech: ${dcs.join(', ')}.` });
  const skus = [...new Set([...ds.sales, ...ds.summary, ...ds.market].map((s) => s.material))].filter((m) => !SKUS.includes(m));
  if (skus.length) w.push({ id: 'unknown-sku', level: 'warn', text: `Neznámé materiály: ${skus.join(', ')}.` });
  const teams = [...new Set([...ds.sales, ...ds.summary, ...ds.inventory].map((s) => s.teamCode).filter(Boolean))];
  if (teams.length > 1) w.push({ id: 'teams', level: 'warn', text: `V datech je víc kódů týmu: ${teams.join(', ')}. Nahráváš exporty jiného týmu?` });
  const bad = a.stockPath.check.filter((c) => Math.abs(c.reconstructed - c.inventory) > 1);
  if (bad.length && ds.inventoryGameDay === a.clock.gameDay) {
    w.push({ id: 'stock-path', level: 'info', text: `Rekonstrukce skladu nesedí s Inventory u ${bad.map((b) => b.sku).join(', ')} – stockout analýza je orientační.` });
  }
  return w;
}
