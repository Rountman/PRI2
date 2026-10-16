import { useState, type DragEvent } from 'react';
import type { Phase, ReportKind } from '@copilot/engine';
import { fmtNum, fmtPct, fmtShort } from '@copilot/engine/format';
import { api, type IngestResult, type StateResponse } from '../api.ts';
import { ageLabel, ageTone, cx, Info, useNow } from './ui.tsx';

/** The 3 inputs of the quick mode (CLAUDE.md kap. 3). */
export const CHIPS: { kind: ReportKind; label: string; tcode: string }[] = [
  { kind: 'inventory', label: 'Sklad', tcode: 'ZMB52' },
  { kind: 'sales', label: 'Prodeje', tcode: 'ZVA05' },
  { kind: 'market', label: 'Trh', tcode: 'ZMARKET' },
];
const DOT = { good: '🟢', high: '🟠', crit: '🔴', none: '⚪' } as const;

export function DataChips({ s }: { s: StateResponse }) {
  const now = useNow(5000);
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="chips">
      {CHIPS.map((c) => {
        const imp = s.imports[c.kind];
        const tone = ageTone(imp?.importedAt, now, s.config.dataAgeSec);
        return (
          <span
            key={c.kind}
            title={`${c.tcode}${imp ? ` · ${imp.filename} · den ${imp.gameDay ?? '–'}` : ' · nenahráno'}`}
            className={cx('inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-sm', tone === 'none' ? 'border-line text-mute' : 'border-line bg-panel2')}
          >
            {DOT[tone]} {c.label}
            {imp && <span className="text-xs text-mute">{ageLabel(imp.importedAt, now)}</span>}
          </span>
        );
      })}
    </div>
  );
}

export function DropZone({ s, onUnknown }: { s: StateResponse; onUnknown: (r: IngestResult[], files: File[]) => void }) {
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const upload = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    try {
      const { results } = await api.ingest(files);
      const ok = results.filter((r) => r.ok);
      const bad = results.filter((r) => !r.ok);
      setMsg(`${ok.length ? `✓ ${ok.map((r) => (r.ok ? r.label : '')).join(', ')}` : ''}${bad.length ? ` · ${bad.length}× neznámý → Rozšířené` : ''}`);
      if (bad.length) onUnknown(results, files);
      setTimeout(() => setMsg(null), 6000);
    } catch (e) {
      setMsg(`Chyba: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <label
      onDragOver={(e) => (e.preventDefault(), setDrag(true))}
      onDragLeave={() => setDrag(false)}
      onDrop={(e: DragEvent) => {
        e.preventDefault();
        setDrag(false);
        void upload([...e.dataTransfer.files]);
      }}
      className={cx('flex min-w-56 cursor-pointer items-center gap-2 rounded-xl border-2 border-dashed px-3 py-1.5', drag ? 'border-accent bg-accent/10' : 'border-line hover:border-accent')}
      title="Přetáhni sem až 3 xlsx (ZMB52, ZVA05, ZMARKET) – typ se pozná podle hlaviček"
    >
      <span className="text-lg">⬆</span>
      <span className="font-semibold">{busy ? 'Nahrávám…' : msg ?? 'Drop xlsx'}</span>
      <input type="file" multiple accept=".xlsx,.xls,.csv,.tsv,.txt" className="hidden" onChange={(e) => void upload([...(e.target.files ?? [])])} />
    </label>
  );
}

const PHASES: { id: Phase | 'auto'; label: string }[] = [
  { id: 'auto', label: 'podle dat' },
  { id: 'pred-hrou', label: 'Před hrou' },
  { id: 'kolo', label: 'Kolo' },
  { id: 'mezi-koly', label: 'Mezi koly' },
];

/** Phase switch – only for this browser; teammates keep their own view. */
export function PhasePicker({ s, phase, setPhase }: { s: StateResponse; phase: Phase | null; setPhase: (p: Phase | null) => void }) {
  const c = s.snapshot.clock;
  return (
    <label className="flex items-center gap-2">
      <span className={cx('rounded-lg px-3 py-1 text-lg font-bold', c.phase === 'pred-hrou' ? 'bg-high/20 text-amber-200' : 'bg-accent/15 text-sky-200')} data-testid="phase">
        {c.label}
      </span>
      <select
        value={phase ?? 'auto'}
        onChange={(e) => setPhase(e.target.value === 'auto' ? null : (e.target.value as Phase))}
        className="rounded-md border border-line bg-panel2 px-1 py-1 text-sm text-mute"
        title="Fáze se určí z dat. Přepnutí platí jen v tvém prohlížeči – ostatním se nezmění."
      >
        {PHASES.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ValuationBadge({ s }: { s: StateResponse }) {
  const h = s.snapshot.header;
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-mute">Valuace</span>
      <b className="num text-2xl" data-testid="valuation">
        {h.valuation !== null ? fmtShort(h.valuation) : '–'}
      </b>
      <span className="font-semibold text-sky-300">({h.rating})</span>
      <Info title="Valuace a rating">
        <p>
          Valuace = ((Profit − Setup) / Kola × 12 + Setup) / (7 % + riziková přirážka). Rating z DebtLoading = Cash + AR − Úvěr − AP.
        </p>
        <p>
          Teď: rating <b className="text-ink">{h.rating}</b>, diskont <b className="text-ink">{fmtPct(h.discount, 2)}</b> ({h.ratingSource === 'finance' ? 'z ručně opsaných financí' : 'výchozí z presetu – start: 2M − 8M = −6M → A−'}).
        </p>
        <p>{h.valuationSource === 'Company-Valuation' ? 'Číslo valuace je z reportu Company-Valuation.' : h.valuationSource === 'finance' ? 'Číslo valuace je spočtené z ručních financí.' : 'Valuace se ukáže po nahrání Company-Valuation nebo opsání financí (Rozšířené).'}</p>
        <p>Počet kol: {fmtNum(s.config.rounds)} (změna v Nastavení).</p>
      </Info>
    </div>
  );
}
