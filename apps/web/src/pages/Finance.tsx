import { useMemo, useState } from 'react';
import type { FinanceSnapshot } from '@copilot/engine';
import { companyValue, debtLoading, discountRate, ratingDistance, ratingFor } from '@copilot/engine/finance';
import { fmtEUR, fmtNum, fmtPct, fmtShort } from '@copilot/engine/format';
import { whatIf } from '@copilot/engine/whatif';
import { parseNumber } from '@copilot/engine/numbers';
import { api, type StateResponse } from '../api.ts';
import { Badge, cx, Info, Panel } from '../components/ui.tsx';

const FIELDS: { key: keyof FinanceSnapshot; label: string; hint: string }[] = [
  { key: 'cash', label: 'Cash', hint: 'účet 113300 Bank Cash' },
  { key: 'receivables', label: 'Pohledávky (AR)', hint: 'účet 140000 Receivables' },
  { key: 'payables', label: 'Závazky (AP)', hint: 'Liabilities / Payables – stačí vložit i se znaménkem' },
  { key: 'loan', label: 'Úvěr', hint: 'Loan – zůstatek' },
  { key: 'netIncome', label: 'Net Income (profit)', hint: 'Income Statement – Net Income (kumulativně)' },
  { key: 'setupSpend', label: 'Setup investice', hint: 'účet 478000 (default 0)' },
  { key: 'roundsPlayed', label: 'Odehraná kola', hint: 'předvyplněno z dat' },
  { key: 'gameDay', label: 'Herní den', hint: 'ke kterému dni výkaz patří' },
];

export function Finance({ s }: { s: StateResponse }) {
  const cfg = s.config;
  const last = s.finance.at(-1);
  const clock = s.snapshot.analysis.clock;
  const defaults: Record<string, string> = {
    cash: String(last?.cash ?? ''),
    receivables: String(last?.receivables ?? ''),
    payables: String(last?.payables ?? ''),
    loan: String(last?.loan ?? cfg.initial.loan),
    netIncome: String(last?.netIncome ?? ''),
    setupSpend: String(last?.setupSpend ?? 0),
    roundsPlayed: String(Math.max(1, Math.floor(clock.gameDay / cfg.roundLength)) || ''),
    gameDay: String(clock.gameDay || ''),
  };
  const [form, setForm] = useState(defaults);
  const [msg, setMsg] = useState('');
  const n = (k: string) => parseNumber(form[k]) ?? 0;
  const f: FinanceSnapshot = {
    gameDay: n('gameDay'),
    cash: n('cash'),
    receivables: n('receivables'),
    payables: Math.abs(n('payables')),
    loan: Math.abs(n('loan')),
    netIncome: n('netIncome'),
    setupSpend: Math.abs(n('setupSpend')),
    roundsPlayed: n('roundsPlayed'),
  };
  const complete = f.roundsPlayed > 0 && form.cash.trim() !== '' && form.netIncome.trim() !== '';
  const dl = debtLoading(f);
  const r = ratingFor(dl, cfg.ratingTable);
  const dist = ratingDistance(dl, cfg.ratingTable);
  const computed = complete ? companyValue(f.netIncome, f.setupSpend, f.roundsPlayed, r.premium, cfg) : null;
  const reported = [...s.snapshot.analysis.valuation.points].filter((p) => p.gameDay <= f.gameDay).at(-1)?.valuation ?? s.snapshot.analysis.valuation.latest?.valuation ?? null;
  const dev = computed !== null && reported ? computed / reported - 1 : null;
  const ok = dev !== null && Math.abs(dev) < cfg.financeMatchTolerance;

  // ---------- what-if ----------
  const [repay, setRepay] = useState(0);
  const [cap, setCap] = useState(0);
  const [setup, setSetup] = useState(0);
  const [util, setUtil] = useState(cfg.extraCapacityUtilization);
  const econ = Object.values(s.snapshot.analysis.econLatest);
  const q = econ.reduce((x, e) => x + e.qty, 0);
  const margin = q ? econ.reduce((x, e) => x + e.marginPerUnit * e.qty, 0) / q : 0;
  const played = s.snapshot.analysis.production.filter((p) => p.orders > 0);
  const changeovers = played.length ? played.reduce((x, p) => x + p.setups, 0) / played.length : 0;
  const base = complete ? f : last;
  const w = useMemo(
    () => (base ? whatIf(base, cfg, { repayLoan: repay, capacityEUR: cap, setupEUR: setup, marginPerUnit: margin, changeoversPerRound: changeovers, extraCapacityUtilization: util }, s.snapshot.analysis.calibration.factor) : null),
    [base, cfg, repay, cap, setup, margin, changeovers, util, s.snapshot.analysis.calibration.factor],
  );

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel
        title="Finanční výkazy – ruční opis"
        right={
          <Info title="Proč ručně">
            <p>Fiori Balance Sheet / Income Statement nemá export do xlsx. Opiš (nebo vlož) čísla – pole přijmou i „3,376,340.64 EUR“ nebo „-326,988.00“.</p>
            <p>Stačí jednou za kolo. Bez výkazů appka funguje, rating se bere z Nastavení ({cfg.defaultRating}).</p>
          </Info>
        }
      >
        <div className="grid gap-2 sm:grid-cols-2">
          {FIELDS.map((x) => (
            <label key={x.key} className="text-sm">
              <div className="flex justify-between">
                <span className="font-semibold">{x.label}</span>
                <span className="num text-mute">{form[x.key] ? fmtNum(parseNumber(form[x.key]) ?? NaN, 2) : ''}</span>
              </div>
              <input
                value={form[x.key]}
                onChange={(e) => setForm({ ...form, [x.key]: e.target.value })}
                className="num w-full rounded-md border border-line bg-panel2 px-2 py-1.5 text-lg"
                placeholder={x.hint}
              />
            </label>
          ))}
        </div>
        <button
          disabled={!complete}
          onClick={() => void api.saveFinance({ ...f }).then(() => setMsg('✓ Uloženo jako snapshot'))}
          className="mt-3 rounded-lg bg-accent px-4 py-2 font-semibold text-slate-950 disabled:opacity-40"
        >
          Uložit snapshot
        </button>
        {msg && <span className="ml-3 text-good">{msg}</span>}
      </Panel>

      <Panel title="Kontrola vůči reportované valuaci">
        {complete ? (
          <div className="space-y-3">
            <div className={cx('rounded-xl border p-4', ok ? 'border-good/50 bg-good/10' : 'border-crit/50 bg-crit/10')}>
              <div className="text-2xl font-bold">{ok ? '✅ Sedí' : '❌ Nesedí – zkontroluj opsaná čísla'}</div>
              <div className="num mt-1">
                spočteno <b>{fmtEUR(computed, 2)}</b> · reportováno <b>{fmtEUR(reported, 2)}</b> · odchylka {dev !== null ? fmtPct(dev, 2) : '–'}
              </div>
            </div>
            <table className="num w-full text-sm">
              <tbody>
                <tr className="border-b border-line/60">
                  <td className="py-1 text-mute">DebtLoading = Cash + AR − Úvěr − AP</td>
                  <td className="text-right font-semibold">{fmtEUR(dl)}</td>
                </tr>
                <tr className="border-b border-line/60">
                  <td className="py-1 text-mute">Rating / přirážka</td>
                  <td className="text-right">
                    <Badge tone="accent">{r.rating}</Badge> {fmtNum(r.premium, 2)} %
                  </td>
                </tr>
                <tr className="border-b border-line/60">
                  <td className="py-1 text-mute">Diskont (7 % + přirážka)</td>
                  <td className="text-right">{fmtPct(discountRate(r.premium, cfg), 2)}</td>
                </tr>
                <tr className="border-b border-line/60">
                  <td className="py-1 text-mute">Do lepšího ratingu chybí</td>
                  <td className="text-right text-good">{dist.toUp !== null ? fmtEUR(dist.toUp) : 'nejlepší rating'}</td>
                </tr>
                <tr>
                  <td className="py-1 text-mute">Rezerva do horšího ratingu</td>
                  <td className="text-right text-high">{dist.toDown !== null ? fmtEUR(dist.toDown) : '–'}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-mute">Vyplň aspoň Cash, Net Income a počet kol.</div>
        )}
      </Panel>

      <Panel title="What-if – dopad na valuaci ke konci hry" className="xl:col-span-2">
        {base && w ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-4">
              {[
                { label: 'Splátka úvěru', v: repay, set: setRepay, max: Math.max(0, base.loan), step: 100_000 },
                { label: '+ Kapacita (stroje)', v: cap, set: setCap, max: 5_000_000, step: 1_000_000 },
                { label: 'Setup reduction (478000)', v: setup, set: setSetup, max: 1_250_000, step: 50_000 },
              ].map((x) => (
                <label key={x.label} className="block">
                  <div className="flex justify-between">
                    <span>{x.label}</span>
                    <b className="num">{fmtEUR(x.v)}</b>
                  </div>
                  <input type="range" min={0} max={x.max} step={x.step} value={x.v} onChange={(e) => x.set(Number(e.target.value))} className="w-full accent-sky-400" />
                </label>
              ))}
              <label className="block">
                <div className="flex justify-between">
                  <span>Prodá se z extra kapacity</span>
                  <b className="num">{fmtPct(util)}</b>
                </div>
                <input type="range" min={0} max={1} step={0.05} value={util} onChange={(e) => setUtil(Number(e.target.value))} className="w-full accent-sky-400" />
              </label>
              <p className="text-sm text-mute">
                Marže/ks {fmtEUR(margin, 2)} · přestaveb/kolo {fmtNum(changeovers, 1)} · zbývá {fmtNum(w.remainingDays)} dní · kalibrační faktor {fmtNum(s.snapshot.analysis.calibration.factor, 3)}
              </p>
            </div>
            <div className="space-y-3">
              <div className="rounded-xl bg-panel2 p-4">
                <div className="text-mute">Δ valuace</div>
                <div className={cx('num text-4xl font-black', w.deltaValuation >= 0 ? 'text-good' : 'text-crit')}>
                  {w.deltaValuation >= 0 ? '+' : ''}
                  {fmtShort(w.deltaValuation)} €
                </div>
                <div className="num mt-1 text-sm">
                  rating {w.before.rating} → <b className={w.ratingChanged ? 'text-high' : undefined}>{w.after.rating}</b> · DebtLoading {fmtShort(w.before.debtLoading)} → {fmtShort(w.after.debtLoading)}
                </div>
              </div>
              <table className="num w-full text-sm">
                <tbody>
                  {w.effects.map((e) => (
                    <tr key={e.label} className="border-b border-line/60">
                      <td className="py-1 text-mute">{e.label}</td>
                      <td className={cx('text-right', e.profit >= 0 ? 'text-good' : 'text-crit')}>{fmtEUR(e.profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {w.warnings.map((x) => (
                <div key={x} className="text-high">
                  ⚠ {x}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-mute">What-if potřebuje finanční výkaz (vyplň formulář výše).</div>
        )}
      </Panel>
    </div>
  );
}
