import { fmtNum, fmtPrice } from '@copilot/engine/format';
import { skuLabel } from '@copilot/engine/normalize';
import type { StateResponse } from '../api.ts';
import { CopyValue, Missing, Panel } from '../components/ui.tsx';

export function Vyroba({ s }: { s: StateResponse }) {
  const a = s.snapshot.analysis;
  const plan = a.plan;
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel title={`Doporučený plán – ${plan.horizonDays} dní`}>
        {plan.runs.length ? (
          <>
            <ol className="space-y-3">
              {plan.runs.map((r, i) => (
                <li key={i} className="rounded-lg bg-panel2 p-3">
                  <div className="text-lg font-bold">
                    {i + 1}. {skuLabel(r.sku)} – {fmtNum(r.qty)} ks
                  </div>
                  <div className="num text-sm text-mute">
                    den +{fmtNum(r.startDay, 1)} → +{fmtNum(r.endDay, 1)} · setup {fmtNum(r.setupHours, 1)} h · marže {fmtPrice(r.marginPerUnit)}/ks · poptávka {fmtNum(r.demandPerDay)}/den · sklad {fmtNum(r.stock)}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {r.orders.map((o, j) => (
                      <CopyValue key={j} label={`zakázka ${j + 1}`} value={String(o)} />
                    ))}
                  </div>
                </li>
              ))}
            </ol>
            <p className="num mt-3 text-sm text-mute">
              {fmtNum(plan.plannedUnits)} ks z kapacity {fmtNum(plan.capacityUnits)} · {plan.changeovers} přestaveb (−{fmtNum(plan.setupLossUnits)} ks) · poptávka = {plan.demandSource}
            </p>
          </>
        ) : (
          <Missing what="SalesReport / SummarySales a ProductionReport">plán potřebuje poptávku a marže.</Missing>
        )}
      </Panel>
      <Panel title="Zakázky (ProductionReport)">
        {a.has.production ? (
          <table className="num w-full text-sm">
            <thead className="text-left text-mute">
              <tr>
                <th>zakázka</th>
                <th>SKU</th>
                <th className="text-right">start</th>
                <th className="text-right">konec</th>
                <th className="text-right">setup h</th>
                <th className="text-right">ks</th>
              </tr>
            </thead>
            <tbody>
              {s.snapshot.analysis.openOrders.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-2 text-crit">
                    Žádná otevřená zakázka – linka stojí.
                  </td>
                </tr>
              )}
              {a.production.map((p) => (
                <tr key={p.round} className="border-t border-line">
                  <td colSpan={6} className="py-1 font-semibold">
                    Kolo {p.round}: {fmtNum(p.produced)} ks · využití {fmtNum(p.utilization * 100)} % · {p.setups} setupů · prostoj dny {p.idleDays.join(', ') || '–'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Missing what="ProductionReport" />
        )}
      </Panel>
    </div>
  );
}
