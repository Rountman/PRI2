import { useEffect, useState } from 'react';
import type { GameConfig } from '@copilot/config';
import { api, type StateResponse } from '../api.ts';
import { Panel } from '../components/ui.tsx';

const LABELS: Record<string, string> = {
  roundLength: 'Délka kola (dny)',
  rounds: 'Počet kol [OVĚŘIT]',
  'initial.cash': 'Počáteční cash €',
  'initial.loan': 'Počáteční úvěr €',
  'initial.finishedGoodsPerSku': 'Počáteční sklad / SKU',
  capacityPerDay: 'Kapacita ks/den [OVĚŘIT]',
  capacityInUnits: 'Kapacita v kusech bez ohledu na gramáž [OVĚŘIT]',
  capacityCostPer1000: 'Cena +1 000 ks/den kapacity €',
  'setup.minHours': 'Setup – min h',
  'setup.varHours': 'Setup – proměnná h',
  'setup.k': 'Setup – konstanta k',
  'setup.spend': 'Investice do setupu (účet 478000) €',
  lotMin: 'Lot size min',
  lotMax: 'Lot size max',
  fixedCostPerDay: 'Fixní náklady €/den',
  depreciationPerDayPerM: 'Odpisy €/den na €1M strojů',
  interestPerDayPerM: 'Úrok €/den na €1M úvěru',
  riskFreeRate: 'Bezriziková sazba (0,07)',
  defaultRating: 'Rating bez finančních výkazů',
  'pricing.step': 'Krok ceny €',
  'pricing.lowCoverageDays': 'R6: nízké pokrytí (dny)',
  'pricing.highCoverageDays': 'R7: vysoké pokrytí (dny)',
  'pricing.clearanceCoverageDays': 'R12: doprodej nad (dny)',
  'pricing.maxAboveMarketPct': 'R6: max % nad trhem',
  'pricing.includeFixedInFloor': 'Minimum ceny včetně fixních nákladů/ks',
  coverageWindowDays: 'Okno pro průměr prodejů (dny se skladem)',
  leadTimeDaysMax: 'Lead time surovin max (dny)',
  purchaseHorizonDays: 'R4: horizont nákupu (dny)',
  rawOrderRoundingKg: 'Zaokrouhlení objednávky surovin (kg)',
  idleThresholdDays: 'R9: práh prostoje (dny)',
  maxChangeoversPerRound: 'R1: max přestaveb / kolo',
  sortimentSize: 'R2: počet SKU v sortimentu',
  marketingEurPerRegionDay: 'R10: reklama €/region/den',
  recipeAffectsDemand: 'Recept ovlivňuje poptávku [OVĚŘIT]',
  valuationChartSkipDays: 'Graf valuace – oříznout první dny',
  calibrationTolerance: 'Tolerance kalibrace valuace',
  financeMatchTolerance: 'Tolerance kontroly financí',
};

type Field = { path: string; value: unknown };

function flatten(obj: Record<string, unknown>, prefix = ''): Field[] {
  const out: Field[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && ['initial', 'setup', 'pricing', 'dataAgeSec', 'storage'].includes(p)) out.push(...flatten(v as Record<string, unknown>, p));
    else out.push({ path: p, value: v });
  }
  return out;
}

function setPath(obj: any, path: string, value: unknown) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k];
  o[keys.at(-1)!] = value;
}

export function Nastaveni({ s }: { s: StateResponse }) {
  const [cfg, setCfg] = useState<GameConfig>(s.config);
  const [json, setJson] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [howto, setHowto] = useState(JSON.stringify(s.howto, null, 2));
  const [clockDay, setClockDay] = useState(String(s.clock.gameDay ?? ''));
  const [between, setBetween] = useState(!!s.clock.betweenRounds);
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  useEffect(() => setCfg(s.config), [s.config]);

  const fields = flatten(cfg as unknown as Record<string, unknown>).filter((f) => f.path !== 'preset');
  const save = async () => {
    try {
      const next = structuredClone(cfg) as any;
      for (const [p, t] of Object.entries(json)) setPath(next, p, JSON.parse(t));
      await api.setConfig(next);
      setJson({});
      setMsg('✓ Uloženo – všechny analýzy se přepočítaly.');
    } catch (e) {
      setMsg(`Chyba: ${(e as Error).message}`);
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel title="Předvolba hry">
        <div className="flex flex-wrap items-center gap-3">
          {s.presets.map((p) => (
            <button
              key={p}
              onClick={() => void api.setPreset(p)}
              className={`rounded-lg px-4 py-2 font-semibold ${s.config.preset === p ? 'bg-accent text-slate-950' : 'border border-line'}`}
            >
              {p === 'intro' ? 'Intro (cvičná data)' : 'Extended (soutěž)'}
            </button>
          ))}
        </div>
        <p className="mt-2 text-sm text-mute">Přepnutí předvolby zahodí ruční úpravy níže. Úpravy se ukládají na server a platí pro celý tým.</p>
      </Panel>

      <Panel title="Herní čas">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">
            Přepsat herní den
            <input type="number" value={clockDay} onChange={(e) => setClockDay(e.target.value)} placeholder="z dat" className="w-24 rounded-md border border-line bg-panel2 px-2 py-1" />
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={between} onChange={(e) => setBetween(e.target.checked)} className="h-5 w-5" />
            Jsme mezi koly
          </label>
          <button className="rounded-lg border border-line px-3 py-1 hover:border-accent" onClick={() => void api.setClock({ gameDay: clockDay ? Number(clockDay) : null, betweenRounds: between })}>
            Použít
          </button>
        </div>
      </Panel>

      <Panel title="Parametry hry" className="xl:row-span-3" right={<button onClick={() => void save()} className="rounded-lg bg-accent px-4 py-1.5 font-semibold text-slate-950">Uložit</button>}>
        {msg && <div className="mb-2 text-sm text-good">{msg}</div>}
        <div className="space-y-2">
          {fields.map((f) => {
            const label = LABELS[f.path] ?? f.path;
            if (typeof f.value === 'number')
              return (
                <label key={f.path} className="flex items-center justify-between gap-3 text-sm">
                  <span>{label}</span>
                  <input
                    type="number"
                    step="any"
                    value={String(f.value)}
                    onChange={(e) => {
                      const next = structuredClone(cfg);
                      setPath(next, f.path, Number(e.target.value));
                      setCfg(next);
                    }}
                    className="num w-40 rounded-md border border-line bg-panel2 px-2 py-1 text-right"
                  />
                </label>
              );
            if (typeof f.value === 'boolean')
              return (
                <label key={f.path} className="flex items-center justify-between gap-3 text-sm">
                  <span>{label}</span>
                  <input
                    type="checkbox"
                    checked={f.value}
                    onChange={(e) => {
                      const next = structuredClone(cfg);
                      setPath(next, f.path, e.target.checked);
                      setCfg(next);
                    }}
                    className="h-5 w-5"
                  />
                </label>
              );
            if (typeof f.value === 'string')
              return (
                <label key={f.path} className="flex items-center justify-between gap-3 text-sm">
                  <span>{label}</span>
                  <input
                    value={f.value}
                    onChange={(e) => {
                      const next = structuredClone(cfg);
                      setPath(next, f.path, e.target.value);
                      setCfg(next);
                    }}
                    className="w-40 rounded-md border border-line bg-panel2 px-2 py-1"
                  />
                </label>
              );
            return (
              <details key={f.path} className="rounded-md border border-line p-2 text-sm">
                <summary className="cursor-pointer">{label} (JSON)</summary>
                <textarea
                  rows={8}
                  defaultValue={JSON.stringify(f.value, null, 2)}
                  onChange={(e) => setJson({ ...json, [f.path]: e.target.value })}
                  className="mt-2 w-full rounded-md border border-line bg-panel2 p-2 font-mono text-xs"
                />
              </details>
            );
          })}
        </div>
      </Panel>

      <Panel title="Klikací návody per T-code [OVĚŘIT]">
        <p className="mb-2 text-sm text-mute">Zástupné hodnoty: {'{mat} {dc} {price} {area} {eur} {qty} {vendor} {recipe} {kind}'}.</p>
        <textarea rows={14} value={howto} onChange={(e) => setHowto(e.target.value)} className="w-full rounded-md border border-line bg-panel2 p-2 font-mono text-xs" />
        <button
          onClick={() =>
            void api
              .setHowto(JSON.parse(howto))
              .then(() => setMsg('✓ Návody uloženy'))
              .catch((e) => setMsg(`Chyba: ${e.message}`))
          }
          className="mt-2 rounded-lg border border-line px-3 py-1 hover:border-accent"
        >
          Uložit návody
        </button>
      </Panel>

      <Panel title="PIN a data">
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <input value={pin} onChange={(e) => setPin(e.target.value)} placeholder="nový PIN (prázdné = vypnout)" className="rounded-md border border-line bg-panel2 px-2 py-1" />
            <button className="rounded-lg border border-line px-3 py-1 hover:border-accent" onClick={() => void api.setPin(pin).then(() => setMsg(pin ? '✓ PIN nastaven' : '✓ PIN vypnut'))}>
              Nastavit PIN
            </button>
            <span className="text-mute">{s.pinEnabled ? 'PIN je zapnutý' : 'PIN je vypnutý'}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="napiš SMAZAT" className="rounded-md border border-line bg-panel2 px-2 py-1" />
            <button
              disabled={confirm !== 'SMAZAT'}
              className="rounded-lg border border-crit/60 px-3 py-1 text-red-300 disabled:opacity-40"
              onClick={() => void api.reset().then(() => (setConfirm(''), setMsg('✓ Data smazána')))}
            >
              Smazat herní data
            </button>
            <span className="text-mute">(nastavení a mapovací profily zůstanou)</span>
          </div>
        </div>
      </Panel>
    </div>
  );
}
