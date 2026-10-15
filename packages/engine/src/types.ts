import type { Area } from '@copilot/config';
export type { Area };

export type ReportKind =
  | 'valuation'
  | 'market'
  | 'sales'
  | 'summary'
  | 'inventory'
  | 'production'
  | 'sourcing'
  | 'purchases';

export type Size = '500g' | '1kg';

export type ValuationRow = { round: number; day: number; gameDay: number; valuation: number };

export type MarketRow = {
  round: number;
  day: number;
  gameDay: number;
  material: string;
  description: string;
  area: Area;
  price: number;
  quantity: number;
  value: number;
};

export type SalesRow = {
  round: number;
  day: number;
  gameDay: number;
  area: Area;
  location: string;
  dc: string;
  material: string;
  teamCode: string;
  description: string;
  netPrice: number;
  quantity: number;
  netValue: number;
  cost: number;
};

export type SummaryRow = {
  round: number;
  day: number;
  gameDay: number;
  material: string;
  teamCode: string;
  description: string;
  orders: number;
  quantity: number;
  netValue: number;
  cost: number;
};

export type InventoryCategory = 'Finished Goods' | 'Packaging' | 'Raw Materials' | string;

export type InventoryRow = {
  location: string;
  category: InventoryCategory;
  material: string;
  teamCode: string;
  description: string;
  stock: number;
  reserved: number;
  unit: string;
};

export type ProductionRow = {
  order: string;
  material: string;
  teamCode: string;
  description: string;
  start: number | null; // gameDay
  finish: number | null;
  released: number | null;
  setupHours: number;
  unitCost: number;
  target: number;
  confirmed: number;
};

export type SourcingRow = { vendor: string; material: string; teamCode: string; grossPrice: number; source: string };

export type PurchaseRow = {
  order: string;
  vendor: string;
  material: string;
  teamCode: string;
  description: string;
  status: string;
  reception: number | null; // gameDay; null = "Unscheduled"
  price: number;
  quantity: number;
  value: number;
};

export type RowOf = {
  valuation: ValuationRow;
  market: MarketRow;
  sales: SalesRow;
  summary: SummaryRow;
  inventory: InventoryRow;
  production: ProductionRow;
  sourcing: SourcingRow;
  purchases: PurchaseRow;
};

export type FinanceSnapshot = {
  gameDay: number;
  cash: number;
  receivables: number;
  payables: number; // negative or positive – normalised to magnitude
  loan: number; // magnitude
  netIncome: number;
  setupSpend: number; // 478000 balance (magnitude)
  roundsPlayed: number;
  savedAt?: string;
};

/** Everything the engine needs. Built by the server from SQLite, or in tests from fixtures. */
export type Dataset = {
  valuation: ValuationRow[];
  market: MarketRow[];
  sales: SalesRow[];
  summary: SummaryRow[];
  inventory: InventoryRow[];
  inventoryGameDay: number | null;
  production: ProductionRow[];
  sourcing: SourcingRow[];
  purchases: PurchaseRow[];
  poFirstSeen: Record<string, number>; // order → gameDay first imported
  finance: FinanceSnapshot[];
  imports: Partial<Record<ReportKind, { importedAt: string; gameDay: number | null }>>;
};

export const emptyDataset = (): Dataset => ({
  valuation: [],
  market: [],
  sales: [],
  summary: [],
  inventory: [],
  inventoryGameDay: null,
  production: [],
  sourcing: [],
  purchases: [],
  poFirstSeen: {},
  finance: [],
  imports: {},
});

// ---------- Action cards ----------
export type Priority = 'kritické' | 'běžné';
export type Confidence = 'jisté' | 'pravděpodobné' | 'odhad';
export type Phase = 'pred-hrou' | 'kolo' | 'mezi-koly';

export type ActionCard = {
  id: string; // stable within one data state – used for shared [✓]
  kind: string; // 'checklist' | 'md61' | 'vk32' | 'alert' | 'invest' …
  priority: Priority;
  title: string;
  profitEUR?: number; // estimated profit effect (sort key)
  impactEUR?: number; // the same translated to valuation
  deadline?: string;
  tcode: string; // e.g. "MD61 → MD01 → ME59N"
  steps: string[];
  copyValues?: { label: string; value: string }[];
  why: {
    summary: string;
    data: { label: string; value: string }[];
    rule: string;
    risk?: string;
    confidence: Confidence;
  };
  done?: boolean;
};
