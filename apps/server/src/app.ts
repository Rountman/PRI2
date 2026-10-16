import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { streamSSE } from 'hono/streaming';
import { PRESETS, type PresetName } from '@copilot/config';
import {
  buildSnapshot,
  isKnown,
  parseNumber,
  parseReport,
  REPORT_KINDS,
  SPECS,
  type ClockOverride,
  type FinanceSnapshot,
  type MappingProfile,
  type ReportKind,
  type Snapshot,
} from '@copilot/engine';
import { Store } from './store.ts';

export type AppOptions = { pin?: string; webDist?: string };

type Listener = (version: number) => void;

export function createApp(store: Store, opts: AppOptions = {}) {
  const app = new Hono();
  const listeners = new Set<Listener>();
  let version = 1;
  // one snapshot per viewer phase (auto / pred-hrou / kolo / mezi-koly) – phase is per viewer, not shared
  let cache = new Map<string, { version: number; snap: Snapshot }>();

  const changed = () => {
    version++;
    cache = new Map();
    for (const l of listeners) l(version);
  };

  const PHASES = ['pred-hrou', 'kolo', 'mezi-koly'];
  const snapshot = (viewerPhase?: string | null): Snapshot => {
    const phase = viewerPhase && PHASES.includes(viewerPhase) ? (viewerPhase as ClockOverride['phase']) : null;
    const key = phase ?? 'auto';
    const hit = cache.get(key);
    if (hit && hit.version === version) return hit.snap;
    // shared part of the clock override = only the game day; the phase comes from the viewer
    const shared = store.clock();
    const snap = buildSnapshot(store.dataset(), store.config(), { clock: { gameDay: shared.gameDay ?? null, phase }, done: store.done() });
    cache.set(key, { version, snap });
    return snap;
  };

  // ---------- PIN ----------
  const pin = () => opts.pin || store.getSetting<string>('pin', '');
  const token = (p: string) => createHash('sha256').update(`erpsim-copilot:${p}`).digest('hex').slice(0, 32);

  app.get('/api/auth', (c) => c.json({ required: !!pin(), ok: !pin() || getCookie(c, 'copilot_pin') === token(pin()) }));
  app.post('/api/login', async (c) => {
    const { pin: p } = await c.req.json<{ pin: string }>();
    if (!pin() || p === pin()) {
      if (pin()) setCookie(c, 'copilot_pin', token(pin()), { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 60 * 60 * 24 * 7 });
      return c.json({ ok: true });
    }
    return c.json({ ok: false, error: 'Špatný PIN' }, 401);
  });
  app.use('/api/*', async (c, next) => {
    if (!pin() || getCookie(c, 'copilot_pin') === token(pin())) return next();
    return c.json({ error: 'PIN required' }, 401);
  });

  // ---------- state ----------
  app.get('/api/state', (c) => {
    const snap = snapshot(c.req.query('phase'));
    return c.json({
      version,
      serverTime: new Date().toISOString(),
      snapshot: snap,
      imports: store.latestImports(),
      importLog: store.imports(30),
      config: store.config(),
      configOverride: store.configOverride(),
      presets: Object.keys(PRESETS),
      clock: store.clock(),
      inventoryGameDay: store.getSetting<number | null>('inventoryGameDay', null),
      finance: store.finance(),
      reports: REPORT_KINDS.map((k) => ({ kind: k, label: SPECS[k].label, fiori: SPECS[k].fiori, columns: SPECS[k].columns })),
      pinEnabled: !!pin(),
    });
  });

  app.get('/api/events', (c) =>
    streamSSE(c, async (stream) => {
      let alive = true;
      const l: Listener = (v) => void stream.writeSSE({ event: 'state', data: String(v) }).catch(() => (alive = false));
      listeners.add(l);
      stream.onAbort(() => {
        alive = false;
        listeners.delete(l);
      });
      await stream.writeSSE({ event: 'state', data: String(version) });
      while (alive) {
        await stream.sleep(20_000);
        await stream.writeSSE({ event: 'ping', data: String(Date.now()) }).catch(() => (alive = false));
      }
      listeners.delete(l);
    }),
  );

  // ---------- ingest ----------
  type IngestOut =
    | { filename: string; ok: true; kind: ReportKind; label: string; rows: number; warnings: string[] }
    | { filename: string; ok: false; headers: string[]; signature: string; sample: unknown[][]; warnings: string[] };

  const ingestOne = (input: ArrayBuffer | string, filename: string, gameDay: number | null, forceKind?: ReportKind): IngestOut => {
    const cfg = store.config();
    const r = parseReport(input, { roundLength: cfg.roundLength, profiles: store.profiles(), forceKind });
    if (!isKnown(r)) return { filename, ok: false, headers: r.headers, signature: r.signature, sample: r.sample, warnings: r.warnings };
    const log = store.ingest(r, { filename, gameDay: r.kind === 'inventory' ? gameDay : null });
    return { filename, ok: true, kind: r.kind, label: SPECS[r.kind].label, rows: log.rows, warnings: r.warnings };
  };

  app.post('/api/ingest', async (c) => {
    const body = await c.req.parseBody({ all: true });
    const files = ([] as unknown[]).concat(body['files'] ?? body['file'] ?? []).filter((f): f is File => typeof f === 'object' && f !== null && 'arrayBuffer' in f);
    const gameDay = body['gameDay'] ? Number(body['gameDay']) : null;
    const results: IngestOut[] = [];
    for (const f of files) results.push(ingestOne(await f.arrayBuffer(), f.name, gameDay));
    if (results.some((r) => r.ok)) changed();
    return c.json({ results });
  });

  app.post('/api/paste', async (c) => {
    const { text, gameDay, kind } = await c.req.json<{ text: string; gameDay?: number | null; kind?: ReportKind }>();
    const r = ingestOne(text ?? '', 'vloženo (paste)', gameDay ?? null, kind);
    if (r.ok) changed();
    return c.json({ results: [r] });
  });

  app.post('/api/mapping', async (c) => {
    const p = await c.req.json<MappingProfile>();
    if (!p.signature || !REPORT_KINDS.includes(p.kind)) return c.json({ error: 'invalid profile' }, 400);
    store.saveProfile(p);
    return c.json({ ok: true });
  });

  app.put('/api/inventory-day', async (c) => {
    const { gameDay } = await c.req.json<{ gameDay: number }>();
    store.setInventoryGameDay(Number(gameDay));
    changed();
    return c.json({ ok: true });
  });

  // ---------- cards ----------
  app.post('/api/cards/:id', async (c) => {
    const { done } = await c.req.json<{ done: boolean }>();
    store.setDone(decodeURIComponent(c.req.param('id')), !!done);
    changed();
    return c.json({ ok: true });
  });

  // ---------- settings ----------
  app.put('/api/config', async (c) => {
    const override = await c.req.json();
    store.setSetting('config', override);
    changed();
    return c.json({ ok: true, config: store.config() });
  });
  app.post('/api/config/preset', async (c) => {
    const { preset } = await c.req.json<{ preset: PresetName }>();
    if (!(preset in PRESETS)) return c.json({ error: 'unknown preset' }, 400);
    store.setSetting('config', { preset });
    changed();
    return c.json({ ok: true, config: store.config() });
  });
  app.put('/api/clock', async (c) => {
    // shared: only the game day override. The phase is per viewer (GET /api/state?phase=…).
    const ov = await c.req.json<ClockOverride>();
    store.setSetting('clock', { gameDay: ov.gameDay || null });
    changed();
    return c.json({ ok: true });
  });
  app.put('/api/pin', async (c) => {
    if (opts.pin) return c.json({ error: 'PIN je nastavený přes GAME_PIN' }, 400);
    const { pin: p } = await c.req.json<{ pin: string }>();
    store.setSetting('pin', p || null);
    if (p) setCookie(c, 'copilot_pin', token(p), { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 60 * 60 * 24 * 7 });
    return c.json({ ok: true });
  });

  // ---------- finance ----------
  app.post('/api/finance', async (c) => {
    const b = await c.req.json<Record<string, unknown>>();
    const n = (k: string) => parseNumber(b[k]) ?? 0;
    const f: FinanceSnapshot = {
      gameDay: n('gameDay'),
      cash: n('cash'),
      receivables: n('receivables'),
      payables: Math.abs(n('payables')),
      loan: Math.abs(n('loan')),
      netIncome: n('netIncome'),
      setupSpend: Math.abs(n('setupSpend')),
      roundsPlayed: n('roundsPlayed'),
    };
    store.addFinance(f);
    changed();
    return c.json({ ok: true, finance: f });
  });

  app.delete('/api/data', (c) => {
    if (c.req.query('confirm') !== 'SMAZAT') return c.json({ error: 'confirm=SMAZAT required' }, 400);
    store.resetData();
    changed();
    return c.json({ ok: true });
  });

  // ---------- static web build (SPA) ----------
  if (opts.webDist && fs.existsSync(opts.webDist)) {
    const root = path.resolve(opts.webDist);
    const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' };
    app.get('*', (c) => {
      const rel = decodeURIComponent(new URL(c.req.url).pathname);
      let file = path.join(root, rel);
      if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
      const ext = path.extname(file);
      return c.body(fs.readFileSync(file), 200, {
        'Content-Type': types[ext] ?? 'application/octet-stream',
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
      });
    });
  }

  return { app, changed, snapshot };
}
