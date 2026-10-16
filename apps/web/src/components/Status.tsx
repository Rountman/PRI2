import type { ActionCard as Card } from '@copilot/engine';
import { fmtEUR, fmtNum, fmtPct, fmtPrice, fmtShort } from '@copilot/engine/format';
import type { StateResponse } from '../api.ts';
import { WhyBody, WhyHover } from './Why.tsx';
import { Badge, cx, Info, Panel, useSidePanel, Why } from './ui.tsx';

const d1 = (x: number | null) => (x === null ? '∞' : fmtNum(x, 1));
const k = (x: number) => (x >= 10_000 ? `${fmtNum(x / 1000)}k` : fmtNum(x));

/** "Co se děje → doporučení": one row per finding, reasons and SAP details behind (?). */
export function Findings({ s }: { s: StateResponse }) {
  const { open } = useSidePanel();
  const cards = s.snapshot.cards;
  const pregame = s.snapshot.clock.phase === 'pred-hrou';
  return (
    <Panel
      title={pregame ? 'Doporučené nastavení startu' : 'Co se děje → doporučení'}
      right={
        <Info title="Jak číst tabulku">
          <p>Každý řádek = co appka vidí v datech a co doporučuje. Seřazeno podle odhadu dopadu v €. Červená tečka = hoří.</p>
          <p>Najetí na (?) ukáže důvod, klik otevře detail včetně hodnot pro SAP.</p>
        </Info>
      }
    >
      {cards.length === 0 ? (
        <div className="text-mute">Nic neobvyklého – prognóza a ceny jsou v tabulkách níže.</div>
      ) : (
        <table className="w-full text-[0.95rem]" data-testid="findings">
          <thead className="text-left text-sm text-mute">
            <tr>
              <th className="w-4" />
              <th className="py-1 pr-3">Co se děje</th>
              <th className="pr-3">Doporučení</th>
              <th className="text-right">dopad</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {cards.map((c: Card) => (
              <tr key={c.id} className="border-t border-line/60 align-top">
                <td className="pt-2.5">{c.priority === 'kritické' && <span className="inline-block h-2.5 w-2.5 rounded-full bg-crit" title="hoří" />}</td>
                <td className="py-1.5 pr-3 text-mute">{c.observation}</td>
                <td className="py-1.5 pr-3 font-semibold">{c.title}</td>
                <td className="num whitespace-nowrap py-1.5 text-right text-good">{c.profitEUR && c.profitEUR > 0 ? `+${fmtShort(c.profitEUR)} €` : ''}</td>
                <td className="py-1 text-right">
                  <Why hover={<WhyHover card={c} />} onOpen={() => open({ title: c.title, body: <WhyBody card={c} /> })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

const STATE = {
  vyprodáno: { tone: 'crit' as const },
  dochází: { tone: 'high' as const },
  OK: { tone: 'good' as const },
  přebytek: { tone: 'accent' as const },
  'bez prodeje': { tone: 'mid' as const },
  vyřazeno: { tone: 'none' as const },
};

/** Per product: stock, queue, sales, coverage, our price vs market, margin. */
export function Products({ s }: { s: StateResponse }) {
  const snap = s.snapshot;
  if (snap.clock.phase === 'pred-hrou' || !(snap.analysis.has.inventory || snap.analysis.has.sales)) return null;
  const lead = s.config.md61.leadTimeMax;
  const high = s.config.pricing.highCoverDays;
  return (
    <Panel title="Přehled výrobků">
      <div className="overflow-x-auto">
        <table className="num w-full text-[0.95rem]" data-testid="products">
          <thead className="text-left text-sm text-mute">
            <tr>
              <th className="py-1">Výrobek</th>
              <th>stav</th>
              <th className="text-right">sklad</th>
              <th className="text-right">ve výrobě</th>
              <th className="text-right">prodej/den</th>
              <th className="text-right">vydrží dní</th>
              <th className="text-right">naše cena</th>
              <th className="text-right">trh</th>
              <th className="text-right">náklad</th>
              <th className="text-right">marže/ks</th>
            </tr>
          </thead>
          <tbody>
            {snap.md61.rows.map((r) => {
              const v = snap.vk32.rows.find((x) => x.sku === r.sku);
              const ours = v?.cells.filter((c) => c.current !== null).map((c) => c.current!) ?? [];
              const state: keyof typeof STATE = r.dropped
                ? 'vyřazeno'
                : r.demand.perDay <= 0
                  ? 'bez prodeje'
                  : r.stock <= 0
                    ? 'vyprodáno'
                    : (r.coverDays ?? Infinity) < lead
                      ? 'dochází'
                      : r.stock / r.demand.perDay > high
                        ? 'přebytek'
                        : 'OK';
              return (
                <tr key={r.sku} className={cx('border-t border-line/60', r.dropped && 'text-mute')}>
                  <td className="py-1.5 font-bold" title={r.label}>
                    {r.mat}
                  </td>
                  <td>
                    <Badge tone={STATE[state].tone}>{state}</Badge>
                  </td>
                  <td className="text-right">{k(r.stock)}</td>
                  <td className="text-right">{snap.md61.wipKnown ? k(r.wip) : '?'}</td>
                  <td className="text-right">{k(Math.round(r.demand.perDay))}</td>
                  <td className="text-right">{d1(r.coverDays)}</td>
                  <td className="text-right">{ours.length ? ours.map((p) => fmtNum(p, 2)).join(' / ') : '–'}</td>
                  <td className="text-right text-mute">{v?.anchor != null ? fmtNum(v.anchor, 2) : '–'}</td>
                  <td className="text-right text-mute">{v ? fmtNum(v.unitCost, 2) : '–'}</td>
                  <td className="text-right">{fmtPrice(r.margin)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-sm text-mute">
        Prodej/den = průměr posledních {s.config.md61.demandWindow} dní, jen dny se zbožím. „Dochází“ = vydrží méně než lead time surovin ({lead} dní). Naše cena po DC.
        {!snap.md61.wipKnown && ' Výrobu ve frontě appka nezná (chybí ProductionReport).'}
      </p>
    </Panel>
  );
}

export function Channels({ s }: { s: StateResponse }) {
  const rows = s.snapshot.status.dcs;
  if (!rows.length) return null;
  return (
    <Panel title={`Obchody – posledních ${s.config.md61.demandWindow} dní`}>
      <table className="num w-full text-[0.95rem]" data-testid="channels">
        <thead className="text-left text-sm text-mute">
          <tr>
            <th className="py-1">DC</th>
            <th>balení</th>
            <th className="text-right">prodáno</th>
            <th className="text-right">tržby</th>
            <th className="text-right">prům. cena</th>
            <th className="pl-3">stav</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.dc} className="border-t border-line/60">
              <td className="py-1.5">
                <b>DC {r.dc}</b> <span className="text-sm text-mute">{r.name}</span>
              </td>
              <td>{r.sizes.join(', ')}</td>
              <td className="text-right">{fmtNum(r.qty)} ks</td>
              <td className="text-right">{fmtEUR(r.revenue)}</td>
              <td className="text-right">{fmtPrice(r.avgPrice)}</td>
              <td className="pl-3">
                <Badge tone={r.status === 'prodává' ? 'good' : 'crit'}>{r.status}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

export function Plant({ s }: { s: StateResponse }) {
  const p = s.snapshot.status.plant;
  if (s.snapshot.clock.phase === 'pred-hrou') return null;
  const bar = (q: number, lim: number) => {
    const r = lim ? q / lim : 0;
    return (
      <span className="inline-flex items-center gap-2">
        <span className="h-2 w-24 overflow-hidden rounded bg-panel2">
          <span className={cx('block h-full', r > 1 ? 'bg-crit' : r > 0.85 ? 'bg-high' : 'bg-good')} style={{ width: `${Math.min(100, r * 100)}%` }} />
        </span>
        <span className="text-sm">{fmtPct(r)}</span>
      </span>
    );
  };
  return (
    <Panel title="Výroba a sklady">
      <table className="num w-full text-[0.95rem]" data-testid="plant">
        <tbody>
          <tr className="border-b border-line/60">
            <td className="py-1.5 text-mute">Fronta výroby</td>
            <td className="text-right">{p.queueUnits === null ? 'neznámá (ProductionReport)' : `${fmtNum(p.queueUnits)} ks ≈ ${d1(p.queueDays)} dne`}</td>
            <td />
          </tr>
          <tr className="border-b border-line/60">
            <td className="py-1.5 text-mute">Využití linky{p.utilizationRound ? ` (kolo ${p.utilizationRound})` : ''}</td>
            <td className="text-right">{p.utilization === null ? '–' : fmtPct(p.utilization)}</td>
            <td className="text-right text-sm text-mute">přestavba {fmtNum(p.setupHours, 1)} h</td>
          </tr>
          {(
            [
              ['Hotové výrobky', p.fg, 'ks'],
              ['Suroviny', p.raw, 'kg'],
              ['Obaly', p.packaging, 'ks'],
            ] as const
          ).map(([label, x, u]) => (
            <tr key={label} className="border-b border-line/60">
              <td className="py-1.5 text-mute">{label}</td>
              <td className="text-right">
                {fmtNum(x.qty)} / {fmtNum(x.limit)} {u}
              </td>
              <td className="text-right">{bar(x.qty, x.limit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

/** All products from the latest ZMARKET window – also those we don't make. */
export function Market({ s }: { s: StateResponse }) {
  const mo = s.snapshot.status.market;
  if (!mo) return null;
  return (
    <Panel
      title={`Trh – všechny týmy, posledních 5 dní (ZMARKET den ${mo.gameDay})`}
      right={
        <Info title="Trh">
          <p>Všechny výrobky, které v posledních 5 dnech prodal kterýkoli tým, podle tržeb celého trhu. Šedé = nevyrábíme.</p>
          <p>Když nevyráběný výrobek vychází (tržby × marže) o 20 % lépe než náš nejslabší, objeví se doporučení v „Co se děje“. Sortiment se sám nemění – zaškrtává se v Nastavení.</p>
        </Info>
      }
    >
      <div className="overflow-x-auto">
        <table className="num w-full text-[0.95rem]" data-testid="market">
          <thead className="text-left text-sm text-mute">
            <tr>
              <th className="py-1">Výrobek</th>
              <th>vyrábíme</th>
              <th className="text-right">podíl tržeb trhu</th>
              <th className="text-right">prodáno trh</th>
              <th className="text-right">cena trhu</th>
              <th className="text-right">náš podíl</th>
              <th className="text-right">marže</th>
            </tr>
          </thead>
          <tbody>
            {mo.rows.map((r) => (
              <tr key={r.sku} className={cx('border-t border-line/60', !r.produced && 'text-mute')}>
                <td className="py-1.5" title={r.label}>
                  <b className={r.produced ? undefined : 'font-semibold'}>{r.mat}</b> <span className="text-sm text-mute">{r.label.replace(/ \(F\d\d\)$/, '')}</span>
                </td>
                <td>{r.produced ? <Badge tone="good">ano</Badge> : <Badge tone="none">ne</Badge>}</td>
                <td className="text-right">
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2 w-20 overflow-hidden rounded bg-panel2">
                      <span className="block h-full bg-accent" style={{ width: `${Math.min(100, r.revenueShare * 100 * 4)}%` }} />
                    </span>
                    {fmtPct(r.revenueShare, 1)}
                  </span>
                </td>
                <td className="text-right">{k(r.qty)}</td>
                <td className="text-right">{fmtNum(r.price, 2)}</td>
                <td className="text-right">{r.ourQty ? fmtPct(r.ourShare, 1) : '–'}</td>
                <td className="text-right">{fmtPct(r.marginRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
