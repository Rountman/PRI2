import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (a.address.startsWith('100.') && /tailscale|utun/i.test(name)) continue; // listed separately
      if (a.address.startsWith('169.254.')) continue;
      out.push(a.address);
    }
  }
  return out;
}

/** mDNS name (Mac: "<LocalHostName>.local"). */
export function mdnsName(): string {
  const h = os.hostname().replace(/\.local$/, '');
  return `${h}.local`;
}

const TAILSCALE_CANDIDATES = ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale', '/usr/local/bin/tailscale', '/opt/homebrew/bin/tailscale'];

function run(cmd: string, args: string[], timeout = 3000): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout }, (err, stdout) => resolve(err ? null : String(stdout)));
    } catch {
      resolve(null);
    }
  });
}

export type TailscaleInfo = { ip: string | null; dnsName: string | null } | null;

/** Never throws: returns null when Tailscale is missing or not running. */
export async function tailscaleInfo(): Promise<TailscaleInfo> {
  for (const bin of TAILSCALE_CANDIDATES) {
    if (bin.startsWith('/') && !fs.existsSync(bin)) continue;
    const ip = await run(bin, ['ip', '-4']);
    if (ip === null) continue;
    const status = await run(bin, ['status', '--json']);
    let dnsName: string | null = null;
    try {
      dnsName = status ? (JSON.parse(status).Self?.DNSName ?? '').replace(/\.$/, '') || null : null;
    } catch {
      /* ignore */
    }
    return { ip: ip.trim().split(/\s+/)[0] || null, dnsName };
  }
  return null;
}
