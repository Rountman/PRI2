import { fmtNum, fmtPct, fmtPrice } from '@copilot/engine/format';
import { skuLabel } from '@copilot/engine/normalize';
import type { StateResponse } from '../api.ts';
import { CopyValue, cx, Info, Missing, Panel } from '../components/ui.tsx';

export function Ceny({ s }: { s: StateResponse }) {
  const a = s.snapshot.analysis;
  if (!a.has.sales && !a.has.market) return <Missing what="SalesReport a PriceMarket" />;
  const lastWindow = Math.max(0, ...a.share.map((r) => (r.round - 1) * 100 + r.window));
  const share = a.share.filter((r) => (r.round - 1) * 100 + r.window === lastWindow);
  return (
    <div className="space-y-4">
      <Panel
        title={`Ceny SKU – trh ${a.pricing.find((p) => p.marketWindow)?.marketWindow ?? '–'}`}
        right={
          <Info title="Cenová doporučení">
            <p>R6: vyprodáno nebo pokrytí &lt; {s.config.pricing.lowCoverageDays} dny a cena ≤ trh + {s.config.pricing.maxAboveMarketPct} % → +{fmtPrice(s.config.pricing.step)}.</p>
            <p>R7: pokrytí &gt; {s.config.pricing.highCoverageDays} dní → snížit směrem k trhu. Nikdy pod unit cost.</p>
            <p>Trh = PriceMarket (všechny týmy, bez DC). Naše cena = SalesReport za posledních 5 dní prodeje.</p>
          </Info>
        }
      >
        <table className="num w-full">
          <thead className="text-left text-sm text-mute">
            <tr>
              <th className="py-1">SKU</th>
              <th>DC</th>
              <th className="text-right">sklad</th>
              <th className="text-right">pokrytí</th>
              <th className="text-right">naše</th>
              <th className="text-right">trh ⌀ / min / max</th>
              <th className="text-right">unit cost</th>
              <th className="text-right">návrh VK32</th>
            </tr>
          </thead>
          <tbody>
            {a.pricing.map((p) => (
              <tr key={p.sku} className="border-t border-line/60">
                <td className="py-1.5 font-semibold">{skuLabel(p.sku)}</td>
                <td>{p.dcs.join(', ') || '–'}</td>
                <td className="text-right">{fmtNum(p.coverage?.stock ?? 0)}</td>
                <td className="text-right">{p.coverage ? (p.coverage.days === null || !Number.isFinite(p.coverage.days) ? '∞' : fmtNum(p.coverage.days, 1)) : '–'}</td>
                <td className="text-right">{fmtPrice(p.ourPrice)}</td>
                <td className="text-right text-mute">
                  {fmtPrice(p.marketAvg)} / {fmtPrice(p.marketMin)} / {fmtPrice(p.marketMax)}
                </td>
                <td className="text-right text-mute">{fmtPrice(p.unitCost)}</td>
                <td className={cx('text-right', p.action === 'zvýšit' && 'text-good', p.action === 'snížit' && 'text-high')}>
                  {p.recommended !== null ? (
                    <span title={p.reason}>
                      <CopyValue value={p.recommended.toFixed(2)} /> <span className="text-sm">{p.delta! > 0 ? '+' : ''}{fmtPrice(p.delta)}</span>
                    </span>
                  ) : (
                    '–'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel title="Podíl na trhu – poslední 5denní okno">
        {share.length ? (
          <table className="num w-full text-sm">
            <thead className="text-left text-mute">
              <tr>
                <th>SKU</th>
                <th>region</th>
                <th className="text-right">my ks</th>
                <th className="text-right">trh ks</th>
                <th className="text-right">podíl</th>
                <th className="text-right">naše cena</th>
                <th className="text-right">trh cena</th>
              </tr>
            </thead>
            <tbody>
              {share.map((r) => (
                <tr key={r.sku + r.area} className="border-t border-line/60">
                  <td className="py-1">{r.sku}</td>
                  <td>{r.area}</td>
                  <td className="text-right">{fmtNum(r.ours)}</td>
                  <td className="text-right">{fmtNum(r.market)}</td>
                  <td className="text-right font-semibold">{fmtPct(r.share)}</td>
                  <td className="text-right">{fmtPrice(r.ourPrice)}</td>
                  <td className="text-right text-mute">{fmtPrice(r.marketPrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Missing what="PriceMarket" />
        )}
      </Panel>
    </div>
  );
}
