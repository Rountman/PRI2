import { useEffect, useState } from 'react';
import type { GameConfig } from '@copilot/config';
import { SKUS, skuLabel, skuSize } from '@copilot/engine/normalize';
import { api, type StateResponse } from '../api.ts';
import { cx, Panel } from '../components/ui.tsx';

const LABELS: Record<string, string> = {
  teamCode: 'Kód týmu (prefix materiálu, např. GG → GG-F01)',
  roundLength: 'Délka kola (dny)',
  rounds: 'Počet kol',
  'initial.cash': 'Počáteční cash €',
  'initial.loan': 'Počáteční úvěr €',
  'initial.machines': 'Stroje €',
  'initial.finishedGoodsPerSku': 'Počáteční sklad / SKU',
  capacityPerDay: 'Kapacita ks/den (11000 / 1000)',
  capacityInUnits: 'Kapacita v kusech bez ohledu na gramáž',
  capacityCostPer1000: 'Cena +1 000 ks/den kapacity €',
  'setup.minHours': 'Setup – min h',
  'setup.varHours': 'Setup – proměnná h',
  'setup.k': 'Setup – konstanta k',
  'setup.spend': 'Investováno do setupu (478000) €',
  setupProposal: 'Návrh setup investice před hrou € [ODHAD]',
  lotMin: 'Lot size min',
  lotMax: 'Lot size max',
  lotRounding: 'Lot size zaokrouhlení',
  'fixedCosts.periodDays': 'Fixní náklady – perioda (dny)',
  'fixedCosts.labor': 'Labor / perioda €',
  'fixedCosts.overhead': 'Overhead / perioda €',
  'fixedCosts.sga': 'SG&A / perioda €',
  'fixedCosts.depBuilding': 'Odpisy budova / perioda €',
  'fixedCosts.depMachines': 'Odpisy stroje / perioda €',
  depreciationPerDayPerM: 'Odpisy €/den na €1M strojů',
  interestPerDayPerM: 'Úrok €/den na €1M úvěru',
  riskFreeRate: 'Bezriziková sazba (0,07)',
  defaultRating: 'Rating bez financí',
  extraCapacityUtilization: 'What-if: využití extra kapacity (0–1)',
  'md61.firstCycleQty.500g': 'MD61 1. cyklus / SKU 500 g',
  'md61.firstCycleQty.1kg': 'MD61 1. cyklus / SKU 1 kg',
  'md61.nextMrpDays': 'MD61 dny do dalšího MRP',
  'md61.leadTimeMax': 'Lead time surovin max (dny)',
  'md61.stockoutBoost': 'Boost poptávky po výprodeji [ODHAD]',
  'md61.stockoutBoostDays': 'Boost od kolika dnů výprodeje',
  'md61.demandWindow': 'Okno průměru poptávky (dny)',
  'md61.mode': 'Režim prognózy: celková / doplnění [OVĚŘIT]',
  'md61.changeoversPerRound': 'Přestaveb / kolo (bez ProductionReport)',
  'pricing.step': 'Krok ceny €',
  'pricing.lowCoverDays': 'Zvednout pod (dny pokrytí)',
  'pricing.highCoverDays': 'Snížit nad (dny pokrytí)',
  'pricing.anchorFloorPct': 'Ne pod kotvu trhu − %',
  'pricing.warnFixedPerUnit': 'Varovat pod unit cost + fixní/ks',
  'reserve.fixedDays': 'Rezerva: fixní náklady (dny)',
  'reserve.buffer': 'Rezerva: buffer €',
  investPayback: 'Investice: min. návratnost ×',
  maxCards: 'Max karet',
  maxCritical: 'Max kritických karet',
  marketingEurPerRegionDay: 'Reklama €/region/den',
  'dataAgeSec.green': 'Čip 🟢 do (s)',
  'dataAgeSec.orange': 'Čip 🟠 do (s)',
};
const GROUPS = ['initial', 'setup', 'fixedCosts', 'md61', 'md61.firstCycleQty', 'pricing', 'reserve', 'dataAgeSec', 'storage', 'storageExtraPerDay'];
const SKIP = ['preset', 'assortment', 'startPrices'];

type Field = { path: string; value: unknown };

function flatten(obj: Record<string, unknown>, prefix = ''): Field[] {
  const out: Field[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (SKIP.includes(p)) continue;
    if (v && typeof v === 'object' && !Array.isArray(v) && GROUPS.includes(p)) out.push(...flatten(v as Record<string, unknown>, p));
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

const startPriceOf = (cfg: GameConfig, sku: string, dc: string) =>
  cfg.startPrices.overrides?.[`${sku}:${dc}`] ?? Math.round((cfg.startPrices[skuSize(sku)] + (cfg.startPrices.dcAdjust[dc] ?? 0)) * 100) / 100;

export function Nastaveni({ s }: { s: StateResponse }) {
  const [cfg, setCfg] = useState<GameConfig>(s.config);
  const [json, setJson] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [clockDay, setClockDay] = useState(String(s.clock.gameDay ?? ''));
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  useEffect(() => setCfg(s.config), [s.config]);
  const edit = (f: (next: GameConfig) => void) => {
    const next = structuredClone(cfg);
    f(next);
    setCfg(next);
  };

  const save = async () => {
    try {
      const next = structuredClone(cfg) as any;
      for (const [p, t] of Object.entries(json)) setPath(next, p, JSON.parse(t));
      await api.setConfig(next);
      setJson({});
      setMsg('✓ Uloženo – vše se přepočítalo.');
    } catch (e) {
      setMsg(`Chyba: ${(e as Error).message}`);
    }
  };
  const SaveBtn = () => (
    <button onClick={() => void save()} className="rounded-lg bg-accent px-4 py-1.5 font-semibold text-slate-950">
      Uložit
    </button>
  );

  return (
    <div className="space-y-4">
      {msg && <div className="text-good">{msg}</div>}
      <Panel title="Předvolba hry">
        <div className="flex flex-wrap items-center gap-3">
          {s.presets.map((p) => (
            <button key={p} onClick={() => void api.setPreset(p)} className={cx('rounded-lg px-4 py-2 font-semibold', s.config.preset === p ? 'bg-accent text-slate-950' : 'border border-line')}>
              {p === 'intro' ? 'Intro (cvičná data)' : 'Extended (soutěž)'}
            </button>
          ))}
        </div>
        <p className="mt-2 text-sm text-mute">Přepnutí předvolby zahodí ruční úpravy. Úpravy platí pro celý tým.</p>
      </Panel>

      <Panel title="Sortiment" right={<SaveBtn />}>
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
          {SKUS.map((sku) => (
            <label key={sku} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-5 w-5"
                checked={cfg.assortment.includes(sku)}
                onChange={(e) => edit((n) => (n.assortment = e.target.checked ? SKUS.filter((x) => n.assortment.includes(x) || x === sku) : n.assortment.filter((x) => x !== sku)))}
              />
              {skuLabel(sku)}
            </label>
          ))}
        </div>
      </Panel>

      <Panel title="Startovní ceny (VK32 před hrou)" right={<SaveBtn />}>
        <div className="mb-3 flex flex-wrap gap-3 text-sm">
          {(['500g', '1kg'] as const).map((k) => (
            <label key={k} className="flex items-center gap-1">
              {k}
              <input type="number" step="0.05" value={cfg.startPrices[k]} onChange={(e) => edit((n) => (n.startPrices[k] = Number(e.target.value)))} className="num w-20 rounded-md border border-line bg-panel2 px-2 py-1 text-right" />
            </label>
          ))}
          {cfg.channels.map((c) => (
            <label key={c.dc} className="flex items-center gap-1">
              DC{c.dc} ±
              <input type="number" step="0.05" value={cfg.startPrices.dcAdjust[c.dc] ?? 0} onChange={(e) => edit((n) => (n.startPrices.dcAdjust[c.dc] = Number(e.target.value)))} className="num w-20 rounded-md border border-line bg-panel2 px-2 py-1 text-right" />
            </label>
          ))}
        </div>
        <table className="num text-sm">
          <thead className="text-mute">
            <tr>
              <th className="text-left">SKU</th>
              {cfg.channels.map((c) => (
                <th key={c.dc}>DC{c.dc}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cfg.assortment.map((sku) => (
              <tr key={sku}>
                <td className="pr-3 font-bold">{sku}</td>
                {cfg.channels.map((c) => (
                  <td key={c.dc} className="px-1">
                    {c.sizes.includes(skuSize(sku)) ? (
                      <input
                        type="number"
                        step="0.05"
                        value={startPriceOf(cfg, sku, c.dc)}
                        onChange={(e) => edit((n) => (n.startPrices.overrides = { ...n.startPrices.overrides, [`${sku}:${c.dc}`]: Number(e.target.value) }))}
                        className={cx('w-20 rounded-md border bg-panel2 px-2 py-1 text-right', cfg.startPrices.overrides?.[`${sku}:${c.dc}`] ? 'border-accent' : 'border-line')}
                      />
                    ) : (
                      <span className="text-mute">–</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={() => edit((n) => (n.startPrices.overrides = {}))} className="mt-2 text-sm text-mute underline">
          zrušit ruční ceny
        </button>
      </Panel>

      <Panel title="Herní čas">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">
            Přepsat herní den
            <input type="number" value={clockDay} onChange={(e) => setClockDay(e.target.value)} placeholder="z dat" className="w-24 rounded-md border border-line bg-panel2 px-2 py-1" />
          </label>
          <button className="rounded-lg border border-line px-3 py-1 hover:border-accent" onClick={() => void api.setClock({ ...s.clock, gameDay: clockDay ? Number(clockDay) : null })}>
            Použít
          </button>
          <span className="text-sm text-mute">Fázi přepneš nahoře vedle názvu fáze.</span>
        </div>
      </Panel>

      <Panel title="Parametry" right={<SaveBtn />}>
        <div className="space-y-2">
          {flatten(cfg as unknown as Record<string, unknown>).map((f) => {
            const label = LABELS[f.path] ?? f.path;
            const set = (v: unknown) => edit((n) => setPath(n, f.path, v));
            if (f.path === 'md61.mode')
              return (
                <label key={f.path} className="flex items-center justify-between gap-3 text-sm">
                  <span>{label}</span>
                  <select value={String(f.value)} onChange={(e) => set(e.target.value)} className="w-40 rounded-md border border-line bg-panel2 px-2 py-1">
                    <option value="celková">celková poptávka</option>
                    <option value="doplnění">doplnění</option>
                  </select>
                </label>
              );
            if (typeof f.value === 'number')
              return (
                <label key={f.path} className="flex items-center justify-between gap-3 text-sm">
                  <span>{label}</span>
                  <input type="number" step="any" value={String(f.value)} onChange={(e) => set(Number(e.target.value))} className="num w-40 rounded-md border border-line bg-panel2 px-2 py-1 text-right" />
                </label>
              );
            if (typeof f.value === 'boolean')
              return (
                <label key={f.path} className="flex items-center justify-between gap-3 text-sm">
                  <span>{label}</span>
                  <input type="checkbox" checked={f.value} onChange={(e) => set(e.target.checked)} className="h-5 w-5" />
                </label>
              );
            if (typeof f.value === 'string')
              return (
                <label key={f.path} className="flex items-center justify-between gap-3 text-sm">
                  <span>{label}</span>
                  <input value={f.value} onChange={(e) => set(e.target.value)} className="w-40 rounded-md border border-line bg-panel2 px-2 py-1" />
                </label>
              );
            return (
              <details key={f.path} className="rounded-md border border-line p-2 text-sm">
                <summary className="cursor-pointer">{label} (JSON)</summary>
                <textarea rows={8} defaultValue={JSON.stringify(f.value, null, 2)} onChange={(e) => setJson({ ...json, [f.path]: e.target.value })} className="mt-2 w-full rounded-md border border-line bg-panel2 p-2 font-mono text-xs" />
              </details>
            );
          })}
        </div>
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
            <button disabled={confirm !== 'SMAZAT'} className="rounded-lg border border-crit/60 px-3 py-1 text-red-300 disabled:opacity-40" onClick={() => void api.reset().then(() => (setConfirm(''), setMsg('✓ Data smazána')))}>
              Smazat herní data
            </button>
            <span className="text-mute">(nastavení a mapovací profily zůstanou)</span>
          </div>
        </div>
      </Panel>
    </div>
  );
}
