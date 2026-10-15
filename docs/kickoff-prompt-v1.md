Přečti si CLAUDE.md, hlavně kapitolu 4. Popisuje reálné exporty ze SAP Fiori, které jsou v `fixtures/`, a závěry z cvičné hry.

Cíl: co nejrychleji funkční MVP, které poběží na mém Macu a tým ho uvidí v prohlížeči přes LAN. Během hry do něj přetáhneme xlsx exporty ze SAPu a appka řekne, co dělat dál: konkrétní akce, čísla, T-code.

Postup:
1. V plan mode navrhni strukturu repa a pořadí kroků. Počkej na schválení.
2. Monorepo: Vite + React + Tailwind frontend, Hono + better-sqlite3 backend, sdílené `packages/engine` (čisté funkce, bez I/O). Skript `npm run game` spustí vše na 0.0.0.0 a vypíše LAN URL a Tailscale URL (MagicDNS + 100.x IP, pokud Tailscale běží). Záložní skript `npm run game:share` navíc spustí Cloudflare quick tunnel a vypíše veřejnou URL + QR. K tomu volitelný PIN (viz CLAUDE.md kap. 5).
3. Parsery pro 8 reportů z `fixtures/` (včetně ProcSourcing a PurchaseOrderTracking) (xlsx přes SheetJS + TSV paste), autodetekce podle hlaviček, normalizace podle CLAUDE.md 4.1. Vitest testy s kontrolními součty z 4.5. Musí projít.
4. Analýzy z 4.4 v `packages/engine` + testy na fixtures. Ověř, že vychází závěry z 4.3: jen DC 12, stockout dny, využití výroby ~40–55 %, marže na kus.
5. Akční karty a playbook podle kapitoly 6a: typ `ActionCard`, pravidla R1–R13 jako čisté funkce s testy na fixtures (například R3 musí na cvičných datech hlásit DC 10 a DC 14 bez prodejů, R4 prázdný sklad surovin, BOM dopočtený z cen musí dát Unit Cost 0,91 pro F01 a 2,27 pro F12).
6. UI: Ingest (drag & drop více souborů) + Velín podle layoutu v 6a (lišta fáze kola, max 3 kritické karty, ikona (?) s vysvětlením jako boční panel, odškrtávání sdílené přes SSE) + záložka Strategie. Velké fonty, tmavý režim, čeština.
7. Až potom vzorce z kapitoly 2 (DebtLoading, rating, what-if) + obrazovka „Finance“ s ručním formulářem a kontrolou proti reportované valuaci (CLAUDE.md 4.3). Ověřovací test: čísla z 4.3 → 77 388 994,40.
8. Celou dobu dodržuj kapitolu 6b (zero-code během eventu). Vše, co se může lišit mezi Intro a Extended verzí hry, musí jít změnit v UI, ne v kódu.
9. Na konci každého kroku spusť testy, stručně shrň, co funguje, a vypiš otevřené [OVĚŘIT] body a chybějící reporty.
