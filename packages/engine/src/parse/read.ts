import * as XLSX from 'xlsx';

export type RawGrid = unknown[][];

/** Read first non-empty sheet of an xlsx/xls/csv workbook into a grid (no header interpretation). */
export function readWorkbook(data: ArrayBuffer | Uint8Array): RawGrid {
  const wb = XLSX.read(data instanceof Uint8Array ? data : new Uint8Array(data), { type: 'array', dense: true });
  for (const name of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false });
    if (grid.length) return grid;
  }
  return [];
}

/** Pasted text from Fiori (Cmd+A/C) → TSV. Falls back to ';' or ',' separated if there are no tabs. */
export function readText(text: string): RawGrid {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!lines.length) return [];
  const sep = lines.some((l) => l.includes('\t')) ? '\t' : lines[0].includes(';') ? ';' : ',';
  return lines.map((l) => l.split(sep).map((c) => unquote(c.trim())));
}

function unquote(s: string): string {
  return s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1).replace(/""/g, '"') : s;
}

export function isZipLike(data: Uint8Array): boolean {
  return data.length > 4 && data[0] === 0x50 && data[1] === 0x4b; // "PK" → xlsx
}

export function readAny(input: ArrayBuffer | Uint8Array | string): RawGrid {
  if (typeof input === 'string') return readText(input);
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (isZipLike(u8) || (u8[0] === 0xd0 && u8[1] === 0xcf)) return readWorkbook(u8);
  return readText(new TextDecoder('utf-8').decode(u8));
}
