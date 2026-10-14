import type { ActionCard as Card } from '@copilot/engine';
import { fmtEUR, fmtShort } from '@copilot/engine/format';
import { api } from '../api.ts';
import { Badge, CopyValue, cx, useSidePanel } from './ui.tsx';

const PRIO = {
  kritické: { border: 'border-l-crit', tone: 'crit' as const },
  vysoká: { border: 'border-l-high', tone: 'high' as const },
  střední: { border: 'border-l-mid', tone: 'mid' as const },
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
          <div className="text-sm text-mute">Odhad dopadu na valuaci</div>
          <div className="num text-2xl font-bold text-good">{fmtEUR(card.impactEUR)}</div>
          {card.profitEUR !== undefined && <div className="text-sm text-mute">z toho profit/marže {fmtEUR(card.profitEUR)} (× 12 / kola / diskont)</div>}
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

export function ActionCard({ card, compact = false }: { card: Card; compact?: boolean }) {
  const { open } = useSidePanel();
  const p = PRIO[card.priority];
  const showWhy = () => open({ title: card.title, body: <WhyBody card={card} /> });
  return (
    <article className={cx('rounded-xl border border-line border-l-8 bg-panel p-4 transition', p.border, card.done && 'opacity-40')}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <Badge tone={p.tone}>{card.priority}</Badge>
            <Badge tone="accent">{card.tcode}</Badge>
            {card.deadline && <span className="text-sm text-high">⏱ {card.deadline}</span>}
          </div>
          <h3 className={cx('font-bold leading-snug', compact ? 'text-lg' : 'text-xl', card.done && 'line-through')}>{card.title}</h3>
          <p className="mt-1 text-mute">{card.why.summary}</p>
          {!compact && !card.done && (
            <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-[0.95rem]">
              {card.steps.slice(0, 6).map((s, i) => (
                <li key={i}>{s}</li>
              ))}
              {card.steps.length > 6 && <li className="list-none text-mute">… +{card.steps.length - 6} kroků (?)</li>}
            </ol>
          )}
          {!compact && !card.done && !!card.copyValues?.length && (
            <div className="mt-2 flex flex-wrap gap-2">
              {card.copyValues.slice(0, 6).map((v, i) => (
                <CopyValue key={i} label={v.label} value={v.value} />
              ))}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {card.impactEUR !== undefined && (
            <div className="text-right">
              <div className="num text-xl font-bold text-good">+{fmtShort(card.impactEUR)} €</div>
              <div className="text-xs text-mute">valuace</div>
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={showWhy} className="h-10 w-10 rounded-lg border border-line text-lg font-bold text-mute hover:border-accent hover:text-accent" title="Proč?">
              ?
            </button>
            <button
              onClick={() => void api.setDone(card.id, !card.done)}
              className={cx('h-10 rounded-lg border px-3 font-semibold', card.done ? 'border-line text-mute' : 'border-good/50 text-good hover:bg-good/10')}
              title="Odškrtnout pro celý tým"
            >
              {card.done ? '↺' : '✓ hotovo'}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
