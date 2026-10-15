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
  { key: 'payables', label: 'Závazky (AP)', hint: 'Liabilities / Payables – i se znaménkem' },
  { key: 'loan', label: 'Úvěr', hint: 'Loan – zůstatek' },
  { key: 'netIncome', label: 'Net Income (profit)', hint: 'Income Statement – Net Income (kumulativně)' },
  { key: 'setupSpend', label: 'Setup investice', hint: 'účet 478000 (default 0)' },
  { key: 'roundsPlayed', label: 'Odehraná kola', hint: 'předvyplněno z dat' },
  { key: 'gameDay', label: 'Herní den', hint: 'ke kterému dni výkaz patří' },
];

/** Manual finance (Fiori Balance Sheet / Income Statement has no xlsx export). */
export function FinanceForm({ s }: { s: StateResponse }) {
  const cfg = s.config;
  const last = s.finance.at(-1);
  const clock = s.snapshot.clock;
  const [form, setForm] = useState<Record<string, string>>({
    cash: String(last?.cash ?? ''),
    receivables: String(last?.receivables ?? ''),
    payables: String(last?.payables ?? ''),
    loan: String(last?.loan ?? cfg.initial.loan),
    netIncome: String(last?.netIncome ?? ''),
    setupSpend: String(last?.setupSpend ?? 0),
    roundsPlayed: String(Math.max(1, Math.floor(clock.gameDay / cfg.roundLength)) || ''),
    gameDay: String(clock.gameDay || ''),
  });
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
  const reported = s.snapshot.analysis.valuation.points.filter((p) => p.gameDay <= f.gameDay).at(-1)?.valuation ?? s.snapshot.analysis.valuation.latest?.valuation ?? null;
  const dev = computed !== null && reported ? computed / reported - 1 : null;
  const ok = dev !== null && Math.abs(dev) < cfg.financeMatchTolerance;

  return (
    <Panel
      title="Ruční finance"
      right={
        <Info title="Proč ručně">
          <p>Fiori Balance Sheet / Income Statement nemá export do xlsx. Opiš čísla – pole přijmou i „3,376,340.64 EUR“ nebo „-326,988.00“.</p>
          <p>Stačí jednou za kolo. Bez financí se rating bere z presetu ({cfg.defaultRating}).</p>
        </Info>
      }
    >
      <div className="grid gap-2 sm:grid-cols-2">
        {FIELDS.map((x) => (
          <label key={x.key} className="text-sm">
            <span className="font-semibold">{x.label}</span>
            <input value={form[x.key]} onChange={(e) => setForm({ ...form, [x.key]: e.target.value })} className="num w-full rounded-md border border-line bg-panel2 px-2 py-1.5 text-lg" placeholder={x.hint} />
          </label>
        ))}
      </div>
      <button disabled={!complete} onClick={() => void api.saveFinance({ ...f }).then(() => setMsg('✓ Uloženo'))} className="mt-3 rounded-lg bg-accent px-4 py-2 font-semibold text-slate-950 disabled:opacity-40">
        Uložit
      </button>
      {msg && <span className="ml-3 text-good">{msg}</span>}
      {complete && (
        <div className="mt-3 space-y-1 text-sm">
          <div className={cx('rounded-lg border p-2', ok ? 'border-good/50 bg-good/10' : 'border-line')}>
            {reported ? (ok ? '✅ Sedí s reportovanou valuací' : '❌ Nesedí s reportovanou valuací – zkontroluj čísla') : 'Bez Company-Valuation nelze ověřit'} · spočteno <b className="num">{fmtEUR(computed)}</b>
            {reported && <> · reportováno <b className="num">{fmtEUR(reported)}</b> ({dev !== null ? fmtPct(dev, 2) : '–'})</>}
          </div>
          <div className="num">
            DebtLoading {fmtEUR(dl)} → <Badge tone="accent">{r.rating}</Badge> diskont {fmtPct(discountRate(r.premium, cfg), 2)} · do lepšího {dist.toUp !== null ? fmtEUR(dist.toUp) : '–'} · rezerva {dist.toDown !== null ? fmtEUR(dist.toDown) : '–'}
          </div>
        </div>
      )}
    </Panel>
  );
}

export function Investice({ s }: { s: StateResponse }) {
  const cfg = s.config;
  const inv = s.snapshot.invest;
  const last = s.finance.at(-1);
  const [repay, setRepay] = useState(0);
  const [cap, setCap] = useState(0);
  const [setup, setSetup] = useState(0);
  const [util, setUtil] = useState(cfg.extraCapacityUtilization);
  const factor = s.snapshot.analysis.calibration.factor;
  const w = useMemo(
    () => (last ? whatIf(last, cfg, { repayLoan: repay, capacityEUR: cap, setupEUR: setup, marginPerUnit: inv.avgMargin, changeoversPerRound: inv.changeoversPerRound, extraCapacityUtilization: util }, factor) : null),
    [last, cfg, repay, cap, setup, inv.avgMargin, inv.changeoversPerRound, util, factor],
  );
  const loan = inv.loan;
  return (
    <div className="space-y-4">
      <Panel title="Setup reduction – marginální tabulka (ZFB50)">
        <table className="num w-full text-sm">
          <thead className="text-left text-mute">
            <tr>
              <th>478000</th>
              <th className="text-right">setup</th>
              <th className="text-right">výdaj</th>
              <th className="text-right">zisk</th>
              <th className="text-right">návratnost</th>
            </tr>
          </thead>
          <tbody>
            {inv.setup.map((x) => (
              <tr key={x.to} className={cx('border-t border-line/60', x.recommended && 'text-emerald-300')}>
                <td className="py-1">
                  {fmtShort(x.from)} → {fmtShort(x.to)}
                </td>
                <td className="text-right">
                  {fmtNum(x.hoursFrom, 1)} → {fmtNum(x.hoursTo, 1)} h
                </td>
                <td className="text-right">{fmtEUR(x.spend)}</td>
                <td className="text-right">{fmtEUR(x.gain)}</td>
                <td className="text-right">
                  {fmtNum(x.ratio, 1)}× {x.recommended ? '✓' : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-sm text-mute">
          Zisk = ušetřené hodiny × {fmtNum(inv.changeoversPerRound, 1)} přestaveb/kolo × {fmtNum(cfg.capacityPerDay / 24)} ks/h × marže {fmtEUR(inv.avgMargin, 2)} × zbývající kola. Doporučeno, když návratnost &gt; {cfg.investPayback}×. Výdaj se ve valuaci odečte jednou.
        </p>
      </Panel>

      <Panel title="Splátka úvěru">
        <p>
          {loan.generic
            ? `Bez financí: každý splacený 1M ušetří ${fmtEUR(loan.perMillionPerDay)}/den. Opiš Cash a Úvěr v záložce Další importy.`
            : `Splatit ${fmtEUR(loan.repay)} (cash ${fmtEUR(loan.cash)} − rezerva ${fmtEUR(loan.reserve)}) → úspora ${fmtEUR(loan.interestSaved)} do konce hry.`}
        </p>
        <p className="mt-1 text-sm text-mute">Rating se nezmění (DebtLoading = Cash − Úvěr …), klesne úrok. Rezerva = fixní náklady {cfg.reserve.fixedDays} dní + suroviny na příští cyklus + {fmtEUR(cfg.reserve.buffer)}.</p>
      </Panel>

      <Panel title="Kapacita +1 000 ks/den za €1M">
        <p>
          {inv.capacity.relevant
            ? `Poptávka ${fmtNum(inv.capacity.demandPerDay)} > kapacita ${fmtNum(inv.capacity.capacityPerDay)}. Přínos ${fmtEUR(inv.capacity.gain)} − odpisy ${fmtEUR(inv.capacity.depreciation)} = ${fmtEUR(inv.capacity.net)}.`
            : `Zatím ne – poptávka ${fmtNum(inv.capacity.demandPerDay)} ks/den nepřevyšuje trvale kapacitu ${fmtNum(inv.capacity.capacityPerDay)}.`}
        </p>
        {inv.capacity.ratingBefore && (
          <p className="text-sm text-mute">
            Rating {inv.capacity.ratingBefore} → {inv.capacity.ratingAfter}
          </p>
        )}
      </Panel>

      {w && last && (
        <Panel title="What-if – dopad na valuaci ke konci hry">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-4">
              {[
                { label: 'Splátka úvěru', v: repay, set: setRepay, max: Math.max(0, last.loan), step: 100_000 },
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
            </div>
            <div className="space-y-3">
              <div className="rounded-xl bg-panel2 p-4">
                <div className="text-mute">Δ valuace</div>
                <div className={cx('num text-4xl font-black', w.deltaValuation >= 0 ? 'text-good' : 'text-crit')}>
                  {w.deltaValuation >= 0 ? '+' : ''}
                  {fmtShort(w.deltaValuation)} €
                </div>
                <div className="num mt-1 text-sm">
                  rating {w.before.rating} → <b className={w.ratingChanged ? 'text-high' : undefined}>{w.after.rating}</b>
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
        </Panel>
      )}
    </div>
  );
}
