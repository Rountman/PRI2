import { useEffect, useState, type ReactNode } from 'react';
import type { Phase } from '@copilot/engine';
import { api, type IngestResult, type StateResponse } from './api.ts';
import { Channels, Findings, Plant, Products } from './components/Status.tsx';
import { Md61Table, Vk32Table } from './components/Tables.tsx';
import { DataChips, DropZone, PhasePicker, ValuationBadge } from './components/TopBar.tsx';
import { cx, SidePanelProvider } from './components/ui.tsx';
import { FinanceForm, Investice } from './pages/Finance.tsx';
import { Ingest, type Unknown } from './pages/Ingest.tsx';
import { Marketing } from './pages/Marketing.tsx';
import { Nastaveni } from './pages/Nastaveni.tsx';
import { Recept } from './pages/Recept.tsx';
import { Strategie } from './pages/Strategie.tsx';
import { useLiveState } from './useLiveState.ts';

export type DrawerTab = { id: string; label: string; render: (s: StateResponse, pending: Unknown[]) => ReactNode };

/** "Rozšířené ▸" drawer – everything that is not needed in the heat of the game. */
export const DRAWER_TABS: DrawerTab[] = [
  {
    id: 'importy',
    label: 'Další importy',
    render: (s, pending) => (
      <div className="space-y-4">
        <Ingest s={s} pending={pending} />
        <FinanceForm s={s} />
      </div>
    ),
  },
  { id: 'investice', label: 'Investice', render: (s) => <Investice s={s} /> },
  { id: 'recept', label: 'Recept', render: (s) => <Recept s={s} /> },
  { id: 'marketing', label: 'Marketing', render: (s) => <Marketing s={s} /> },
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

function Drawer({ s, tab, setTab, onClose, pending }: { s: StateResponse; tab: string; setTab: (t: string) => void; onClose: () => void; pending: Unknown[] }) {
  const current = DRAWER_TABS.find((t) => t.id === tab) ?? DRAWER_TABS[0];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <aside className="fixed bottom-0 right-0 top-0 z-30 flex w-full max-w-4xl flex-col border-l border-line bg-bg shadow-2xl" data-testid="drawer">
      <div className="flex items-center gap-1 border-b border-line px-4 py-2">
        <nav className="flex flex-1 flex-wrap gap-1">
          {DRAWER_TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} className={cx('rounded-lg px-3 py-1.5 font-semibold', t.id === current.id ? 'bg-panel2 text-ink' : 'text-mute hover:text-ink')}>
              {t.label}
            </button>
          ))}
        </nav>
        <button onClick={onClose} className="rounded-md px-2 text-2xl leading-none text-mute hover:text-ink" title="Zavřít (Esc)">
          ×
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">{current.render(s, pending)}</div>
    </aside>
  );
}

export function Shell({
  s,
  online,
  lastOk,
  initialDrawer = null,
  phase = null,
  setPhase = () => {},
}: {
  s: StateResponse;
  online: boolean;
  lastOk: Date | null;
  initialDrawer?: string | null;
  phase?: Phase | null;
  setPhase?: (p: Phase | null) => void;
}) {
  const [drawer, setDrawer] = useState<string | null>(initialDrawer);
  const [pending, setPending] = useState<Unknown[]>([]);
  const onUnknown = (res: IngestResult[], files: File[]) => {
    setPending(res.flatMap((r, i) => (r.ok ? [] : [{ ...r, source: files[i] }])));
    setDrawer('importy');
  };
  return (
    <SidePanelProvider>
      {!online && (
        <div className="sticky top-0 z-40 bg-crit px-4 py-1 text-center font-semibold text-white">
          offline – data z {lastOk ? lastOk.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }) : '–'}, zkouším se znovu připojit…
        </div>
      )}
      <header className="sticky top-0 z-20 border-b border-line bg-bg/95 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <h1 className="text-xl font-black tracking-tight">
            ERPsim <span className="text-accent">Copilot</span>
          </h1>
          <PhasePicker s={s} phase={phase} setPhase={setPhase} />
          <ValuationBadge s={s} />
          <DropZone s={s} onUnknown={onUnknown} />
          <DataChips s={s} />
          <button onClick={() => setDrawer(drawer ? null : 'importy')} className="ml-auto rounded-lg border border-line px-4 py-1.5 font-semibold hover:border-accent" data-testid="advanced">
            Rozšířené {drawer ? '◂' : '▸'}
          </button>
        </div>
      </header>
      <main className="space-y-4 p-4">
        <Findings s={s} />
        <Products s={s} />
        <div className="grid gap-4 xl:grid-cols-2">
          <Channels s={s} />
          <Plant s={s} />
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <Md61Table s={s} />
          <Vk32Table s={s} />
        </div>
      </main>
      {drawer && <Drawer s={s} tab={drawer} setTab={setDrawer} onClose={() => setDrawer(null)} pending={pending} />}
    </SidePanelProvider>
  );
}

export function App() {
  const live = useLiveState();
  if (live.needPin) return <PinScreen onOk={() => void live.refresh()} />;
  if (!live.state) return <div className="flex min-h-screen items-center justify-center text-2xl text-mute">{live.error ? `Server nedostupný: ${live.error}` : 'Načítám…'}</div>;
  return <Shell s={live.state} online={live.online} lastOk={live.lastOk} phase={live.phase} setPhase={live.setPhase} />;
}
