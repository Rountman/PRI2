import Database from 'better-sqlite3';
import { resolveConfig, type DeepPartial, type GameConfig } from '@copilot/config';
import {
  emptyDataset,
  latestGameDay,
  SPECS,
  type ClockOverride,
  type Dataset,
  type FinanceSnapshot,
  type MappingProfile,
  type ParseResult,
  type ReportKind,
} from '@copilot/engine';

export type ImportLog = {
  id: number;
  report: ReportKind;
  filename: string;
  rows: number;
  gameDay: number | null;
  importedAt: string;
  warnings: string[];
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS rows (report TEXT NOT NULL, key TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (report, key));
CREATE TABLE IF NOT EXISTS imports (id INTEGER PRIMARY KEY AUTOINCREMENT, report TEXT, filename TEXT, rows INTEGER, game_day INTEGER, imported_at TEXT, warnings TEXT);
CREATE TABLE IF NOT EXISTS inventory_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, game_day INTEGER, imported_at TEXT, data TEXT);
CREATE TABLE IF NOT EXISTS card_state (id TEXT PRIMARY KEY, done INTEGER NOT NULL, at TEXT);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS finance_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, game_day INTEGER, saved_at TEXT, data TEXT);
CREATE TABLE IF NOT EXISTS mapping_profiles (signature TEXT PRIMARY KEY, kind TEXT, columns TEXT);
CREATE TABLE IF NOT EXISTS po_first_seen (order_no TEXT PRIMARY KEY, game_day INTEGER);
`;

/** All persistence. Synchronous (better-sqlite3) – data is tiny. */
export class Store {
  db: Database.Database;
  constructor(path = ':memory:') {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  // ---------- settings ----------
  getSetting<T>(key: string, fallback: T): T {
    const r = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return r ? (JSON.parse(r.value) as T) : fallback;
  }
  setSetting(key: string, value: unknown) {
    if (value === undefined || value === null) this.db.prepare('DELETE FROM settings WHERE key = ?').run(key);
    else this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
  }

  configOverride(): DeepPartial<GameConfig> {
    return this.getSetting<DeepPartial<GameConfig>>('config', {});
  }
  config(): GameConfig {
    return resolveConfig(this.configOverride());
  }
  clock(): ClockOverride {
    return this.getSetting<ClockOverride>('clock', {});
  }

  // ---------- ingest ----------
  ingest(r: ParseResult, meta: { filename: string; gameDay?: number | null; now?: string }): ImportLog {
    const now = meta.now ?? new Date().toISOString();
    const spec = SPECS[r.kind];
    const tx = this.db.transaction(() => {
      if (spec.mode === 'snapshot') this.db.prepare('DELETE FROM rows WHERE report = ?').run(r.kind);
      const ins = this.db.prepare('INSERT INTO rows (report, key, data) VALUES (?, ?, ?) ON CONFLICT(report, key) DO UPDATE SET data = excluded.data');
      r.rows.forEach((row, i) => ins.run(r.kind, r.keys[i], JSON.stringify(row)));
    });
    tx();
    // game day: explicit (operator) → latest from data
    const gameDay = meta.gameDay ?? latestGameDay(this.dataset()) ?? null;
    if (r.kind === 'inventory') {
      this.db.prepare('INSERT INTO inventory_snapshots (game_day, imported_at, data) VALUES (?, ?, ?)').run(gameDay, now, JSON.stringify(r.rows));
      this.setSetting('inventoryGameDay', gameDay);
    }
    if (r.kind === 'purchases' && gameDay !== null) {
      const ins = this.db.prepare('INSERT OR IGNORE INTO po_first_seen (order_no, game_day) VALUES (?, ?)');
      for (const p of r.rows as { order: string }[]) ins.run(p.order, gameDay);
    }
    const info = this.db
      .prepare('INSERT INTO imports (report, filename, rows, game_day, imported_at, warnings) VALUES (?, ?, ?, ?, ?, ?)')
      .run(r.kind, meta.filename, r.rows.length, gameDay, now, JSON.stringify(r.warnings));
    return { id: Number(info.lastInsertRowid), report: r.kind, filename: meta.filename, rows: r.rows.length, gameDay, importedAt: now, warnings: r.warnings };
  }

  setInventoryGameDay(gameDay: number) {
    this.setSetting('inventoryGameDay', gameDay);
    this.db.prepare('UPDATE inventory_snapshots SET game_day = ? WHERE id = (SELECT MAX(id) FROM inventory_snapshots)').run(gameDay);
  }

  imports(limit = 50): ImportLog[] {
    return (this.db.prepare('SELECT * FROM imports ORDER BY id DESC LIMIT ?').all(limit) as any[]).map((r) => ({
      id: r.id,
      report: r.report,
      filename: r.filename,
      rows: r.rows,
      gameDay: r.game_day,
      importedAt: r.imported_at,
      warnings: JSON.parse(r.warnings ?? '[]'),
    }));
  }

  /** Latest import per report kind (for data-age badges). */
  latestImports(): Partial<Record<ReportKind, ImportLog>> {
    const out: Partial<Record<ReportKind, ImportLog>> = {};
    for (const i of this.imports(500)) if (!out[i.report]) out[i.report] = i;
    return out;
  }

  inventoryHistory(): { gameDay: number | null; importedAt: string; rows: unknown[] }[] {
    return (this.db.prepare('SELECT * FROM inventory_snapshots ORDER BY id').all() as any[]).map((r) => ({ gameDay: r.game_day, importedAt: r.imported_at, rows: JSON.parse(r.data) }));
  }

  dataset(): Dataset {
    const ds = emptyDataset();
    const rows = this.db.prepare('SELECT report, data FROM rows ORDER BY rowid').all() as { report: ReportKind; data: string }[];
    for (const r of rows) (ds[r.report] as unknown[]).push(JSON.parse(r.data));
    ds.inventoryGameDay = this.getSetting<number | null>('inventoryGameDay', null);
    for (const r of this.db.prepare('SELECT order_no, game_day FROM po_first_seen').all() as any[]) ds.poFirstSeen[r.order_no] = r.game_day;
    ds.finance = this.finance();
    for (const [k, v] of Object.entries(this.latestImports())) ds.imports[k as ReportKind] = { importedAt: v!.importedAt, gameDay: v!.gameDay };
    return ds;
  }

  // ---------- cards ----------
  done(): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    for (const r of this.db.prepare('SELECT id, done FROM card_state').all() as any[]) out[r.id] = !!r.done;
    return out;
  }
  setDone(id: string, done: boolean) {
    this.db.prepare('INSERT INTO card_state (id, done, at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET done = excluded.done, at = excluded.at').run(id, done ? 1 : 0, new Date().toISOString());
  }

  // ---------- finance ----------
  finance(): FinanceSnapshot[] {
    return (this.db.prepare('SELECT data FROM finance_snapshots ORDER BY id').all() as any[]).map((r) => JSON.parse(r.data));
  }
  addFinance(f: FinanceSnapshot) {
    const savedAt = f.savedAt ?? new Date().toISOString();
    this.db.prepare('INSERT INTO finance_snapshots (game_day, saved_at, data) VALUES (?, ?, ?)').run(f.gameDay, savedAt, JSON.stringify({ ...f, savedAt }));
  }

  // ---------- mapping profiles ----------
  profiles(): MappingProfile[] {
    return (this.db.prepare('SELECT * FROM mapping_profiles').all() as any[]).map((r) => ({ signature: r.signature, kind: r.kind, columns: JSON.parse(r.columns) }));
  }
  saveProfile(p: MappingProfile) {
    this.db
      .prepare('INSERT INTO mapping_profiles (signature, kind, columns) VALUES (?, ?, ?) ON CONFLICT(signature) DO UPDATE SET kind = excluded.kind, columns = excluded.columns')
      .run(p.signature, p.kind, JSON.stringify(p.columns));
  }

  /** Wipe game data (keeps settings and mapping profiles). */
  resetData() {
    this.db.exec('DELETE FROM rows; DELETE FROM imports; DELETE FROM inventory_snapshots; DELETE FROM card_state; DELETE FROM finance_snapshots; DELETE FROM po_first_seen;');
    this.setSetting('inventoryGameDay', null);
    this.setSetting('clock', null);
  }
}
