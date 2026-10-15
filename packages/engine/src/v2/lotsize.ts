import type { GameConfig } from '@copilot/config';

export const roundUp = (x: number, step: number) => Math.ceil(x / step - 1e-9) * step || 0;
export const roundDown = (x: number, step: number) => Math.floor(x / step + 1e-9) * step || 0;

/**
 * How SAP MRP cuts a requirement into planned orders (Participants' Guide):
 * full max lots first, the remainder rounded up to `lotRounding` but at least `lotMin`.
 * 1 → [16k] · 15 500 → [16k] · 16 001 → [17k] · 40 000 → [40k] · 47 500 → [48k] · 48 001 → [48k, 16k]
 */
export function cutLots(qty: number, cfg: Pick<GameConfig, 'lotMin' | 'lotMax' | 'lotRounding'>): number[] {
  if (!(qty > 0)) return [];
  const out: number[] = [];
  let left = qty;
  while (left > cfg.lotMax) {
    out.push(cfg.lotMax);
    left -= cfg.lotMax;
  }
  out.push(Math.min(cfg.lotMax, Math.max(cfg.lotMin, roundUp(left, cfg.lotRounding))));
  return out;
}
