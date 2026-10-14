// Click-through guides per T-code. [OVĚŘIT] in the live game; editable in UI (Nastavení → Návody).
// Placeholders {name} are filled with concrete values by the rules.

export type HowtoKey = 'price' | 'marketing' | 'production' | 'purchase' | 'loan' | 'investment' | 'bom' | 'lotsize';

export type Howto = { tcode: string; label: string; steps: string[] };

export const DEFAULT_HOWTO: Record<HowtoKey, Howto> = {
  price: {
    tcode: 'VK32',
    label: 'Change Price List',
    steps: ['Otevři VK32 (Change Price List)', 'Vyber materiál {mat} a DC {dc}', 'Přepiš cenu na {price}', 'Save'],
  },
  marketing: {
    tcode: 'ZADS',
    label: 'Marketing Expense Planning',
    steps: ['Otevři ZADS (Marketing Expense Planning)', 'Vyber materiál {mat}, region {area}', 'Zadej částku {eur}', 'Save'],
  },
  production: {
    tcode: 'CO41',
    label: 'MRP → Convert Planned Orders',
    steps: ['Spusť MRP (Planning)', 'Otevři CO41 (Convert Planned Orders)', 'Vyber zakázky {mat}', 'Convert'],
  },
  purchase: {
    tcode: 'ME59N',
    label: 'Create Purchase Order',
    steps: ['Otevři Create Purchase Order (ME59N / ME21N)', 'Surovina {mat}, dodavatel {vendor}', 'Množství {qty}', 'Save'],
  },
  loan: {
    tcode: 'Loan',
    label: 'Accounting – Loan repayment',
    steps: ['Otevři Accounting → Loan repayment', 'Zadej částku {eur}', 'Post'],
  },
  investment: {
    tcode: 'Invest',
    label: 'Accounting – Investment',
    steps: ['Otevři Accounting → Investment', 'Typ investice: {kind}', 'Zadej částku {eur}', 'Post'],
  },
  bom: {
    tcode: 'ZCS02',
    label: 'Change BOM',
    steps: ['Otevři ZCS02', 'Materiál {mat}', 'Nastav složení: {recipe}', 'Save (zkontroluj, že BOM je validní)'],
  },
  lotsize: {
    tcode: 'MM02',
    label: 'Change Material (lot size)',
    steps: ['Mezi koly otevři MM02', 'Materiál {mat}, pohled MRP 1', 'Maximum lot size = {qty}', 'Save'],
  },
};

export function fillSteps(steps: string[], values: Record<string, string | number>): string[] {
  return steps.map((s) => s.replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m)));
}
