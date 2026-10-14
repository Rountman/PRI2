import type { GameConfig, RatingRow } from '@copilot/config';
import type { Dataset, FinanceSnapshot } from '../types.ts';

/** DebtLoading = Cash + AR − Loan − AP (loan and AP passed as magnitudes or negatives). */
export function debtLoading(x: { cash: number; receivables: number; loan: number; payables: number }): number {
  return x.cash + x.receivables - Math.abs(x.loan) - Math.abs(x.payables);
}

/** Last row whose threshold ≥ DebtLoading (table sorted descending). −8.4M → BBB. */
export function ratingFor(dl: number, table: RatingRow[]): RatingRow & { index: number } {
  let idx = 0;
  for (let i = 0; i < table.length; i++) if (dl <= table[i].threshold) idx = i;
  if (dl > table[0].threshold) idx = 0;
  return { ...table[idx], index: idx };
}

export function ratingByName(name: string, table: RatingRow[]): RatingRow {
  return table.find((r) => r.rating === name) ?? table[0];
}

export const discountRate = (premiumPct: number, cfg: GameConfig) => cfg.riskFreeRate + premiumPct / 100;

/** CompanyValue = (((Profit − Setup)/RoundsPlayed) × 12 + Setup) / (0.07 + risk). Setup is negative (cost). */
export function companyValue(profit: number, setup: number, roundsPlayed: number, premiumPct: number, cfg: GameConfig): number {
  const s = -Math.abs(setup);
  return (((profit - s) / roundsPlayed) * 12 + s) / discountRate(premiumPct, cfg);
}

/** € to the next rating step up / down. */
export function ratingDistance(dl: number, table: RatingRow[]) {
  const cur = ratingFor(dl, table);
  // row i holds while th[i+1] < dl ≤ th[i]; moving up means exceeding th[i]
  const up = cur.index > 0 ? table[cur.index].threshold + 0.01 - dl : null;
  const nextDown = cur.index < table.length - 1 ? table[cur.index + 1].threshold : null;
  const down = nextDown !== null ? dl - nextDown : null; // how much can drop before the next worse rating
  return { current: cur, toUp: up !== null ? Math.max(0, up) : null, toDown: down };
}

export function latestFinance(ds: Dataset): FinanceSnapshot | null {
  return [...ds.finance].sort((a, b) => a.gameDay - b.gameDay).at(-1) ?? null;
}

/** Discount rate used to translate profit into valuation: from finance snapshot, else config default rating. */
export function currentDiscount(ds: Dataset, cfg: GameConfig): { rate: number; rating: string; source: 'finance' | 'config' } {
  const f = latestFinance(ds);
  if (f) {
    const r = ratingFor(debtLoading(f), cfg.ratingTable);
    return { rate: discountRate(r.premium, cfg), rating: r.rating, source: 'finance' };
  }
  const r = ratingByName(cfg.defaultRating, cfg.ratingTable);
  return { rate: discountRate(r.premium, cfg), rating: r.rating, source: 'config' };
}

/**
 * Valuation delta of extra cumulative profit by end of game:
 * ΔV = ΔProfit × 12 / (rounds × discount). (Profit is annualised over all rounds at the end.)
 */
export function profitToValuation(dProfit: number, cfg: GameConfig, rate: number): number {
  return (dProfit * 12) / (cfg.rounds * rate);
}

/** Fallback when no finance: implied cumulative profit from reported valuation. */
export function impliedProfit(reportedValuation: number, premiumPct: number, roundsPlayed: number, cfg: GameConfig): number {
  return (reportedValuation * discountRate(premiumPct, cfg) * roundsPlayed) / 12;
}
