// npm run dev → API server (watch) + Vite dev server with /api proxy
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const opts = { cwd: root, stdio: 'inherit' as const, shell: true };
const procs = [spawn('npm run dev -w @copilot/server', opts), spawn('npm run dev -w @copilot/web', opts)];
const stop = () => {
  for (const p of procs) p.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
