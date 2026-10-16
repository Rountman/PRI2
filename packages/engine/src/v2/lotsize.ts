import type { GameConfig } from '@copilot/config';

export const roundUp = (x: number, step: number) => Math.ceil(x / step - 1e-9) * step || 0;
export const roundDown = (x: number, step: number) => Math.floor(x / step + 1e-9) * step || 0;

type LotCfg = Pick<GameConfig, 'lotMin' | 'lotMax' | 'lotRounding'>;

/** Pack mode: production goes in packs of `lotMin` (16k) or `lotMax` (48k) only – set lotRounding = lotMin. */
const packMode = (cfg: LotCfg) => cfg.lotRounding === cfg.lotMin && cfg.lotMax % cfg.lotMin === 0;

/** n × lotMin as lots: 3 × 16k → one 48k, otherwise separate 16k lots. */
function packs(n: number, cfg: LotCfg): number[] {
  const per = cfg.lotMax / cfg.lotMin;
  return n >= per ? [cfg.lotMax, ...packs(n - per, cfg)] : Array(n).fill(cfg.lotMin);
}

/**
 * How SAP MRP cuts a requirement into planned orders (Participants' Guide):
 * full max lots first, the remainder rounded up to `lotRounding` but at least `lotMin`.
 * 1 → [16k] · 15 500 → [16k] · 16 001 → [17k] · 40 000 → [40k] · 47 500 → [48k] · 48 001 → [48k, 16k]
 * Pack mode (lotRounding = lotMin): only 16k / 48k lots – 20 000 → [16k, 16k], 40 000 → [48k].
 */
export function cutLots(qty: number, cfg: LotCfg): number[] {
  if (!(qty > 0)) return [];
  if (packMode(cfg)) return packs(Math.ceil(qty / cfg.lotMin - 1e-9), cfg);
  const out: number[] = [];
  let left = qty;
  while (left > cfg.lotMax) {
    out.push(cfg.lotMax);
    left -= cfg.lotMax;
  }
  out.push(Math.min(cfg.lotMax, Math.max(cfg.lotMin, roundUp(left, cfg.lotRounding))));
  return out;
}

/** Largest lots that fit into `qty` (for cuts by capacity / storage). */
export function fitLots(qty: number, cfg: LotCfg): number[] {
  if (!(qty >= cfg.lotMin)) return [];
  if (packMode(cfg)) return packs(Math.floor(qty / cfg.lotMin + 1e-9), cfg);
  const out: number[] = [];
  let left = qty;
  while (left >= cfg.lotMax) {
    out.push(cfg.lotMax);
    left -= cfg.lotMax;
  }
  const rest = roundDown(left, cfg.lotRounding);
  if (rest >= cfg.lotMin) out.push(rest);
  return out;
}
