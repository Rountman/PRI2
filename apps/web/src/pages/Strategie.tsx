import type { StateResponse } from '../api.ts';
import { Badge, Panel } from '../components/ui.tsx';
import { PHASES } from './Velin.tsx';

/** Whole playbook, generated from rule metadata (nothing written twice). */
export function Strategie({ s }: { s: StateResponse }) {
  const rules = s.snapshot.rules;
  const current = s.snapshot.analysis.clock.phase;
  const active = new Set(s.snapshot.cards.map((c) => c.ruleId));
  return (
    <div className="space-y-4">
      <Panel title="Jak se vyhrává">
        <div className="space-y-2 text-lg">
          <p>
            Vyhrává nejvyšší <b>Company Valuation</b> = (profit / odehraná kola × 12) ÷ (7 % + riziková přirážka ratingu). Každé euro profitu se násobí zhruba
            12 / (kola × diskont) – při 4 kolech a 10 % je to <b>×30</b>.
          </p>
          <p>
            Ve cvičné hře byla úzkým hrdlem <b>nabídka</b>: prázdný sklad, stojící linka (chyběly suroviny), 8h přestavby a dva nevyužité kanály (DC 10, DC 14).
          </p>
        </div>
      </Panel>
      {PHASES.map((p) => {
        const list = rules.filter((r) => r.phases.includes(p.id));
        return (
          <Panel key={p.id} title={<span className={p.id === current ? 'text-accent' : undefined}>{p.id === current ? '● ' : ''}{p.label}</span>}>
            <div className="grid gap-3 lg:grid-cols-2">
              {list.map((r) => (
                <div key={r.id} className="rounded-lg bg-panel2 p-3">
                  <div className="flex items-center gap-2">
                    <Badge tone="accent">{r.id}</Badge>
                    <b className="text-lg">{r.name}</b>
                    {active.has(r.id) && <Badge tone="high">aktivní karta</Badge>}
                  </div>
                  <p className="mt-1">{r.summary}</p>
                  <p className="mt-1 text-sm text-mute">Proč: {r.why}</p>
                  <p className="mt-1 text-xs text-mute">Potřebuje: {r.needs.join(', ')}</p>
                </div>
              ))}
            </div>
          </Panel>
        );
      })}
    </div>
  );
}
