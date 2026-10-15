import { useState } from 'react';
import type { RawKey, Recipe } from '@copilot/config';
import { cheapestRecipe, FLAVOR_RAW, formatRecipe, RAW_NAMES, unitCostFromBom, validateRecipe } from '@copilot/engine/bom';
import { fmtEUR, fmtNum, fmtPrice } from '@copilot/engine/format';
import type { StateResponse } from '../api.ts';
import { cx, Panel } from '../components/ui.tsx';

export function Recept({ s }: { s: StateResponse }) {
  const cfg = s.config;
  const prices = s.snapshot.analysis.prices;
  const rows = s.snapshot.md61.rows;
  const [sku, setSku] = useState(rows[0]?.sku ?? 'F02');
  const flavor = sku.slice(-1);
  const fr = FLAVOR_RAW[flavor];
  const [mix, setMix] = useState({ oats: 35, wheat: 35, flavor: 30 });
  const custom: Recipe = { R06: mix.oats / 100, R05: mix.wheat / 100, ...(fr ? { [fr]: mix.flavor / 100 } : {}) };
  const errs = fr ? validateRecipe(flavor, custom, cfg) : ['Kalkulačka je jen pro SKU s jednou příchutí'];
  const cur = cfg.recipes[flavor] ?? {};
  const curCost = unitCostFromBom(sku, cfg, prices, cur);
  const customCost = unitCostFromBom(sku, cfg, prices, custom);
  const perRound = (rows.find((r) => r.sku === sku)?.demand.perDay ?? 0) * cfg.roundLength;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-high/50 bg-high/10 p-3">
        ⚠ Recept ovlivňuje atraktivitu produktu (guide kap. 5) – levnější recept může snížit poptávku. ZCS02 nejde změnit, když má produkt &gt; 1 000 ks skladem nebo výrobní zakázky. Rozhodni před prvním MRP.
      </div>
      <Panel title="Aktuální vs. nejlevnější validní recept">
        <table className="num w-full text-sm">
          <thead className="text-left text-mute">
            <tr>
              <th>SKU</th>
              <th>aktuální</th>
              <th className="text-right">unit cost</th>
              <th>nejlevnější</th>
              <th className="text-right">úspora/ks</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const f = r.sku.slice(-1);
              const best = cheapestRecipe(f, cfg, prices);
              const c0 = unitCostFromBom(r.sku, cfg, prices, cfg.recipes[f] ?? {});
              const c1 = unitCostFromBom(r.sku, cfg, prices, best);
              return (
                <tr key={r.sku} className="border-t border-line/60 align-top">
                  <td className="py-1 font-bold">{r.mat}</td>
                  <td>{formatRecipe(cfg.recipes[f] ?? {})}</td>
                  <td className="text-right">{fmtPrice(c0)}</td>
                  <td>{formatRecipe(best)}</td>
                  <td className="text-right text-good">{fmtPrice(c0 - c1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-mute">Ceny surovin: {prices.R06.source === 'ProcSourcing' ? 'z ProcSourcing' : 'z presetu (mění se každých 5 dní – nahraj ProcSourcing)'}.</p>
      </Panel>
      <Panel title="Kalkulačka">
        <div className="flex flex-wrap items-center gap-3">
          <select value={sku} onChange={(e) => setSku(e.target.value)} className="rounded-md border border-line bg-panel2 px-2 py-1">
            {rows.map((r) => (
              <option key={r.sku}>{r.sku}</option>
            ))}
          </select>
          {(['oats', 'wheat', 'flavor'] as const).map((k) => (
            <label key={k} className="flex items-center gap-1">
              {k === 'oats' ? RAW_NAMES.R06 : k === 'wheat' ? RAW_NAMES.R05 : fr ? RAW_NAMES[fr as RawKey] : '–'}
              <input type="number" value={mix[k]} onChange={(e) => setMix({ ...mix, [k]: Number(e.target.value) })} className="num w-20 rounded-md border border-line bg-panel2 px-2 py-1 text-right" />%
            </label>
          ))}
        </div>
        <div className={cx('mt-3', errs.length ? 'text-red-300' : 'text-good')}>
          {errs.length ? errs.join(' · ') : `Validní · unit cost ${fmtPrice(customCost)} (aktuální ${fmtPrice(curCost)}) · úspora ${fmtPrice(curCost - customCost)}/ks ≈ ${fmtEUR((curCost - customCost) * perRound)}/kolo při ${fmtNum(perRound)} ks`}
        </div>
      </Panel>
    </div>
  );
}
