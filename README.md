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

## Během hry (jedna obrazovka)

1. **Před hrou** (bez dat): startovní checklist – sortiment, recept, VK32 ceny, setup, MD61 1. cyklu, MRP. Hodnoty se kopírují kliknutím.
2. **Drop xlsx** nahoře: InventoryReport (ZMB52), SalesReport (ZVA05), PriceMarket (ZMARKET). Čipy vedle ukazují stáří dat.
3. **Co udělat teď**: max 5 karet (max 2 kritické). (?) otevře boční panel s důvodem, ✓ odškrtne kartu celému týmu.
4. **MD61** a **VK32** tabulky ve tvaru SAP formulářů – klik na číslo = kopírovat.
5. **Rozšířené ▸**: další importy + ruční finance, investice (what-if), recept, marketing, strategie, nastavení (preset, sortiment, startovní ceny, všechny parametry).

Zadání a [OVĚŘIT] body: [CLAUDE.md](CLAUDE.md).

## Struktura

```
config/            herní parametry: typy (game.ts), presety extended (default) / intro (testy)
packages/engine/   čisté funkce: parsery, analýzy, BOM, finance, v2/ (poptávka, MD61, VK32, investice, alerty, checklist)
apps/server/       Hono + better-sqlite3 + SSE, PIN
apps/web/          Vite + React + Tailwind – jedna obrazovka + drawer Rozšířené
scripts/           npm run game / game:share / dev
fixtures/          exporty z cvičné hry (tým GG)
```
