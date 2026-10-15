import { AREA_CS } from '@copilot/engine/normalize';
import { fmtEUR, fmtNum } from '@copilot/engine/format';
import type { StateResponse } from '../api.ts';
import { CopyValue, cx, Panel } from '../components/ui.tsx';

export function Marketing({ s }: { s: StateResponse }) {
  const rows = s.snapshot.marketing;
  return (
    <Panel title="ZADS – denní marketing per produkt × region">
      <p className="mb-3 text-sm text-mute">DC 14 reaguje na reklamu hodně, DC 12 středně, DC 10 skoro vůbec. Reklama jen tam, kde je zboží skladem. Efekt nemáme změřený – začni malou částkou. [ODHAD]</p>
      <table className="num w-full text-sm">
        <thead className="text-left text-mute">
          <tr>
            <th>SKU</th>
            <th>DC</th>
            <th>citlivost</th>
            <th className="text-right">pokrytí</th>
            <th>region</th>
            <th className="text-right">€/den</th>
            <th>proč</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.sku}${r.dc}`} className={cx('border-t border-line/60', !r.advise && 'text-mute')}>
              <td className="py-1 font-bold">{r.mat}</td>
              <td>{r.dc}</td>
              <td>{r.sensitivity}</td>
              <td className="text-right">{r.coverDays === null ? '–' : fmtNum(r.coverDays, 1)}</td>
              <td>{r.area ? AREA_CS[r.area] : 'všechny'}</td>
              <td className="text-right">{r.advise ? <CopyValue value={String(r.eurPerDay)} display={fmtEUR(r.eurPerDay)} /> : '0'}</td>
              <td>{r.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
