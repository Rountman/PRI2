import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ');

export function Panel({ title, right, children, className }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-xl border border-line bg-panel p-4', className)}>
      {(title || right) && (
        <header className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-mute">{title}</h2>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function Badge({ children, tone = 'mid', className }: { children: ReactNode; tone?: 'crit' | 'high' | 'mid' | 'good' | 'accent' | 'none'; className?: string }) {
  const tones = {
    crit: 'bg-crit/20 text-red-300 border-crit/40',
    high: 'bg-high/20 text-amber-200 border-high/40',
    mid: 'bg-mid/20 text-slate-300 border-mid/40',
    good: 'bg-good/15 text-emerald-300 border-good/40',
    accent: 'bg-accent/15 text-sky-300 border-accent/40',
    none: 'bg-panel2 text-mute border-line',
  };
  return <span className={cx('inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold', tones[tone], className)}>{children}</span>;
}

// ---------- copy ----------
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  // LAN over plain http: clipboard API is unavailable → legacy fallback
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  return ok;
}

export function CopyValue({ label, value, display, className }: { label?: string; value: string; display?: string; className?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        setOk(await copyText(value));
        setTimeout(() => setOk(false), 1200);
      }}
      className={cx('group inline-flex items-center gap-2 rounded-md border border-line bg-panel2 px-2 py-1 text-sm hover:border-accent', className)}
      title={`Kopírovat ${value}`}
    >
      {label && <span className="text-mute">{label}</span>}
      <span className="num font-mono font-semibold">{display ?? value}</span>
      <span className={cx('text-xs', ok ? 'text-good' : 'text-mute group-hover:text-accent')}>{ok ? '✓' : '⧉'}</span>
    </button>
  );
}

// ---------- side panel (never modal) ----------
type PanelContent = { title: string; body: ReactNode } | null;
const SidePanelCtx = createContext<{ open: (c: PanelContent) => void; current: PanelContent }>({ open: () => {}, current: null });
export const useSidePanel = () => useContext(SidePanelCtx);

export function SidePanelProvider({ children }: { children: ReactNode }) {
  const [current, open] = useState<PanelContent>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && open(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <SidePanelCtx.Provider value={{ open, current }}>
      <div className={cx('transition-[padding]', current && 'xl:pr-[30rem]')}>{children}</div>
      {current && (
        <aside className="fixed bottom-0 right-0 top-0 z-30 w-full max-w-[30rem] overflow-y-auto border-l border-line bg-panel p-5 shadow-2xl">
          <div className="mb-4 flex items-start justify-between gap-3">
            <h3 className="text-lg font-bold">{current.title}</h3>
            <button onClick={() => open(null)} className="rounded-md px-2 text-2xl leading-none text-mute hover:text-ink" title="Zavřít (Esc)">
              ×
            </button>
          </div>
          {current.body}
        </aside>
      )}
    </SidePanelCtx.Provider>
  );
}

/** (?) icon: opens an explanation in the side panel. */
export function Info({ title, children }: { title: string; children: ReactNode }) {
  const { open } = useSidePanel();
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        open({ title, body: <div className="space-y-3 text-mute">{children}</div> });
      }}
      className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded-full border border-line text-xs font-bold text-mute hover:border-accent hover:text-accent"
      title="Proč / odkud to je"
    >
      ?
    </button>
  );
}

export function useNow(intervalMs = 10_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function ageLabel(iso: string | undefined, now: number): string {
  if (!iso) return 'nenahráno';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${Math.round(s / 3600)} h`;
}

export function ageTone(iso: string | undefined, now: number, cfg: { green: number; orange: number }): 'good' | 'high' | 'crit' | 'none' {
  if (!iso) return 'none';
  const s = (now - Date.parse(iso)) / 1000;
  return s < cfg.green ? 'good' : s < cfg.orange ? 'high' : 'crit';
}
