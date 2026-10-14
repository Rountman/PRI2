import type { NumberLocale } from '../numbers.ts';
import { parseNumber } from '../numbers.ts';
import {
  normArea,
  parseIntLoose,
  parseRoundDay,
  splitMaterial,
  toGameDay,
} from '../normalize.ts';
import type { ReportKind, RowOf } from '../types.ts';

export type ColumnSpec = { field: string; header: string; required: boolean; aliases?: string[] };

export type ConvertCtx = { roundLength: number; locale: NumberLocale };
type Getter = (field: string) => unknown;

export type ReportSpec<K extends ReportKind> = {
  kind: K;
  label: string; // Czech UI label
  fiori: string; // where to export it
  columns: ColumnSpec[];
  convert: (get: Getter, ctx: ConvertCtx) => RowOf[K] | null;
  key: (row: RowOf[K]) => string;
  /** Cumulative reports contain whole history; snapshot reports replace previous content. */
  mode: 'upsert' | 'snapshot';
};

const c = (field: string, header: string, required = true, aliases?: string[]): ColumnSpec => ({ field, header, required, aliases });

const num = (v: unknown, ctx: ConvertCtx) => parseNumber(v, ctx.locale) ?? 0;
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
/** SAP exports codes like "02" as text, but a paste/xlsx may turn them into numbers → pad back. */
const code2 = (v: unknown) => {
  const s = str(v);
  return /^\d$/.test(s) ? `0${s}` : s;
};

function roundDayFrom(get: Getter, ctx: ConvertCtx, roundField: string, dayField: string) {
  const round = parseIntLoose(get(roundField));
  const day = parseIntLoose(get(dayField));
  if (round === null || day === null) return null;
  return { round, day, gameDay: toGameDay(round, day, ctx.roundLength) };
}

function rdDate(v: unknown, ctx: ConvertCtx): number | null {
  const rd = parseRoundDay(v);
  return rd ? toGameDay(rd.round, rd.day, ctx.roundLength) : null;
}

export const SPECS: { [K in ReportKind]: ReportSpec<K> } = {
  valuation: {
    kind: 'valuation',
    label: 'Valuace (Company Valuation)',
    fiori: 'Company Valuation',
    mode: 'upsert',
    columns: [c('round', 'Simulation Round'), c('step', 'Simulation Step'), c('valuation', 'Company Valuation')],
    convert: (get, ctx) => {
      const rd = roundDayFrom(get, ctx, 'round', 'step');
      const valuation = parseNumber(get('valuation'), ctx.locale);
      if (!rd || valuation === null) return null;
      return { ...rd, valuation };
    },
    key: (r) => String(r.gameDay),
  },
  market: {
    kind: 'market',
    label: 'Trh (Price Market)',
    fiori: 'Market – PriceMarket (ZMARKET)',
    mode: 'upsert',
    columns: [
      c('date', 'Simulation Date'),
      c('material', 'Material'),
      c('description', 'Description', false),
      c('area', 'Area'),
      c('price', 'Price'),
      c('quantity', 'Quantity'),
      c('value', 'Value', false),
    ],
    convert: (get, ctx) => {
      const rd = parseRoundDay(get('date'));
      const area = normArea(get('area'));
      if (!rd || !area) return null;
      const quantity = num(get('quantity'), ctx);
      const price = num(get('price'), ctx);
      return {
        round: rd.round,
        day: rd.day,
        gameDay: toGameDay(rd.round, rd.day, ctx.roundLength),
        material: splitMaterial(get('material')).material,
        description: str(get('description')),
        area,
        price,
        quantity,
        value: parseNumber(get('value'), ctx.locale) ?? price * quantity,
      };
    },
    key: (r) => `${r.gameDay}|${r.material}|${r.area}`,
  },
  sales: {
    kind: 'sales',
    label: 'Prodeje (Sales Report)',
    fiori: 'Sales – Sales Report',
    mode: 'upsert',
    columns: [
      c('round', 'Round'),
      c('day', 'Day'),
      c('area', 'Area'),
      c('location', 'Location', false),
      c('dc', 'D. Channel', true, ['Distribution Channel', 'DChannel', 'Dist. Channel']),
      c('material', 'Material'),
      c('description', 'Description', false),
      c('netPrice', 'Net Price', false),
      c('quantity', 'Quantity'),
      c('netValue', 'Net Value'),
      c('cost', 'Cost', false),
    ],
    convert: (get, ctx) => {
      const rd = roundDayFrom(get, ctx, 'round', 'day');
      const area = normArea(get('area'));
      if (!rd || !area) return null;
      const quantity = num(get('quantity'), ctx);
      const netValue = num(get('netValue'), ctx);
      return {
        ...rd,
        area,
        location: code2(get('location')),
        dc: code2(get('dc')),
        ...splitMaterial(get('material')),
        description: str(get('description')),
        netPrice: parseNumber(get('netPrice'), ctx.locale) ?? (quantity ? netValue / quantity : 0),
        quantity,
        netValue,
        cost: num(get('cost'), ctx),
      };
    },
    key: (r) => `${r.gameDay}|${r.area}|${r.dc}|${r.material}|${r.netPrice}|${r.quantity}`,
  },
  summary: {
    kind: 'summary',
    label: 'Souhrn prodejů (Summary Sales)',
    fiori: 'Sales – Summary Sales Report',
    mode: 'upsert',
    columns: [
      c('round', 'Round'),
      c('day', 'Day'),
      c('material', 'Material'),
      c('description', 'Description', false),
      c('orders', 'Orders', false),
      c('quantity', 'Quantity'),
      c('netValue', 'Net Value'),
      c('cost', 'Cost', false),
    ],
    convert: (get, ctx) => {
      const rd = roundDayFrom(get, ctx, 'round', 'day');
      if (!rd) return null;
      return {
        ...rd,
        ...splitMaterial(get('material')),
        description: str(get('description')),
        orders: num(get('orders'), ctx),
        quantity: num(get('quantity'), ctx),
        netValue: num(get('netValue'), ctx),
        cost: num(get('cost'), ctx),
      };
    },
    key: (r) => `${r.gameDay}|${r.material}`,
  },
  inventory: {
    kind: 'inventory',
    label: 'Sklad (Inventory Report)',
    fiori: 'Inventory – Inventory Report',
    mode: 'snapshot',
    columns: [
      c('location', 'Location'),
      c('category', 'Category', false),
      c('material', 'Material'),
      c('description', 'Description', false),
      c('stock', 'Stock'),
      c('reserved', 'Reserved', false),
      c('unit', 'Unit', false),
    ],
    convert: (get, ctx) => {
      const { material, teamCode } = splitMaterial(get('material'));
      if (!material) return null;
      let category = str(get('category'));
      if (!category) category = material.startsWith('F') ? 'Finished Goods' : material.startsWith('P') ? 'Packaging' : 'Raw Materials';
      return {
        location: code2(get('location')),
        category,
        material,
        teamCode,
        description: str(get('description')),
        stock: num(get('stock'), ctx),
        reserved: num(get('reserved'), ctx),
        unit: str(get('unit')),
      };
    },
    key: (r) => `${r.location}|${r.material}`,
  },
  production: {
    kind: 'production',
    label: 'Výroba (Production Report)',
    fiori: 'Production – Production Report',
    mode: 'upsert',
    columns: [
      c('order', 'Order'),
      c('material', 'Material'),
      c('description', 'Description', false),
      c('start', 'Start'),
      c('finish', 'Finish'),
      c('setup', 'Setup', false),
      c('released', 'Released', false),
      c('unitCost', 'Unit Cost', false),
      c('target', 'Target'),
      c('confirmed', 'Confirmed', false),
    ],
    convert: (get, ctx) => {
      const order = str(get('order'));
      if (!order) return null;
      return {
        order,
        ...splitMaterial(get('material')),
        description: str(get('description')),
        start: rdDate(get('start'), ctx),
        finish: rdDate(get('finish'), ctx),
        released: rdDate(get('released'), ctx),
        setupHours: num(get('setup'), ctx),
        unitCost: num(get('unitCost'), ctx),
        target: num(get('target'), ctx),
        confirmed: num(get('confirmed'), ctx),
      };
    },
    key: (r) => r.order,
  },
  sourcing: {
    kind: 'sourcing',
    label: 'Ceník surovin (ProcSourcing)',
    fiori: 'Procurement – Sourcing / ZME13',
    mode: 'snapshot',
    columns: [c('vendor', 'Vendor'), c('material', 'Material'), c('grossPrice', 'Gross Price', true, ['Price', 'Net Price']), c('source', 'Source', false)],
    convert: (get, ctx) => {
      const { material, teamCode } = splitMaterial(get('material'));
      if (!material) return null;
      return { vendor: str(get('vendor')), material, teamCode, grossPrice: num(get('grossPrice'), ctx), source: str(get('source')) };
    },
    key: (r) => `${r.vendor}|${r.material}`,
  },
  purchases: {
    kind: 'purchases',
    label: 'Nákupní objednávky (PO Tracking)',
    fiori: 'Procurement – Purchase Order Tracking',
    mode: 'upsert',
    columns: [
      c('order', 'Order'),
      c('vendor', 'Vendor'),
      c('material', 'Material'),
      c('description', 'Description', false),
      c('status', 'Status'),
      c('reception', 'Reception', false),
      c('price', 'Price', false),
      c('quantity', 'Quantity'),
      c('value', 'Value', false),
    ],
    convert: (get, ctx) => {
      const order = str(get('order'));
      if (!order) return null;
      return {
        order,
        vendor: str(get('vendor')),
        ...splitMaterial(get('material')),
        description: str(get('description')),
        status: str(get('status')),
        reception: rdDate(get('reception'), ctx),
        price: num(get('price'), ctx),
        quantity: num(get('quantity'), ctx),
        value: num(get('value'), ctx),
      };
    },
    key: (r) => `${r.order}|${r.material}`,
  },
};

export const REPORT_KINDS = Object.keys(SPECS) as ReportKind[];
