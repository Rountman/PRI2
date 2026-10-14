// npm run game        → build web, start server on 0.0.0.0, print LAN + Tailscale URLs and QR codes
// npm run game:share  → the same + Cloudflare quick tunnel (public https URL) for isolated event Wi-Fi
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import qrcode from 'qrcode-terminal';
import { startServer } from '../apps/server/src/index.ts';
import { lanAddresses, mdnsName, tailscaleInfo } from './net.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const share = process.argv.includes('--share');
const skipBuild = process.argv.includes('--no-build');
const port = Number(process.env.PORT ?? 4000);

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const qr = (url: string) => qrcode.generate(url, { small: true });

if (!skipBuild) {
  console.log('▶ Builduji web…');
  const b = spawnSync('npm run build -w @copilot/web', { cwd: root, stdio: 'inherit', shell: true });
  if (b.status !== 0) {
    console.error('Build webu selhal.');
    process.exit(1);
  }
}

const server = await startServer({ port });
console.log(`\n${green('●')} ${bold('ERPsim Copilot běží')} – port ${port}${process.env.GAME_PIN ? ' · PIN zapnutý (GAME_PIN)' : ''}\n`);
console.log(`  Tento počítač:  http://localhost:${port}`);
console.log(`  mDNS:           http://${mdnsName()}:${port}`);
const lan = lanAddresses();
for (const ip of lan) console.log(`  LAN:            http://${ip}:${port}`);

const ts = await tailscaleInfo();
let primary = lan[0] ? `http://${lan[0]}:${port}` : `http://localhost:${port}`;
if (ts?.ip) {
  if (ts.dnsName) console.log(`  Tailscale:      ${bold(`http://${ts.dnsName}:${port}`)}`);
  console.log(`  Tailscale IP:   http://${ts.ip}:${port}`);
  primary = ts.dnsName ? `http://${ts.dnsName}:${port}` : `http://${ts.ip}:${port}`;
} else {
  console.log(yellow('  Tailscale:      neběží nebo není nainstalovaný – pokračuji jen s LAN.'));
}
console.log(`\nQR (${primary}):`);
qr(primary);

if (share) {
  const cf = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  let found = false;
  const scan = (buf: Buffer) => {
    const m = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && !found) {
      found = true;
      console.log(`\n${green('●')} ${bold('Veřejná adresa (Cloudflare quick tunnel):')} ${bold(m[0])}`);
      if (!process.env.GAME_PIN) console.log(yellow('  Tip: veřejná URL → nastav PIN (GAME_PIN=1234 npm run game:share nebo v Nastavení).'));
      qr(m[0]);
    }
  };
  cf.stdout.on('data', scan);
  cf.stderr.on('data', scan);
  cf.on('error', () => {
    console.log(yellow('\n  cloudflared není nainstalovaný → brew install cloudflared'));
    console.log('  Pokračuji jen v LAN / Tailscale režimu.');
  });
  const stop = () => {
    cf.kill();
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
