import { useEffect, useState, type ReactNode } from 'react';
import { api, type StateResponse } from './api.ts';
import { ageLabel, ageTone, Badge, cx, SidePanelProvider, useNow } from './components/ui.tsx';
import { Ceny } from './pages/Ceny.tsx';
import { Finance } from './pages/Finance.tsx';
import { Ingest } from './pages/Ingest.tsx';
import { Nastaveni } from './pages/Nastaveni.tsx';
import { Strategie } from './pages/Strategie.tsx';
import { PhaseBar, ValuationHeadline, Velin } from './pages/Velin.tsx';
import { Vyroba } from './pages/Vyroba.tsx';
import { useLiveState } from './useLiveState.ts';

export type Tab = { id: string; label: string; render: (s: StateResponse) => ReactNode };

export const TABS: Tab[] = [
  { id: 'velin', label: 'Velín', render: (s) => <Velin s={s} /> },
  { id: 'ingest', label: 'Ingest', render: (s) => <Ingest s={s} /> },
  { id: 'ceny', label: 'Ceny', render: (s) => <Ceny s={s} /> },
  { id: 'vyroba', label: 'Výroba', render: (s) => <Vyroba s={s} /> },
  { id: 'finance', label: 'Finance', render: (s) => <Finance s={s} /> },
  { id: 'strategie', label: 'Strategie', render: (s) => <Strategie s={s} /> },
  { id: 'nastaveni', label: 'Nastavení', render: (s) => <Nastaveni s={s} /> },
];

function PinScreen({ onOk }: { onOk: () => void }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  return (
    <div className="flex min-h-screen items-center justify-center">
      <form
        className="w-80 space-y-3 rounded-2xl border border-line bg-panel p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api.login(pin);
            onOk();
          } catch {
            setErr('Špatný PIN');
          }
        }}
      >
        <h1 className="text-2xl font-bold">ERPsim Copilot</h1>
        <input autoFocus type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="PIN týmu" className="w-full rounded-lg border border-line bg-panel2 px-3 py-2 text-xl" />
        {err && <div className="text-crit">{err}</div>}
        <button className="w-full rounded-lg bg-accent py-2 font-bold text-slate-950">Vstoupit</button>
      </form>
    </div>
  );
}

function DataAge({ s }: { s: StateResponse }) {
  const now = useNow(5000);
  const times = Object.values(s.imports).map((i) => i!.importedAt).sort();
  const newest = times.at(-1);
  const tone = ageTone(newest, now, s.config.dataAgeSec);
  return (
    <Badge tone={tone} className="text-sm">
      Data: {tone === 'good' ? '🟢' : tone === 'high' ? '🟠' : '🔴'} {ageLabel(newest, now)}
    </Badge>
  );
}

export function Shell({ s, online, lastOk, initialTab = 'velin' }: { s: StateResponse; online: boolean; lastOk: Date | null; initialTab?: string }) {
  const [tab, setTab] = useState(() => {
    try {
      return localStorage.getItem('copilot.tab') ?? initialTab;
    } catch {
      return initialTab;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('copilot.tab', tab);
    } catch {
      /* private mode */
    }
  }, [tab]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      const i = Number(e.key) - 1;
      if (i >= 0 && i < TABS.length) setTab(TABS[i].id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const current = TABS.find((t) => t.id === tab) ?? TABS[0];
  return (
    <SidePanelProvider>
      {!online && (
        <div className="sticky top-0 z-40 bg-crit px-4 py-1 text-center font-semibold text-white">
          offline – data z {lastOk ? lastOk.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }) : '–'}, zkouším se znovu připojit…
        </div>
      )}
      <header className="sticky top-0 z-20 border-b border-line bg-bg/95 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <h1 className="text-xl font-black tracking-tight">
            ERPsim <span className="text-accent">Copilot</span>
          </h1>
          <PhaseBar s={s} />
          <ValuationHeadline s={s} />
          <DataAge s={s} />
          <Badge tone="mid">{s.config.preset}</Badge>
        </div>
        <nav className="mt-3 flex flex-wrap gap-1">
          {TABS.map((t, i) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cx('rounded-lg px-4 py-1.5 font-semibold', t.id === current.id ? 'bg-panel2 text-ink' : 'text-mute hover:text-ink')}
              title={`klávesa ${i + 1}`}
            >
              <span className="mr-1 text-xs text-mute">{i + 1}</span>
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      <main className="p-4">{current.render(s)}</main>
    </SidePanelProvider>
  );
}

export function App() {
  const live = useLiveState();
  if (live.needPin) return <PinScreen onOk={() => void live.refresh()} />;
  if (!live.state)
    return <div className="flex min-h-screen items-center justify-center text-2xl text-mute">{live.error ? `Server nedostupný: ${live.error}` : 'Načítám…'}</div>;
  return <Shell s={live.state} online={live.online} lastOk={live.lastOk} />;
}
