import type { Area } from '@copilot/config';
import type { Size } from './types.ts';

export const FLAVORS: Record<string, string> = {
  '1': 'Nut',
  '2': 'Blueberry',
  '3': 'Strawberry',
  '4': 'Raisin',
  '5': 'Original',
  '6': 'Mixed',
};

export const FLAVOR_CS: Record<string, string> = {
  '1': 'oříšky',
  '2': 'borůvka',
  '3': 'jahoda',
  '4': 'rozinky',
  '5': 'original',
  '6': 'mix',
};

/** All 12 finished goods keys. */
export const SKUS = ['F01', 'F02', 'F03', 'F04', 'F05', 'F06', 'F11', 'F12', 'F13', 'F14', 'F15', 'F16'];

/** "GG-F12" → { material: "F12", teamCode: "GG" }; "F12" → { material: "F12", teamCode: "" } */
export function splitMaterial(raw: unknown): { material: string; teamCode: string } {
  const s = String(raw ?? '').trim().toUpperCase();
  const material = s.slice(-3);
  const prefix = s.slice(0, -3).replace(/[-_\s]+$/, '');
  return { material, teamCode: prefix };
}

export function isFinishedGood(material: string): boolean {
  return /^F\d\d$/.test(material);
}

export function skuSize(material: string): Size {
  return material[1] === '1' ? '1kg' : '500g';
}

export function skuKg(material: string): number {
  return skuSize(material) === '1kg' ? 1 : 0.5;
}

export function skuFlavor(material: string): string {
  return material.slice(-1);
}

export function skuLabel(material: string): string {
  return `${skuSize(material) === '1kg' ? '1 kg' : '500 g'} ${FLAVORS[skuFlavor(material)] ?? '?'} (${material})`;
}

const AREA_MAP: Record<string, Area> = {
  N: 'N', NO: 'N', NORTH: 'N', NORD: 'N', SEVER: 'N',
  S: 'S', SO: 'S', SOUTH: 'S', SUD: 'S', 'SÜD': 'S', JIH: 'S',
  W: 'W', WE: 'W', WEST: 'W', ZAPAD: 'W', 'ZÁPAD': 'W',
};

export function normArea(raw: unknown): Area | null {
  return AREA_MAP[String(raw ?? '').trim().toUpperCase()] ?? null;
}

export const AREA_CS: Record<Area, string> = { N: 'Sever', S: 'Jih', W: 'Západ' };

export function toGameDay(round: number, day: number, roundLength: number): number {
  return (round - 1) * roundLength + day;
}

export function fromGameDay(gameDay: number, roundLength: number): { round: number; day: number } {
  const round = Math.floor((gameDay - 1) / roundLength) + 1;
  return { round, day: gameDay - (round - 1) * roundLength };
}

/** "03/04" → { round: 3, day: 4 }; anything else → null (e.g. "Unscheduled"). */
export function parseRoundDay(raw: unknown): { round: number; day: number } | null {
  const m = String(raw ?? '').trim().match(/^(\d{1,2})\s*\/\s*(\d{1,2})$/);
  if (!m) return null;
  return { round: Number(m[1]), day: Number(m[2]) };
}

export function parseIntLoose(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? Math.trunc(raw) : null;
  const m = String(raw ?? '').trim().match(/^-?\d+/);
  return m ? Number(m[0]) : null;
}

/** 5-day market window end day: ceil(day/5)*5 */
export function windowEnd(day: number, size = 5): number {
  return Math.ceil(day / size) * size;
}
