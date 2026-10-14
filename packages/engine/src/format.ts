// Czech number formatting: spaces as thousands separators, decimal comma, € suffix.
const NBSP = ' ';

export function fmtNum(x: number | null | undefined, dec = 0): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return x === Infinity ? '∞' : '–';
  const neg = x < 0;
  const fixed = Math.abs(x).toFixed(dec);
  const [int, frac] = fixed.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return `${neg ? '−' : ''}${grouped}${frac ? `,${frac}` : ''}`;
}

export const fmtEUR = (x: number | null | undefined, dec = 0) => (x === null || x === undefined ? '–' : `${fmtNum(x, dec)}${NBSP}€`);
export const fmtPrice = (x: number | null | undefined) => fmtEUR(x, 2);
export const fmtPct = (x: number | null | undefined, dec = 0) => (x === null || x === undefined ? '–' : `${fmtNum(x * 100, dec)}${NBSP}%`);

/** 77 388 994 → "77,4M" */
export function fmtShort(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '–';
  const a = Math.abs(x);
  if (a >= 1e6) return `${fmtNum(x / 1e6, 1)}M`;
  if (a >= 1e3) return `${fmtNum(x / 1e3, 0)}k`;
  return fmtNum(x, 0);
}

/** Plain value for SAP input (no thousands separators, dot decimal) – used by copy buttons. */
export const sapValue = (x: number, dec = 2) => (dec === 0 ? String(Math.round(x)) : x.toFixed(dec));
