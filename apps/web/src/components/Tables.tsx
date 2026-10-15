import type { Md61Row, Vk32Cell, Vk32Row } from '@copilot/engine';
import { fmtEUR, fmtNum, fmtPrice, sapValue } from '@copilot/engine/format';
import type { StateResponse } from '../api.ts';
import { Badge, CopyValue, cx, Info, Panel, useSidePanel, Why } from './ui.tsx';

const d1 = (x: number | null) => (x === null ? '∞' : fmtNum(x, 1));

function md61Reason(r: Md61Row, horizon: number, pregame: boolean): string {
  if (pregame) return 'Start: prázdný sklad → 1 kg plná dávka, 500 g poloviční (nižší marže).';
  if (r.cut && r.planned === 0) return 'Kapacita plná – nejnižší marže/ks, teď se nevyrábí.';
  if (r.planned === 0) return `Sklad + výroba pokryjí ${horizon} dní – nic nevyrábět.`;
  return `Poptávka × ${horizon} dní − sklad − výroba${r.cut ? ' (kráceno kapacitou)' : ''}.`;
}

function Md61Why({ r, s }: { r: Md61Row; s: StateResponse }) {
  const md = s.snapshot.md61;
  const cfg = s.config;
  return (
    <div className="space-y-3">
      <p className="text-lg">
        {md.pregame
          ? `Start: sklad je prázdný, 1. cyklus = ${fmtNum(r.forecast)} ks (1 kg: ${fmtNum(cfg.md61.firstCycleQty['1kg'])}, 500 g: ${fmtNum(cfg.md61.firstCycleQty['500g'])}).`
          : `Prognóza = poptávka × ${md.horizon} dní (dny do dalšího MRP ${cfg.md61.nextMrpDays} + lead time ${cfg.md61.leadTimeMax}), zaokrouhleno nahoru na 1 000.`}
      </p>
      <table className="num w-full text-sm">
        <tbody>
          {[
            ['Poptávka / den', `${fmtNum(r.demand.perDay)} ks (${r.demand.source === 'preset' ? 'preset: trh kanálu / sortiment / startovní cena' : `průměr ${r.demand.inStockDays} dnů se skladem`})`],
            ['Vyprodáno dnů v okně', `${r.demand.stockoutDays}${r.demand.boosted ? ` → × ${cfg.md61.stockoutBoost}` : ''}`],
            ['Sklad', `${fmtNum(r.stock)} ks`],
            ['Rozpracovaná výroba', md.wipKnown ? `${fmtNum(r.wip)} ks` : 'neznámá (ProductionReport v Rozšířeném) → 0'],
            ['Pokrytí', `${d1(r.coverDays)} dne`],
            ['Marže / ks', fmtPrice(r.margin)],
            ['Režim', md.mode === 'celková' ? 'prognóza = celková poptávka; planned = prognóza − sklad − výroba' : 'prognóza = doplnění; planned = prognóza'],
            ['Planned orders po MD01', r.lots.length ? r.lots.map((l) => fmtNum(l)).join(' + ') : '0 (sklad stačí)'],
          ].map(([k, v]) => (
            <tr key={k} className="border-b border-line/60 align-top">
              <td className="py-1.5 pr-3 text-mute">{k}</td>
              <td className="py-1.5 text-right">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {r.cut && <div className="rounded-lg border border-high/40 bg-high/10 p-3 text-sm">Kráceno kapacitní kontrolou – SKU má nejnižší marži/ks.</div>}
      <p className="text-sm">
        Riziko: [OVĚŘIT] jak MD61 nakládá se spotřebou prognózy prodeji. Po MD01 porovnej planned orders s tímto sloupcem – když nesedí, přepni režim v Nastavení.
      </p>
      <Badge tone={md.pregame ? 'good' : r.demand.source === 'preset' ? 'high' : 'mid'}>jistota: {md.pregame ? 'jisté' : r.demand.source === 'preset' ? 'odhad' : 'pravděpodobné'}</Badge>
    </div>
  );
}

export function Md61Table({ s }: { s: StateResponse }) {
  const md = s.snapshot.md61;
  const { open } = useSidePanel();
  if (!md.rows.length) return null;
  const c = md.capacity;
  const m = md.materials;
  return (
    <Panel
      title="MD61 – prognóza"
      right={
        <Info title="MD61 → MD01 → ME59N → CO41">
          <p>Hodnoty ve sloupci Prognóza zadej do MD61 (pořadí materiálů jako ve formuláři). Pak MD01 (MRP), ME59N s prázdným Fixed Vendor, po dodání CO41.</p>
          <p>
            Kapacitní kontrola: Σ planned + setupy × {fmtNum(c.setupHours, 1)} h × {fmtNum(c.perDay / 24)} ks/h ≤ {fmtNum(c.perDay)} × {md.horizon} dní. Při přetlaku se krátí SKU s nejnižší marží/ks.
          </p>
        </Info>
      }
    >
      <table className="num w-full text-lg" data-testid="md61">
        <thead className="text-left text-sm text-mute">
          <tr>
            <th className="py-1">SKU</th>
            <th className="text-right">sklad</th>
            <th className="text-right">dny</th>
            <th className="text-right">prognóza</th>
            <th className="pl-3">→ planned orders</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {md.rows.map((r) => (
            <tr key={r.sku} className={cx('border-t border-line/60', r.cut && 'text-amber-200')}>
              <td className="py-1.5" title={r.label}>
                <CopyValue value={r.mat} className="font-bold" />
              </td>
              <td className="text-right">{md.pregame ? '–' : fmtShort1k(r.stock)}</td>
              <td className={cx('text-right', r.coverDays !== null && r.coverDays < s.config.md61.leadTimeMax && 'text-red-300')}>{md.pregame ? '–' : d1(r.coverDays)}</td>
              <td className="text-right">
                <CopyValue value={sapValue(r.forecast, 0)} display={fmtNum(r.forecast)} className="text-lg" />
              </td>
              <td className="pl-3 text-base text-mute">{r.lots.length ? r.lots.map((l) => `${fmtNum(l / 1000)}k`).join(' + ') : '—'}</td>
              <td className="text-right">
                <Why
                  hover={
                    <span className="block space-y-1">
                      <span className="block font-semibold">{md61Reason(r, md.horizon, md.pregame)}</span>
                      <span className="block text-mute">poptávka {fmtNum(r.demand.perDay)}/den · sklad {fmtNum(r.stock)} · výroba {md.wipKnown ? fmtNum(r.wip) : '?'} · marže {fmtPrice(r.margin)}</span>
                    </span>
                  }
                  onOpen={() => open({ title: `MD61 ${r.mat}`, body: <Md61Why r={r} s={s} /> })}
                  className="h-7 w-7 rounded-full border border-line text-xs"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 space-y-0.5 text-sm text-mute">
        <div className={cx(!c.ok && 'text-red-300')}>
          Kapacita: {fmtNum(c.units)} ks + {c.setups} setupy ({fmtNum(c.setupUnits)} ks) = {fmtNum(c.used)} / {fmtNum(c.available)} ({fmtNum(c.days, 1)} dne výroby)
          {c.cut.length > 0 && ` · kráceno: ${c.cut.join(', ')}`}
        </div>
        <div className={cx(!m.ok && 'text-red-300')}>
          Suroviny {fmtNum(m.rawKg)} kg · obaly {fmtNum(m.packaging)} ks · náklad ≈ {fmtEUR(m.cost)}
          {m.cash !== null && ` (cash ${fmtEUR(m.cash)})`}
        </div>
        {!md.wipKnown && !md.pregame && <div>Rozpracovaná výroba neznámá → počítá se 0.</div>}
      </div>
    </Panel>
  );
}

const fmtShort1k = (x: number) => (x >= 1000 ? `${fmtNum(x / 1000, x >= 10_000 ? 0 : 1)}k` : fmtNum(x));

function Vk32Why({ r, c }: { r: Vk32Row; c: Vk32Cell }) {
  return (
    <div className="space-y-3">
      <p className="text-lg">{c.reason}</p>
      <table className="num w-full text-sm">
        <tbody>
          {[
            ['Naše cena v DC', fmtPrice(c.current)],
            ['Doporučeno', fmtPrice(c.recommended)],
            ['Kotva trhu (ZMARKET)', fmtPrice(r.anchor)],
            ['Sklad / pokrytí', `${fmtNum(r.stock)} ks / ${d1(r.coverDays)} dne`],
            ['Poptávka v DC', `${fmtNum(c.demandPerDay)} ks/den`],
            [`Unit cost (${r.unitCostSource}) = podlaha`, fmtPrice(r.unitCost)],
            ['Unit cost + fixní/ks', fmtPrice(r.unitCost + r.fixedPerUnit)],
          ].map(([k, v]) => (
            <tr key={k} className="border-b border-line/60">
              <td className="py-1.5 pr-3 text-mute">{k}</td>
              <td className="py-1.5 text-right">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-sm text-mute">Pravidlo 5.3: pokrytí &lt; 3 dny nebo vyprodáno → +0,30 €. &gt; 8 dní → −0,30 €, ne pod kotvu trhu −10 %. Nikdy pod unit cost.</p>
      {c.warnFixed && <div className="rounded-lg border border-high/40 bg-high/10 p-3 text-sm">⚠ Cena nepokryje unit cost + fixní náklady na kus.</div>}
      <Badge tone={c.action === 'nastavit' && !r.anchor ? 'high' : 'mid'}>jistota: {c.action === 'nastavit' && !r.anchor ? 'odhad' : 'pravděpodobné'}</Badge>
    </div>
  );
}

const ARROW: Record<Vk32Cell['action'], string> = { zvýšit: '↑', snížit: '↓', držet: '', nastavit: '•' };

export function Vk32Table({ s }: { s: StateResponse }) {
  const vk = s.snapshot.vk32;
  const { open } = useSidePanel();
  if (!vk.rows.length) return null;
  return (
    <Panel
      title="VK32 – ceny"
      right={
        <Info title="VK32 per DC">
          <p>Ceny zadej ve VK32 pro každé DC zvlášť. DC 10 bere jen 1 kg, DC 14 jen 500 g – nepovolené buňky se neukazují.</p>
          <p>↑ zvednout, ↓ snížit, • nastavit (nová cena v DC). Klik na cenu = kopírovat.</p>
        </Info>
      }
    >
      <table className="num w-full text-lg" data-testid="vk32">
        <thead className="text-left text-sm text-mute">
          <tr>
            <th className="py-1">SKU</th>
            {vk.dcs.map((dc) => (
              <th key={dc} className="text-right">
                DC{dc}
              </th>
            ))}
            <th className="text-right">trh</th>
          </tr>
        </thead>
        <tbody>
          {vk.rows.map((r) => (
            <tr key={r.sku} className="border-t border-line/60">
              <td className="py-1.5" title={r.label}>
                <CopyValue value={r.mat} className="font-bold" />
              </td>
              {vk.dcs.map((dc) => {
                const c = r.cells.find((x) => x.dc === dc);
                if (!c) return <td key={dc} className="text-right text-mute">–</td>;
                return (
                  <td key={dc} className="text-right">
                    <span className="inline-flex items-center gap-1">
                      <CopyValue value={sapValue(c.recommended)} display={fmtNum(c.recommended, 2)} className={cx('text-lg', c.action === 'zvýšit' && 'border-good/50', c.action === 'snížit' && 'border-high/50', c.warnFixed && 'text-amber-200')} />
                      <Why
                        label={ARROW[c.action] || '?'}
                        hover={
                          <span className="block space-y-1">
                            <span className="block font-semibold">
                              {c.action === 'držet' ? 'Beze změny' : `${fmtPrice(c.current)} → ${fmtPrice(c.recommended)}`}: {c.reason}
                            </span>
                            <span className="block text-mute">
                              kotva trhu {fmtPrice(r.anchor)} · unit cost {fmtPrice(r.unitCost)} · pokrytí {d1(r.coverDays)} dne
                            </span>
                            {c.warnFixed && <span className="block text-amber-200">⚠ pod unit cost + fixní náklady/ks</span>}
                          </span>
                        }
                        onOpen={() => open({ title: `VK32 ${r.mat} · DC ${dc}`, body: <Vk32Why r={r} c={c} /> })}
                        className="w-5 text-left"
                      />
                    </span>
                  </td>
                );
              })}
              <td className="text-right text-mute">{r.anchor !== null ? fmtNum(r.anchor, 2) : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
