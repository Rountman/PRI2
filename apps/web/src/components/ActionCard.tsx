import type { ActionCard as Card } from '@copilot/engine';
import { fmtEUR, fmtShort } from '@copilot/engine/format';
import { api } from '../api.ts';
import { Badge, CopyValue, cx, useSidePanel, Why } from './ui.tsx';

const PRIO = {
  kritické: { border: 'border-l-crit', tone: 'crit' as const },
  běžné: { border: 'border-l-accent', tone: 'accent' as const },
};

export function WhyBody({ card }: { card: Card }) {
  return (
    <div className="space-y-5">
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
        <h4 className="mb-2 text-sm font-semibold uppercase tracking-wider text-mute">Postup v SAP ({card.tcode})</h4>
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

export function ActionCard({ card, compact = false }: { card: Card; compact?: boolean }) {
  const { open } = useSidePanel();
  const p = PRIO[card.priority];
  const showWhy = () => open({ title: card.title, body: <WhyBody card={card} /> });
  return (
    <article className={cx('rounded-xl border border-line border-l-8 bg-panel p-4 transition', p.border, card.done && 'opacity-40')}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            {card.priority === 'kritické' && <Badge tone={p.tone}>KRITICKÉ</Badge>}
            <Badge tone="accent">{card.tcode}</Badge>
            {card.deadline && <span className="text-sm text-high">⏱ {card.deadline}</span>}
          </div>
          <h3 className={cx('font-bold leading-snug', compact ? 'text-lg' : 'text-xl', card.done && 'line-through')}>{card.title}</h3>
          {!compact && !card.done && (
            <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-[0.95rem]">
              {card.steps.slice(0, 10).map((s, i) => (
                <li key={i}>{s}</li>
              ))}
              {card.steps.length > 10 && <li className="list-none text-mute">… +{card.steps.length - 10} kroků (?)</li>}
            </ol>
          )}
          {!compact && !card.done && !!card.copyValues?.length && (
            <div className="mt-2 flex flex-wrap gap-2">
              {card.copyValues.slice(0, 12).map((v, i) => (
                <CopyValue key={i} label={v.label} value={v.value} />
              ))}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {!!card.profitEUR && card.profitEUR > 0 && (
            <div className="text-right">
              <div className="num text-xl font-bold text-good">+{fmtShort(card.profitEUR)} €</div>
              <div className="text-xs text-mute">odhad dopadu</div>
            </div>
          )}
          <div className="flex gap-2">
            <Why hover={<WhyHover card={card} />} onOpen={showWhy} className="h-10 w-10 rounded-lg border border-line text-lg" />
            <button
              onClick={() => void api.setDone(card.id, !card.done)}
              className={cx('h-10 rounded-lg border px-3 font-semibold', card.done ? 'border-line text-mute' : 'border-good/50 text-good hover:bg-good/10')}
              title={card.done ? 'Vrátit' : 'Hotovo – odškrtne se celému týmu'}
            >
              {card.done ? '↺' : '✓'}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
