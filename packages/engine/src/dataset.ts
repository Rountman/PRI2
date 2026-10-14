import type { ParseResult } from './parse/index.ts';
import { SPECS } from './parse/reports.ts';
import { emptyDataset, type Dataset, type ReportKind, type RowOf } from './types.ts';

/** Merge parsed reports into a dataset in memory (upsert by natural key; snapshot reports replace). */
export function applyResults(ds: Dataset, results: ParseResult[], meta: { gameDay?: number | null; importedAt?: string } = {}): Dataset {
  const out: Dataset = { ...ds, poFirstSeen: { ...ds.poFirstSeen }, imports: { ...ds.imports } };
  for (const r of results) {
    const kind = r.kind as ReportKind;
    if (SPECS[kind].mode === 'snapshot') {
      (out as any)[kind] = r.rows;
    } else {
      const prev = (out[kind] as RowOf[ReportKind][]) ?? [];
      const keyFn = SPECS[kind].key as (row: RowOf[ReportKind]) => string;
      const map = new Map<string, RowOf[ReportKind]>();
      // previous rows keep their occurrence suffixes
      const seen = new Map<string, number>();
      for (const row of prev) {
        const base = keyFn(row);
        const n = (seen.get(base) ?? 0) + 1;
        seen.set(base, n);
        map.set(n === 1 ? base : `${base}#${n}`, row);
      }
      r.rows.forEach((row, i) => map.set(r.keys[i], row));
      (out as any)[kind] = [...map.values()];
    }
    const gameDay = meta.gameDay ?? latestGameDay(out);
    if (kind === 'inventory') out.inventoryGameDay = gameDay;
    if (kind === 'purchases') {
      for (const p of r.rows as RowOf['purchases'][]) if (!(p.order in out.poFirstSeen) && gameDay !== null) out.poFirstSeen[p.order] = gameDay;
    }
    out.imports[kind] = { importedAt: meta.importedAt ?? new Date().toISOString(), gameDay };
  }
  return out;
}

export function datasetFrom(results: ParseResult[], meta?: { gameDay?: number | null; importedAt?: string }): Dataset {
  return applyResults(emptyDataset(), results, meta);
}

/**
 * Latest game day evidenced by the data. SummarySales contains zero rows for future days,
 * so only rows with activity count.
 */
export function latestGameDay(ds: Dataset): number | null {
  let max = 0;
  for (const v of ds.valuation) max = Math.max(max, v.gameDay);
  for (const s of ds.sales) max = Math.max(max, s.gameDay);
  for (const s of ds.summary) if (s.quantity > 0) max = Math.max(max, s.gameDay);
  for (const m of ds.market) max = Math.max(max, m.gameDay);
  for (const p of ds.production) max = Math.max(max, p.released ?? 0);
  return max || null;
}
