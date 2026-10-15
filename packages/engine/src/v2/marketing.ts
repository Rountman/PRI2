// ZADS suggestion table for Rozšířené → Marketing: advertise only where the DC reacts and stock is there.
import type { Area } from '@copilot/config';
import { allowedDcs, type Model } from './model.ts';

export type MarketingRow = { sku: string; dc: string; sensitivity: string; coverDays: number | null; area: Area | null; eurPerDay: number; advise: boolean; reason: string };

export function marketingTable(m: Model): MarketingRow[] {
  const { cfg, ds } = m;
  const out: MarketingRow[] = [];
  for (const sku of m.skus) {
    const stock = Math.max(0, m.stock[sku] ?? 0);
    const d = m.demand[sku].perDay;
    const cover = m.pregame ? null : d > 0 ? stock / d : null;
    for (const dc of allowedDcs(cfg, sku)) {
      const ch = cfg.channels.find((c) => c.dc === dc)!;
      const byArea = cfg.areas.map((ar) => ({ ar, q: ds.sales.filter((s) => s.dc === dc && s.material === sku && s.area === ar).reduce((x, s) => x + s.quantity, 0) }));
      const area = ds.sales.length ? byArea.sort((x, y) => x.q - y.q)[0].ar : null;
      const sensitive = ch.marketingSensitivity === 'vysoká' || ch.marketingSensitivity === 'střední';
      const hasStock = m.pregame || (cover !== null && cover >= cfg.pricing.lowCoverDays + 2) || (cover === null && stock > 0);
      const advise = sensitive && hasStock;
      out.push({
        sku,
        dc,
        sensitivity: ch.marketingSensitivity,
        coverDays: cover,
        area,
        eurPerDay: advise ? (ch.marketingSensitivity === 'vysoká' ? cfg.marketingEurPerRegionDay : cfg.marketingEurPerRegionDay / 2) : 0,
        advise,
        reason: !sensitive ? `DC ${dc} na reklamu skoro nereaguje` : !hasStock ? 'málo zboží – reklama by jen pálila peníze' : m.pregame ? 'start: malá částka, sleduj prodeje' : `pokrytí ${cover === null ? '∞' : cover.toFixed(1)} dne – zboží je`,
      });
    }
  }
  return out;
}
