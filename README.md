# ERPsim Copilot

Lokální analytická appka pro ERPsim Manufacturing. Do appky se přetáhnou xlsx exporty z Fiori a ona vrátí konkrétní akce: co udělat, T-code, čísla, proč a dopad na valuaci.

## Spuštění (Mac operátora)

```bash
npm install          # Node 22+; schválené install skripty (better-sqlite3, esbuild) jsou v package.json
npm run game         # build + server na 0.0.0.0:4000, vypíše LAN / Tailscale URL a QR
npm run game:share   # navíc Cloudflare quick tunnel (brew install cloudflared) – veřejná https URL
GAME_PIN=1234 npm run game   # volitelný sdílený PIN
```

Vývoj: `npm run dev` (API s watch + Vite na :5173) · testy: `npm test` · typy: `npm run typecheck`.

Data jsou v `data/copilot.sqlite`. Smazat je jde v Nastavení → „Smazat herní data“ (nastavení zůstanou).

## Během hry

1. **Ingest** (klávesa 2): přetáhni všechny exporty najednou. Typ reportu se pozná podle hlaviček.
2. **Velín** (1): nahoře max. 3 kritické karty, pod nimi další akce podle dopadu. Tlačítko (?) otevře boční panel s daty a postupem v SAPu, ✓ odškrtne kartu pro celý tým.
3. **Finance** (5): jednou za kolo opiš rozvahu. Appka hned ukáže ✅ / ❌ shodu s reportovanou valuací, rating a what-if.
4. **Nastavení** (7): předvolba Intro / Extended a všechny parametry. Během eventu se nesahá do kódu.

Předpoklady a [OVĚŘIT] body: [docs/assumptions.md](docs/assumptions.md).

## Struktura

```
config/            herní parametry (presety intro / extended), návody per T-code
packages/engine/   čisté funkce: parsery, normalizace, analýzy, BOM, finance, pravidla R1–R15
apps/server/       Hono + better-sqlite3 + SSE, PIN
apps/web/          Vite + React + Tailwind + Recharts
scripts/           npm run game / game:share / dev
fixtures/          exporty z cvičné hry (tým GG)
```
