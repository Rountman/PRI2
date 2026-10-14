import { useState, type DragEvent } from 'react';
import type { ReportKind } from '@copilot/engine';
import { api, type IngestResult, type StateResponse } from '../api.ts';
import { ageLabel, ageTone, Badge, cx, Panel, useNow } from '../components/ui.tsx';

type Unknown = Extract<IngestResult, { ok: false }> & { source: File | string };

function Mapping({ s, u, onDone }: { s: StateResponse; u: Unknown; onDone: (r: IngestResult[]) => void }) {
  const [kind, setKind] = useState<ReportKind>(s.reports[0].kind);
  const spec = s.reports.find((r) => r.kind === kind)!;
  const [cols, setCols] = useState<Record<string, string>>({});
  const missing = spec.columns.filter((c) => c.required && !cols[c.field]);
  const save = async () => {
    await api.saveMapping({ signature: u.signature, kind, columns: cols });
    const res = typeof u.source === 'string' ? await api.paste(u.source) : await api.ingest([u.source]);
    onDone(res.results);
  };
  return (
    <div className="space-y-3 rounded-xl border border-high/50 bg-high/5 p-4">
      <div>
        <b>{u.filename}</b>: neznámé hlavičky – přiřaď sloupce. Profil se uloží a příště se soubor pozná sám.
      </div>
      <div className="text-sm text-mute">Hlavičky: {u.headers.join(' · ') || '–'}</div>
      <label className="flex items-center gap-2">
        Typ reportu
        <select className="rounded-md border border-line bg-panel2 px-2 py-1" value={kind} onChange={(e) => (setKind(e.target.value as ReportKind), setCols({}))}>
          {s.reports.map((r) => (
            <option key={r.kind} value={r.kind}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-2 sm:grid-cols-2">
        {spec.columns.map((c) => (
          <label key={c.field} className="flex items-center justify-between gap-2 text-sm">
            <span>
              {c.header} {c.required && <span className="text-crit">*</span>}
            </span>
            <select
              className="w-48 rounded-md border border-line bg-panel2 px-2 py-1"
              value={cols[c.field] ?? ''}
              onChange={(e) => setCols({ ...cols, [c.field]: e.target.value })}
            >
              <option value="">—</option>
              {u.headers.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <button disabled={missing.length > 0} onClick={() => void save()} className="rounded-lg bg-accent px-4 py-2 font-semibold text-slate-950 disabled:opacity-40">
        Uložit profil a importovat
      </button>
    </div>
  );
}

export function Ingest({ s }: { s: StateResponse }) {
  const now = useNow(5000);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<IngestResult[]>([]);
  const [unknown, setUnknown] = useState<Unknown[]>([]);
  const [text, setText] = useState('');
  const [invDay, setInvDay] = useState<string>('');
  const dataDay = s.snapshot.analysis.clock.gameDay || null;

  const handle = (res: IngestResult[], sources: (File | string)[]) => {
    setResults(res);
    setUnknown(res.flatMap((r, i) => (r.ok ? [] : [{ ...r, source: sources[i] }])));
  };

  const upload = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    try {
      handle((await api.ingest(files, invDay ? Number(invDay) : null)).results, files);
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    void upload([...e.dataTransfer.files]);
  };

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <div className="space-y-4">
        <label
          onDragOver={(e) => (e.preventDefault(), setDrag(true))}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          className={cx('flex min-h-56 cursor-pointer flex-col items-center justify-center rounded-2xl border-4 border-dashed p-8 text-center', drag ? 'border-accent bg-accent/10' : 'border-line bg-panel')}
        >
          <div className="text-3xl font-bold">{busy ? 'Nahrávám…' : 'Přetáhni sem xlsx exporty'}</div>
          <div className="mt-2 text-mute">víc souborů najednou · typ reportu se pozná podle hlaviček · nebo klikni a vyber</div>
          <input type="file" multiple accept=".xlsx,.xls,.csv,.tsv,.txt" className="hidden" onChange={(e) => void upload([...(e.target.files ?? [])])} />
        </label>

        <Panel title="Herní den pro InventoryReport">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-mute">Inventory nemá datum. Bez zadání se použije poslední den z dat ({dataDay ?? '–'}).</span>
            <input
              type="number"
              min={1}
              placeholder={String(dataDay ?? '')}
              value={invDay}
              onChange={(e) => setInvDay(e.target.value)}
              className="w-24 rounded-md border border-line bg-panel2 px-2 py-1"
            />
            {s.inventoryGameDay !== null && (
              <span>
                aktuální sklad je ze dne <b>{s.inventoryGameDay}</b>
                {invDay && Number(invDay) !== s.inventoryGameDay && (
                  <button className="ml-2 rounded-md border border-line px-2 py-0.5 hover:border-accent" onClick={() => void api.setInventoryDay(Number(invDay))}>
                    opravit na {invDay}
                  </button>
                )}
              </span>
            )}
          </div>
        </Panel>

        <Panel title="Vložit tabulku (Cmd+A / Cmd+C ve Fiori)">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder="Sem vlož zkopírovanou tabulku včetně hlavičky…"
            className="num w-full rounded-lg border border-line bg-panel2 p-2 font-mono text-sm"
          />
          <button
            disabled={!text.trim() || busy}
            onClick={async () => {
              setBusy(true);
              try {
                handle((await api.paste(text, invDay ? Number(invDay) : null)).results, [text]);
                setText('');
              } finally {
                setBusy(false);
              }
            }}
            className="mt-2 rounded-lg bg-accent px-4 py-2 font-semibold text-slate-950 disabled:opacity-40"
          >
            Importovat vložený text
          </button>
        </Panel>

        {results.length > 0 && (
          <Panel title="Výsledek importu">
            <ul className="space-y-2">
              {results.map((r, i) => (
                <li key={i} className="text-sm">
                  {r.ok ? <Badge tone="good">✓ {r.label}</Badge> : <Badge tone="high">? neznámý</Badge>} <b>{r.filename}</b>
                  {r.ok && <span className="text-mute"> – {r.rows} řádků</span>}
                  {r.warnings.map((w, j) => (
                    <div key={j} className="ml-4 text-high">
                      {w}
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          </Panel>
        )}
        {unknown.map((u) => (
          <Mapping key={u.signature + u.filename} s={s} u={u} onDone={(r) => handle(r, [u.source])} />
        ))}
      </div>

      <Panel title="Reporty a stáří dat">
        <table className="w-full text-sm">
          <tbody>
            {s.reports.map((r) => {
              const imp = s.imports[r.kind];
              const tone = ageTone(imp?.importedAt, now, s.config.dataAgeSec);
              return (
                <tr key={r.kind} className="border-b border-line/60">
                  <td className="py-2">
                    <div className="font-semibold">{r.label}</div>
                    <div className="text-xs text-mute">Fiori: {r.fiori}</div>
                  </td>
                  <td className="text-right">
                    <Badge tone={tone}>{tone === 'good' ? '🟢' : tone === 'high' ? '🟠' : '🔴'} {ageLabel(imp?.importedAt, now)}</Badge>
                    {imp && <div className="text-xs text-mute">{imp.rows} ř. · den {imp.gameDay ?? '–'}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <h3 className="mb-1 mt-4 text-sm font-semibold uppercase tracking-wider text-mute">Poslední importy</h3>
        <ul className="max-h-64 space-y-0.5 overflow-y-auto text-xs text-mute">
          {s.importLog.map((l) => (
            <li key={l.id}>
              {new Date(l.importedAt).toLocaleTimeString('cs-CZ')} · {l.report} · {l.filename} · {l.rows} ř.
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
