import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { Store } from './store.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');

export type ServerHandle = { port: number; close: () => void };

export function startServer(opts: { port?: number; dbPath?: string; pin?: string } = {}): Promise<ServerHandle> {
  const port = opts.port ?? Number(process.env.PORT ?? 4000);
  const dbPath = opts.dbPath ?? process.env.DB_PATH ?? path.join(repo, 'data', 'copilot.sqlite');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const store = new Store(dbPath);
  const { app } = createApp(store, { pin: opts.pin ?? process.env.GAME_PIN, webDist: path.join(repo, 'apps', 'web', 'dist') });
  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
      resolve({ port: info.port, close: () => server.close() });
    });
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  startServer().then(({ port }) => console.log(`ERPsim Copilot API na http://0.0.0.0:${port}`));
}
