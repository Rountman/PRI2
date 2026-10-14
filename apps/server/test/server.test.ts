import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { Store } from '../src/store.ts';

const FIX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures');
const files = fs.readdirSync(FIX).filter((f) => f.endsWith('.xlsx'));

function form(names: string[]) {
  const fd = new FormData();
  for (const n of names) fd.append('files', new File([fs.readFileSync(path.join(FIX, n))], n));
  return fd;
}

async function ingestAll(app: ReturnType<typeof createApp>['app']) {
  const res = await app.request('/api/ingest', { method: 'POST', body: form(files) });
  return (await res.json()) as { results: { ok: boolean; kind?: string; rows?: number }[] };
}

describe('server', () => {
  it('ingests all fixtures in one drop and builds a snapshot', async () => {
    const { app } = createApp(new Store());
    const out = await ingestAll(app);
    expect(out.results).toHaveLength(8);
    expect(out.results.every((r) => r.ok)).toBe(true);
    const st = (await (await app.request('/api/state')).json()) as any;
    expect(st.snapshot.analysis.clock.gameDay).toBe(60);
    expect(st.snapshot.cards.length).toBeGreaterThan(3);
    expect(st.snapshot.critical.length).toBeGreaterThan(0);
    expect(Object.keys(st.imports).sort()).toEqual(['inventory', 'market', 'production', 'purchases', 'sales', 'sourcing', 'summary', 'valuation']);
    expect(st.inventoryGameDay).toBe(60);
  });

  it('re-import is idempotent (upsert by natural key)', async () => {
    const store = new Store();
    const { app } = createApp(store);
    await ingestAll(app);
    const n1 = store.dataset().sales.length;
    await ingestAll(app);
    const ds = store.dataset();
    expect(ds.sales.length).toBe(n1);
    expect(ds.sales.reduce((a, s) => a + s.quantity, 0)).toBe(232372 + 218099 + 213898);
    expect(ds.production).toHaveLength(28);
    expect(store.inventoryHistory()).toHaveLength(2);
  });

  it('unknown file → mapping info; saved profile makes it importable', async () => {
    const { app } = createApp(new Store());
    const text = 'Kolo\tDen\tHodnota\n03\t20\t100';
    const r1 = (await (await app.request('/api/paste', { method: 'POST', body: JSON.stringify({ text }), headers: { 'content-type': 'application/json' } })).json()) as any;
    expect(r1.results[0].ok).toBe(false);
    await app.request('/api/mapping', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ signature: r1.results[0].signature, kind: 'valuation', columns: { round: 'Kolo', step: 'Den', valuation: 'Hodnota' } }),
    });
    const r2 = (await (await app.request('/api/paste', { method: 'POST', body: JSON.stringify({ text }), headers: { 'content-type': 'application/json' } })).json()) as any;
    expect(r2.results[0]).toMatchObject({ ok: true, kind: 'valuation', rows: 1 });
  });

  it('card done state is shared', async () => {
    const { app } = createApp(new Store());
    await ingestAll(app);
    await app.request(`/api/cards/${encodeURIComponent('R3:DC10')}`, { method: 'POST', body: JSON.stringify({ done: true }), headers: { 'content-type': 'application/json' } });
    const st = (await (await app.request('/api/state')).json()) as any;
    expect(st.snapshot.cards.find((c: any) => c.id === 'R3:DC10').done).toBe(true);
  });

  it('PIN protects API; login sets cookie', async () => {
    const { app } = createApp(new Store(), { pin: '1234' });
    expect((await app.request('/api/state')).status).toBe(401);
    expect((await app.request('/api/events')).status).toBe(401);
    expect(((await (await app.request('/api/auth')).json()) as any).required).toBe(true);
    const bad = await app.request('/api/login', { method: 'POST', body: JSON.stringify({ pin: '0000' }), headers: { 'content-type': 'application/json' } });
    expect(bad.status).toBe(401);
    const ok = await app.request('/api/login', { method: 'POST', body: JSON.stringify({ pin: '1234' }), headers: { 'content-type': 'application/json' } });
    const cookie = ok.headers.get('set-cookie')!.split(';')[0];
    expect((await app.request('/api/state', { headers: { cookie } })).status).toBe(200);
  });

  it('config preset switch + override; clock override changes phase', async () => {
    const { app } = createApp(new Store());
    await ingestAll(app);
    const j = { 'content-type': 'application/json' };
    await app.request('/api/config/preset', { method: 'POST', body: JSON.stringify({ preset: 'extended' }), headers: j });
    let st = (await (await app.request('/api/state')).json()) as any;
    expect(st.config.preset).toBe('extended');
    expect(st.config.initial.loan).toBe(8_000_000);
    expect(st.snapshot.warnings.map((w: any) => w.id)).toContain('initial-stock');
    await app.request('/api/clock', { method: 'PUT', body: JSON.stringify({ betweenRounds: true }), headers: j });
    st = (await (await app.request('/api/state')).json()) as any;
    expect(st.snapshot.analysis.clock.phase).toBe('pred');
  });

  it('reset requires confirmation', async () => {
    const store = new Store();
    const { app } = createApp(store);
    await ingestAll(app);
    expect((await app.request('/api/data', { method: 'DELETE' })).status).toBe(400);
    await app.request('/api/data?confirm=SMAZAT', { method: 'DELETE' });
    expect(store.dataset().sales).toHaveLength(0);
  });
});
