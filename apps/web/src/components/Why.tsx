import type { ActionCard as Card } from '@copilot/engine';
import { fmtEUR } from '@copilot/engine/format';
import { Badge, CopyValue } from './ui.tsx';

export function WhyBody({ card }: { card: Card }) {
  return (
    <div className="space-y-5">
      <p className="text-mute">{card.observation}</p>
      <p className="text-lg">{card.why.summary}</p>
      <div className="flex flex-wrap gap-2">
        <Badge tone="accent">{card.why.rule}</Badge>
        <Badge tone={card.why.confidence === 'jisté' ? 'good' : card.why.confidence === 'odhad' ? 'high' : 'mid'}>jistota: {card.why.confidence}</Badge>
      </div>
      {card.impactEUR !== undefined && (
        <div className="rounded-lg bg-panel2 p-3">
          <div className="text-sm text-mute">Odhad dopadu</div>
          <div className="num text-2xl font-bold text-good">{fmtEUR(card.profitEUR)}</div>
          <div className="text-sm text-mute">≈ {fmtEUR(card.impactEUR)} na valuaci (× 12 / kola / diskont)</div>
        </div>
      )}
      <div>
        <h4 className="mb-2 text-sm font-semibold uppercase tracking-wider text-mute">Data</h4>
        <table className="w-full text-sm">
          <tbody>
            {card.why.data.map((d, i) => (
              <tr key={i} className="border-b border-line/60 align-top">
                <td className="py-1.5 pr-3 text-mute">{d.label}</td>
                <td className="num py-1.5 text-right">{d.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {card.why.risk && (
        <div className="rounded-lg border border-high/40 bg-high/10 p-3 text-sm">
          <b>Riziko:</b> {card.why.risk}
        </div>
      )}
      <div>
        <h4 className="mb-2 text-sm font-semibold uppercase tracking-wider text-mute">Jak v SAPu ({card.tcode})</h4>
        <ol className="list-decimal space-y-1 pl-5">
          {card.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
        {!!card.copyValues?.length && (
          <div className="mt-3 flex flex-wrap gap-2">
            {card.copyValues.map((v, i) => (
              <CopyValue key={i} label={v.label} value={v.value} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Short reason shown on hover over (?). */
export function WhyHover({ card }: { card: Card }) {
  return (
    <span className="block space-y-2">
      <span className="block font-semibold">{card.why.summary}</span>
      {card.why.data.slice(0, 4).map((d, i) => (
        <span key={i} className="flex justify-between gap-3 text-mute">
          <span>{d.label}</span>
          <span className="num text-right text-ink">{d.value}</span>
        </span>
      ))}
      {card.why.risk && <span className="block text-amber-200">Riziko: {card.why.risk}</span>}
      <span className="block text-xs text-mute">
        {card.why.rule} · jistota: {card.why.confidence} · klik = detail
      </span>
    </span>
  );
}
