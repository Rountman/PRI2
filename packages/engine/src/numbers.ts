export type NumberLocale = 'en' | 'de';

/**
 * Tolerant number parser for SAP/Fiori exports and pasted text.
 * Handles: 1234.5 · 1,234.56 · 1.234,56 · 75,000- · "3,376,340.64 EUR" · −1 234 · (1,234.00)
 */
export function parseNumber(v: unknown, locale: NumberLocale = 'en'): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[−–]/g, '-'); // unicode minus / en dash
  if (s.endsWith('-')) {
    neg = !neg;
    s = s.slice(0, -1);
  }
  s = s.replace(/[^\d.,\-]/g, ''); // drop currency, spaces, NBSP, letters
  if (s.startsWith('-')) {
    neg = !neg;
    s = s.slice(1);
  }
  if (!s || /-/.test(s)) return null;
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  if (hasDot && hasComma) {
    // the last separator is the decimal one
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (hasComma) {
    const parts = s.split(',');
    const thousands = parts.length > 2 || (locale === 'en' && /^\d{1,3}(,\d{3})+$/.test(s));
    s = thousands ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (hasDot) {
    const parts = s.split('.');
    const thousands = parts.length > 2 || (locale === 'de' && /^\d{1,3}(\.\d{3})+$/.test(s));
    if (thousands) s = s.replace(/\./g, '');
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

/** Guess the locale of a table: a comma followed by 1–2 digits at the end means decimal comma. */
export function detectLocale(cells: unknown[]): NumberLocale {
  let de = 0;
  let en = 0;
  for (const c of cells) {
    if (typeof c !== 'string') continue;
    const s = c.trim();
    if (/\d,\d{1,2}-?$/.test(s) || /\d\.\d{3},\d/.test(s)) de++;
    else if (/\d\.\d{1,2}-?$/.test(s) || /\d,\d{3}\.\d/.test(s)) en++;
  }
  return de > en ? 'de' : 'en';
}
