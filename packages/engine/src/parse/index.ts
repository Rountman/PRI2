import { detectLocale, type NumberLocale } from '../numbers.ts';
import type { ReportKind, RowOf } from '../types.ts';
import { readAny, type RawGrid } from './read.ts';
import { REPORT_KINDS, SPECS } from './reports.ts';

export { SPECS, REPORT_KINDS } from './reports.ts';
export type { ColumnSpec, ReportSpec } from './reports.ts';
export { readAny, readText, readWorkbook } from './read.ts';

/** Header normalisation: case/whitespace/punctuation-insensitive. "D. Channel" → "dchannel" */
export const normHeader = (h: unknown) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Saved by the user in the mapping dialog for an unknown header signature. */
export type MappingProfile = {
  signature: string;
  kind: ReportKind;
  columns: Record<string, string>; // field → original header text
};

export const signatureOf = (headers: string[]) => [...headers.map(normHeader)].filter(Boolean).sort().join('|');

export type Detection = { kind: ReportKind; score: number; missingOptional: string[] };

/** Detect report kind from a header row. All required columns must be present; best coverage wins. */
export function detectKind(headers: string[]): Detection | null {
  const set = new Set(headers.map(normHeader));
  let best: Detection | null = null;
  for (const kind of REPORT_KINDS) {
    const cols = SPECS[kind].columns;
    const has = (col: (typeof cols)[number]) => [col.header, ...(col.aliases ?? [])].some((h) => set.has(normHeader(h)));
    if (!cols.filter((c) => c.required).every(has)) continue;
    const matched = cols.filter(has).length;
    // prefer specs that explain more of the header row, then those with more columns
    const score = matched / Math.max(set.size, 1) + matched / 100;
    if (!best || score > best.score) best = { kind, score, missingOptional: cols.filter((c) => !has(c)).map((c) => c.header) };
  }
  return best;
}

export type ParseResult<K extends ReportKind = ReportKind> = {
  kind: K;
  rows: RowOf[K][];
  keys: string[];
  headers: string[];
  warnings: string[];
  locale: NumberLocale;
  skipped: number;
};

export type UnknownResult = { kind: null; headers: string[]; signature: string; sample: unknown[][]; warnings: string[] };

/** Find the header row: the first of the first 10 rows that matches a signature (or a saved profile). */
function locateHeader(grid: RawGrid, profiles: MappingProfile[]): { index: number; kind: ReportKind | null; profile?: MappingProfile } {
  const limit = Math.min(grid.length, 10);
  for (let i = 0; i < limit; i++) {
    const headers = (grid[i] ?? []).map((h) => String(h ?? '').trim());
    const d = detectKind(headers);
    if (d) return { index: i, kind: d.kind };
    const sig = signatureOf(headers);
    const profile = profiles.find((p) => p.signature === sig);
    if (profile) return { index: i, kind: profile.kind, profile };
  }
  const first = grid.findIndex((r) => r.some((c) => c !== null && String(c).trim() !== ''));
  return { index: Math.max(first, 0), kind: null };
}

export type ParseOptions = { roundLength: number; profiles?: MappingProfile[]; forceKind?: ReportKind; profile?: MappingProfile };

export function parseGrid(grid: RawGrid, opts: ParseOptions): ParseResult | UnknownResult {
  const profiles = opts.profiles ?? [];
  const loc = locateHeader(grid, opts.profile ? [opts.profile, ...profiles] : profiles);
  const headers = (grid[loc.index] ?? []).map((h) => String(h ?? '').trim());
  const kind = opts.forceKind ?? opts.profile?.kind ?? loc.kind;
  const profile = opts.profile ?? loc.profile;
  const body = grid.slice(loc.index + 1);
  if (!kind) {
    return { kind: null, headers, signature: signatureOf(headers), sample: body.slice(0, 5), warnings: ['Neznámý report – namapuj sloupce.'] };
  }
  const spec = SPECS[kind];
  const idx = new Map(headers.map((h, i) => [normHeader(h), i] as const));
  const colIndex: Record<string, number> = {};
  const warnings: string[] = [];
  for (const col of spec.columns) {
    const mapped = profile?.columns[col.field];
    const candidates = mapped ? [mapped] : [col.header, ...(col.aliases ?? [])];
    const i = candidates.map((h) => idx.get(normHeader(h))).find((x) => x !== undefined);
    if (i !== undefined) colIndex[col.field] = i;
    else if (col.required) warnings.push(`Chybí povinný sloupec „${col.header}“.`);
    else warnings.push(`Chybí sloupec „${col.header}“ – analýzy, které ho potřebují, budou omezené.`);
  }
  const locale = detectLocale(body.slice(0, 200).flat());
  const ctx = { roundLength: opts.roundLength, locale };
  const rows: RowOf[ReportKind][] = [];
  const keys: string[] = [];
  const seen = new Map<string, number>();
  let skipped = 0;
  for (const raw of body) {
    if (!raw || raw.every((c) => c === null || String(c).trim() === '')) continue;
    const get = (field: string) => (field in colIndex ? raw[colIndex[field]] : undefined);
    const row = (spec.convert as (g: typeof get, c: typeof ctx) => RowOf[ReportKind] | null)(get, ctx);
    if (!row) {
      skipped++;
      continue;
    }
    // identical natural keys (e.g. two identical sales orders) get an occurrence suffix
    const base = (spec.key as (r: RowOf[ReportKind]) => string)(row);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    rows.push(row);
    keys.push(n === 1 ? base : `${base}#${n}`);
  }
  if (skipped) warnings.push(`Přeskočeno ${skipped} řádků, které nešly přečíst.`);
  return { kind, rows, keys, headers, warnings, locale, skipped };
}

/** xlsx bytes or pasted TSV → normalised rows. Never throws on bad content. */
export function parseReport(input: ArrayBuffer | Uint8Array | string, opts: ParseOptions): ParseResult | UnknownResult {
  let grid: RawGrid;
  try {
    grid = readAny(input);
  } catch (e) {
    return { kind: null, headers: [], signature: '', sample: [], warnings: [`Soubor nejde přečíst: ${(e as Error).message}`] };
  }
  return parseGrid(grid, opts);
}

export function isKnown(r: ParseResult | UnknownResult): r is ParseResult {
  return r.kind !== null;
}
