import type { GameConfig } from '@copilot/config';
import type { ClockOverride, ColumnSpec, FinanceSnapshot, ReportKind, Snapshot } from '@copilot/engine';

export type ImportLog = { id: number; report: ReportKind; filename: string; rows: number; gameDay: number | null; importedAt: string; warnings: string[] };

export type StateResponse = {
  version: number;
  serverTime: string;
  snapshot: Snapshot;
  imports: Partial<Record<ReportKind, ImportLog>>;
  importLog: ImportLog[];
  config: GameConfig;
  configOverride: Record<string, unknown>;
  presets: string[];
  clock: ClockOverride;
  inventoryGameDay: number | null;
  finance: FinanceSnapshot[];
  reports: { kind: ReportKind; label: string; fiori: string; columns: ColumnSpec[] }[];
  pinEnabled: boolean;
};

export type IngestResult =
  | { filename: string; ok: true; kind: ReportKind; label: string; rows: number; warnings: string[] }
  | { filename: string; ok: false; headers: string[]; signature: string; sample: unknown[][]; warnings: string[] };

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'same-origin', ...init });
  if (res.status === 401) throw new AuthError();
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

export class AuthError extends Error {
  constructor() {
    super('PIN required');
  }
}

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const api = {
  auth: () => req<{ required: boolean; ok: boolean }>('/api/auth'),
  login: (pin: string) => req<{ ok: boolean }>('/api/login', json('POST', { pin })),
  state: () => req<StateResponse>('/api/state'),
  ingest: (files: File[], gameDay?: number | null) => {
    const fd = new FormData();
    for (const f of files) fd.append('files', f, f.name);
    if (gameDay) fd.append('gameDay', String(gameDay));
    return req<{ results: IngestResult[] }>('/api/ingest', { method: 'POST', body: fd });
  },
  paste: (text: string, gameDay?: number | null, kind?: ReportKind) => req<{ results: IngestResult[] }>('/api/paste', json('POST', { text, gameDay, kind })),
  saveMapping: (p: { signature: string; kind: ReportKind; columns: Record<string, string> }) => req('/api/mapping', json('POST', p)),
  setDone: (id: string, done: boolean) => req(`/api/cards/${encodeURIComponent(id)}`, json('POST', { done })),
  setConfig: (override: unknown) => req('/api/config', json('PUT', override)),
  setPreset: (preset: string) => req('/api/config/preset', json('POST', { preset })),
  setClock: (c: ClockOverride) => req('/api/clock', json('PUT', c)),
  setInventoryDay: (gameDay: number) => req('/api/inventory-day', json('PUT', { gameDay })),
  setPin: (pin: string) => req('/api/pin', json('PUT', { pin })),
  saveFinance: (f: Record<string, unknown>) => req('/api/finance', json('POST', f)),
  reset: () => req('/api/data?confirm=SMAZAT', { method: 'DELETE' }),
};
