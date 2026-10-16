import { AREA_CS } from '@copilot/engine/normalize';
import { fmtEUR, fmtNum, fmtPct } from '@copilot/engine/format';
import type { StateResponse } from '../api.ts';
import { CopyValue, cx, Panel } from '../components/ui.tsx';

export function Marketing({ s }: { s: StateResponse }) {
  const rows = s.snapshot.marketing;
  const total = rows.reduce((a, r) => a + r.eurPerDay, 0);
  return (
    <Panel title="ZADS – denní marketing per výrobek × region">
      <p className="mb-3 text-sm text-mute">
        V ZADS se zadává pro každý výrobek a každý region (Sever / Jih / Západ) zvlášť. 500 g jde do malých obchodů DC 14 (reklama účinná), 1 kg do DC 10/12 (méně). Reklama jen tam, kde je zboží. Region s
        nejnižším naším podílem dostane +50 %. Efekt nemáme změřený – začni takhle a sleduj prodeje. [ODHAD]
      </p>
      <table className="num w-full text-sm">
        <thead className="text-left text-mute">
          <tr>
            <th>Výrobek</th>
            <th>Region</th>
            <th>DC · citlivost</th>
            <th className="text-right">pokrytí</th>
            <th className="text-right">náš podíl</th>
            <th className="text-right">€/den</th>
            <th>proč</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.sku}${r.area}`} className={cx(i % 3 === 0 && 'border-t border-line', !r.advise && 'text-mute')}>
              <td className="py-1 font-bold">{i % 3 === 0 ? r.mat : ''}</td>
              <td>{AREA_CS[r.area]}</td>
              <td>
                {r.dcs.join('/')} · {r.sensitivity}
              </td>
              <td className="text-right">{r.coverDays === null ? '–' : fmtNum(r.coverDays, 1)}</td>
              <td className="text-right">{r.share === null ? '–' : fmtPct(r.share)}</td>
              <td className="text-right">{r.advise ? <CopyValue value={String(r.eurPerDay)} display={fmtEUR(r.eurPerDay)} /> : '0'}</td>
              <td>{r.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-sm text-mute">Celkem {fmtEUR(total)} za den.</p>
    </Panel>
  );
}
