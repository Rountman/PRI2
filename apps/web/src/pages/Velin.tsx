import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmtEUR, fmtNum, fmtPct, fmtPrice, fmtShort } from '@copilot/engine/format';
import { skuLabel } from '@copilot/engine/normalize';
import type { StateResponse } from '../api.ts';
import { ActionCard } from '../components/ActionCard.tsx';
import { Badge, cx, Info, Missing, Panel } from '../components/ui.tsx';

export const PHASES = [
  { id: 'pred', label: 'Před kolem' },
  { id: 'start', label: 'Start (den 1–3)' },
  { id: 'beh', label: 'Běh (4–15)' },
  { id: 'konec', label: 'Konec (16–20)' },
] as const;

export function PhaseBar({ s }: { s: StateResponse }) {
  const c = s.snapshot.analysis.clock;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {PHASES.map((p) => (
        <span key={p.id} className={cx('rounded-lg px-3 py-1.5 text-sm font-semibold', c.phase === p.id ? 'bg-accent text-slate-950' : 'bg-panel2 text-mute')}>
          {c.phase === p.id && '● '}
          {p.label}
        </span>
      ))}
      <span className="ml-2 text-lg font-bold">
        {c.hasData ? `kolo ${c.round}, den ${c.day}/${s.config.roundLength}` : 'žádná data'}
      </span>
      <Info title="Fáze kola">
        <p>Fáze se bere z posledního herního dne v datech (Valuation, Sales, Market, Production). V Nastavení jde den přepsat a přepnout „mezi koly“.</p>
        <p>Pravidla se ukazují podle fáze – např. R11 (suroviny přes hranici kola) jen na konci kola.</p>
      </Info>
    </div>
  );
}

const STATUS_TONE: Record<string, string> = {
  vyprodáno: 'bg-crit/25 border-crit/60',
  nízké: 'bg-high/20 border-high/60',
  ok: 'bg-good/15 border-good/50',
  přebytek: 'bg-accent/15 border-accent/50',
  'bez prodeje': 'bg-panel2 border-line',
};
const STATUS_ICON: Record<string, string> = { vyprodáno: '⛔', nízké: '⚠', ok: '✓', přebytek: '▲', 'bez prodeje': '·' };

function Coverage({ s }: { s: StateResponse }) {
  const a = s.snapshot.analysis;
  if (!a.has.inventory) return <Missing what="InventoryReport">dny pokrytí potřebují aktuální sklad.</Missing>;
  const rows = a.coverage.filter((c) => c.stock > 0 || c.avgDaily > 0);
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {rows.map((c) => (
        <div key={c.sku} className={cx('rounded-lg border p-2', STATUS_TONE[c.status])}>
          <div className="flex items-center justify-between text-sm">
            <b>{c.sku}</b>
            <span>
              {STATUS_ICON[c.status]} {c.status}
            </span>
          </div>
          <div className="num text-2xl font-bold">{c.days === null || !Number.isFinite(c.days) ? '∞' : fmtNum(c.days, 1)} d</div>
          <div className="num text-xs text-mute">
            sklad {fmtNum(c.stock)} · {fmtNum(c.avgDaily)}/den
          </div>
        </div>
      ))}
    </div>
  );
}

function Production({ s }: { s: StateResponse }) {
  const a = s.snapshot.analysis;
  if (!a.has.production) return <Missing what="ProductionReport" />;
  return (
    <div className="space-y-3">
      {a.production.map((p) => (
        <div key={p.round}>
          <div className="mb-1 flex justify-between text-sm">
            <span>
              Kolo {p.round} · {p.orders} zakázek · {p.setups} setupů ({fmtNum(p.setupHours)} h)
            </span>
            <b className="num">{fmtPct(p.utilization)}</b>
          </div>
          <div className="h-3 overflow-hidden rounded bg-panel2" role="meter" aria-valuenow={Math.round(p.utilization * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className={cx('h-full rounded', p.utilization < 0.6 ? 'bg-high' : 'bg-good')} style={{ width: `${Math.min(100, p.utilization * 100)}%` }} />
          </div>
          {p.idleDays.length > 0 && <div className="text-xs text-mute">bez zakázky: dny {p.idleDays.join(', ')}</div>}
        </div>
      ))}
    </div>
  );
}

function Prices({ s }: { s: StateResponse }) {
  const a = s.snapshot.analysis;
  if (!a.has.sales) return <Missing what="SalesReport" />;
  const rows = a.pricing.filter((p) => p.ourPrice !== null);
  return (
    <table className="num w-full text-sm">
      <thead className="text-left text-mute">
        <tr>
          <th className="py-1">SKU</th>
          <th className="text-right">naše</th>
          <th className="text-right">trh ⌀</th>
          <th className="text-right">náklad</th>
          <th className="text-right">návrh</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.sku} className="border-t border-line/60">
            <td className="py-1 font-semibold">{p.sku}</td>
            <td className="text-right">{fmtPrice(p.ourPrice)}</td>
            <td className="text-right text-mute">{fmtPrice(p.marketAvg)}</td>
            <td className="text-right text-mute">{fmtPrice(p.unitCost)}</td>
            <td className={cx('text-right font-semibold', p.action === 'zvýšit' && 'text-good', p.action === 'snížit' && 'text-high')}>
              {p.recommended !== null ? `${fmtPrice(p.recommended)} ${p.action === 'zvýšit' ? '▲' : '▼'}` : '–'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ValuationChart({ s }: { s: StateResponse }) {
  const v = s.snapshot.analysis.valuation;
  if (!v.points.length) return <Missing what="Company Valuation" />;
  const data = v.points.map((p) => ({ x: p.gameDay, label: `${String(p.round).padStart(2, '0')}/${String(p.day).padStart(2, '0')}`, v: p.valuation }));
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid stroke="#24314d" strokeDasharray="0" vertical={false} />
          <XAxis dataKey="label" stroke="#8fa0bf" tick={{ fontSize: 12 }} interval="preserveStartEnd" minTickGap={30} />
          <YAxis stroke="#8fa0bf" tick={{ fontSize: 12 }} tickFormatter={(x) => fmtShort(x)} width={56} domain={['auto', 'auto']} />
          <Tooltip
            cursor={{ stroke: '#8fa0bf', strokeWidth: 1 }}
            contentStyle={{ background: '#17223a', border: '1px solid #24314d', borderRadius: 8, color: '#e6ecf7' }}
            formatter={(x) => [fmtEUR(Number(x)), 'Valuace']}
            labelFormatter={(l) => `den ${l}`}
          />
          <Line type="monotone" dataKey="v" stroke="#60a5fa" strokeWidth={2} dot={false} activeDot={{ r: 5, stroke: '#111a2e', strokeWidth: 2 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function RatingPanel({ s }: { s: StateResponse }) {
  const c = s.snapshot.analysis.calibration;
  return (
    <Panel
      title="Rating a finance"
      right={
        <Info title="Rating">
          <p>DebtLoading = Cash + AR − Úvěr − AP → rating → přirážka. Diskont = 7 % + přirážka; je ve jmenovateli valuace.</p>
          <p>{c.source === 'finance' ? `Z finančního výkazu ze dne ${c.gameDay}.` : `Bez výkazu: rating z Nastavení (${c.rating}), profit dopočten z reportované valuace.`}</p>
        </Info>
      }
    >
      <div className="num flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <span>
          <Badge tone="accent" className="text-base">{c.rating}</Badge> diskont {fmtPct(c.discount, 2)}
        </span>
        {c.debtLoading !== null && <span>DebtLoading {fmtShort(c.debtLoading)} €</span>}
        {c.toUp !== null && <span className="text-good">↑ {fmtShort(c.toUp)} €</span>}
        {c.toDown !== null && <span className="text-high">↓ rezerva {fmtShort(c.toDown)} €</span>}
        {c.source === 'implied' && <Badge tone="high">odhad – nahraj výkaz ve Finance</Badge>}
        {c.match === true && <Badge tone="good">✅ vzorec sedí</Badge>}
        {c.match === false && <Badge tone="crit">❌ vzorec nesedí ({fmtPct(c.deviation, 1)})</Badge>}
      </div>
      {c.profit !== null && (
        <div className="num mt-1 text-sm text-mute">
          profit kumulativně {fmtEUR(c.profit)}
          {c.source === 'implied' && ' (dopočteno)'}
        </div>
      )}
    </Panel>
  );
}

export function ValuationHeadline({ s }: { s: StateResponse }) {
  const v = s.snapshot.analysis.valuation;
  if (!v.latest) return <span className="text-mute">Valuace –</span>;
  const d = v.dayDelta ?? 0;
  return (
    <span className="flex items-baseline gap-2">
      <span className="text-mute">Valuace</span>
      <b className="num text-2xl">{fmtShort(v.latest.valuation)} €</b>
      <span className={cx('num text-sm font-semibold', d >= 0 ? 'text-good' : 'text-crit')}>
        {d >= 0 ? '▲' : '▼'} {fmtShort(Math.abs(d))}
      </span>
    </span>
  );
}

export function Velin({ s }: { s: StateResponse }) {
  const snap = s.snapshot;
  const critIds = new Set(snap.critical.map((c) => c.id));
  const others = snap.cards.filter((c) => !critIds.has(c.id));
  const warns = snap.warnings.filter((w) => w.level === 'warn');
  const lost = snap.analysis.stockouts.totalLostMargin;
  const zeroDc = snap.analysis.channels.filter((c) => c.qty === 0);
  return (
    <div className="space-y-4">
      {warns.length > 0 && (
        <div className="rounded-xl border border-high/50 bg-high/10 p-3 text-sm">
          <b>⚠ Config vs. data:</b>
          <ul className="ml-5 list-disc">
            {warns.map((w) => (
              <li key={w.id}>{w.text}</li>
            ))}
          </ul>
        </div>
      )}
      {!snap.analysis.clock.hasData && <Missing what="exporty ze SAPu (záložka Ingest)">zatím tu nejsou žádná data.</Missing>}

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-crit">Kritické ({snap.critical.length})</h2>
        {snap.critical.length ? (
          <div className="grid gap-3 lg:grid-cols-3">
            {snap.critical.map((c) => (
              <ActionCard key={c.id} card={c} />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-good/40 bg-good/10 p-3 text-good">✓ Nic kritického.</div>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-mute">Další akce – podle dopadu na valuaci</h2>
          <div className="space-y-3">
            {others.map((c) => (
              <ActionCard key={c.id} card={c} compact={c.priority === 'střední'} />
            ))}
            {!others.length && <div className="text-mute">Žádné další akce.</div>}
          </div>
        </section>
        <div className="space-y-4">
          <RatingPanel s={s} />
          <Panel
            title="Valuace – trend"
            right={
              <Info title="Valuace">
                <p>Report Company Valuation, sloupec „Company Valuation“. První 2 dny kola 1 jsou oříznuté (artefakt anualizace jednoho dne).</p>
                <p>Den 20 typicky klesá – strhnou se 5denní fixní náklady.</p>
              </Info>
            }
          >
            <ValuationChart s={s} />
            <div className="num mt-2 flex flex-wrap gap-3 text-sm text-mute">
              {snap.analysis.valuation.roundEnds.map((r) => (
                <span key={r.round}>
                  K{r.round}: <b className="text-ink">{fmtShort(r.valuation)}</b>
                  {r.delta !== null && <span className={r.delta >= 0 ? 'text-good' : 'text-crit'}> ({r.delta >= 0 ? '+' : ''}{fmtShort(r.delta)})</span>}
                </span>
              ))}
            </div>
          </Panel>
          <Panel
            title="Sklad – dny pokrytí"
            right={
              <Info title="Dny pokrytí">
                <p>Sklad (InventoryReport, lokace 02) ÷ průměrný denní prodej za posledních {s.config.coverageWindowDays} dní, kdy byl SKU skladem (SummarySales).</p>
                <p>Dny výpadku se do průměru nepočítají, jinak by výpadek vypadal jako nízká poptávka.</p>
              </Info>
            }
          >
            <Coverage s={s} />
          </Panel>
          <Panel
            title="Výroba – využití kapacity"
            right={
              <Info title="Využití výroby">
                <p>Vyrobeno (ProductionReport, Confirmed) ÷ (kapacita {fmtNum(s.config.capacityPerDay)}/den × odehrané dny). Setup = sloupec Setup v hodinách.</p>
              </Info>
            }
          >
            <Production s={s} />
          </Panel>
          <Panel title="Ceny – naše vs. trh">
            <Prices s={s} />
          </Panel>
          <Panel title="Ztráty a kanály">
            <div className="space-y-1 text-sm">
              <div>
                Odhad ztracené marže z výpadků skladu: <b className="num">{fmtEUR(lost)}</b>
                <Info title="Ztracená marže z výpadků">
                  <p>Den výpadku = SKU z našeho sortimentu začal den s nulovým skladem (rekonstrukce: počáteční sklad + výroba − prodeje) a trh ho ten týden kupoval.</p>
                  <p>Ztráta = poptávka v dnech se skladem × dny výpadku, zastropováno naším nejvyšším podílem na trhu × marže/ks. Je to odhad.</p>
                </Info>
              </div>
              {zeroDc.map((c) => (
                <div key={c.dc}>
                  <Badge tone="high">DC {c.dc}</Badge> {c.name}: 0 prodejů – nastavená cena ve VK32?
                </div>
              ))}
              {snap.analysis.stockouts.perSku
                .filter((x) => x.round === snap.analysis.clock.round)
                .slice(0, 5)
                .map((x) => (
                  <div key={x.sku} className="text-mute">
                    {skuLabel(x.sku)}: {x.days.length} dní bez zboží ≈ {fmtEUR(x.lostMargin)}
                  </div>
                ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
