# ERPsim Copilot v2 – CLAUDE.md (minimalistická verze)

> Starší podrobný kontext je v `docs/CLAUDE-v1-archiv.md`. **Při rozporu platí tento soubor.**
> Zdroje parametrů: `docs/BIZ_SIM_CUP_2026.pdf` (prezentace soutěže), `docs/JobAid_Manuf_Ext.pdf` (job aid Extended), Participants' Guide kap. 5.

## 0. Cíl v jedné větě
Nejlepší poměr cena/výkon v tlaku soutěže: **nahraj max 3 xlsx → appka řekne, co přesně naťukat do SAPu (MD61, VK32, ZFB50…) a proč.** Všechno ostatní je schované pod tlačítkem **„Rozšířené“**.

## 1. Soutěž a herní verze [JISTÉ – prezentace BIZ SIM CUP 2026]
- Workshop = Manufacturing **Introduction**. **Školní kolo soutěže = Manufacturing Extended.**
- **Výchozí preset appky = `extended`.** Preset `intro` existuje jen kvůli testům nad `fixtures/` (cvičná data jsou z Intro).
- Vyhrává nejvyšší Company Valuation na konci hry. **5 kol** × 20 dní, týden = 5 dní.
- Jsme **tým GG** → materiály v SAPu `GG-F01` … `GG-F16` (prefix v Nastavení `teamCode`, prázdné = zjistí se z dat).
- Role týmu podle prezentace: (1) ceny pro DC10/12/14, (2) plán surovin (MD61 → MD01 → ME59N), (3) marketing, (4) plánování výroby (CO41). Investice: setup, kapacita, splátka úvěru (vše ZFB50).

## 2. Parametry presetu `extended` [JISTÉ – z dokumentů, v `config/presets.ts`]
| Parametr | Hodnota |
|---|---|
| Start: cash / úvěr / stroje / sklad | €2 000 000 / €8 000 000 / €24 000 000 / **prázdný** (ani suroviny) |
| Kapacita | 24 000 ks/den = účet 11000 / 1000. +1 000 ks/den za €1M |
| Setup | 8 h. `SetupTime = 2 + 6×250 000 / (250 000 + bal478000)`. Tabulka: 50k→7 h, 125k→6, 250k→5, 500k→4, 1,25M→3 |
| Lot size | min 16 000, max 48 000, mezi tím zaokrouhleno na 1 000. Změna jen přes MM02 mezi koly a jen se svolením instruktora. Investice ji automaticky nemění |
| Fixní náklady / 5 dní | Labor 20 000, Overhead 15 000, SG&A 40 000, Odpisy budova 1 250, Odpisy stroje 50 000 (roste s kapacitou) = **€126 250 / 5 dní** + úrok |
| Úrok | z ZCK11 příkladu ≈ €2 644,80/den při €8M. Úrok závisí na ratingu a prime rate (může se změnit). Účtuje se týdně |
| Sklad | FG 250 000 krabic (+€500/den za 50k), suroviny 250 000 kg (+€1 000/den za 50k), obaly 750 000 ks (+€100/den za 50k) |
| Dodavatelé | V01, V02. Lead time 1–5 dní, splatnost 20 dní. **Ceny surovin se mění každých 5 dní** |
| Trh / tým / týden [JISTÉ – job aid Extended] | DC10 Hypermarkety €90k (jen 1 kg, cena velmi citlivá, reklama málo, splatnost 20 dní), DC12 Grocery €220k (obě balení, cena citlivá, reklama středně, 10–20 dní), DC14 Independent €130k (jen 500 g, cena středně, reklama hodně, 1–20 dní). Celkem ≈ €440k/týden ≈ €88k/den ≈ 14k ks/den → úzké hrdlo je spíš prodej než kapacita |
| Recepty (minima) | ≥20 % wheat, ≥30 % oat, ≥20 % příchuť (Nut/Blueberry/Strawberry/Raisin), Mixed ≥30 % fruits&nuts (od každého něco), Original bez příchuti. 1 krabice + 1 sáček |
| Výchozí BOM [JISTÉ – cvičná data + ostrá hra ZCS02, závod G2] | 35 % oat (R06) / 35 % wheat (R05) / 30 % příchuť (R01 nuts, R02 blueberries, R03 strawberries, R04 raisins). 500 g = 0,175/0,175/0,150 kg + Small Bag P04 + Small Box P03; 1 kg = 0,350/0,350/0,300 kg + Large Bag P02 + Large Box P01. Test `packages/engine/test/bom.test.ts` |
| Valuace | `((Profit − Setup)/Kola × 12 + Setup) / (7 % + riziková přirážka)`. Rating z `DebtLoading = Cash + AR − Loan − AP` (tabulka v archivu kap. 2). **Start: −6M → A− → 12,25 %** |
| Počet kol | **5** [JISTÉ – potvrzeno týmem] |

Pravidla hry: bez zásob se nic neprodá. Preference zákazníků se během hry nemění. Konečný sklad se oceňuje v nákladech → **nikdy neprodávat pod nákladem**.

### SAP mechaniky, které musí appka respektovat [JISTÉ – job aid + guide]
- **MD61** (prognóza) → **MD01** (MRP) → **ME59N** (nákupky; pole *Fixed Vendor* musí být prázdné) → po dodání surovin **CO41** (převod na výrobní zakázky).
- MRP: planned orders = prognóza − sklad − rozpracovaná výroba, nařezané podle lot size (16k–48k).
- CO41 jde jen tehdy, když jsou **všechny suroviny skladem**. Zakázky ve frontě nejdou přeřadit ani zrušit.
- **ZCS02 (recept) nejde změnit, když má produkt > 1 000 ks skladem nebo přiřazené výrobní zakázky.** Nevalidní BOM = produkt se neprodá. **Recept proto rozhodnout před prvním MRP.**
- Recept ovlivňuje i atraktivitu produktu, nejen náklad (guide kap. 5). Levnější recept tedy není automaticky lepší.
- ZFB50 investice jdou kdykoli, i před kolem 1. Simulace reaguje okamžitě.
- VK32: ceny per DC (10/12/14). ZADS: denní marketing per produkt × region (North/South/West).

## 3. Vstupy – rychlý režim = max 3 soubory
| # | Report | Proč | Kdy |
|---|---|---|---|
| 1 | **InventoryReport (ZMB52)** | sklad FG + surovin | každý cyklus |
| 2 | **SalesReport (ZVA05)** | naše prodeje per den × SKU × DC × region, cena, **Cost** (= jednotkový náklad, náhrada ZCK11) | každý cyklus |
| 3 | **PriceMarket (ZMARKET)** | trh všech týmů po 5 dnech → kotva ceny + **odhalení preferencí** | jednou za 5 herních dní |

- SummarySales (ZVC2) se nepotřebuje, ZVA05 je nadmnožina. Když ho někdo nahraje, appka ho akceptuje a nekřičí.
- **Jeden drop zone nahoře** pro všechny soubory najednou, autodetekce podle hlaviček (signatury v archivu kap. 4.1). Vedle 3 „čipy“ se stářím dat (🟢 < 6 min, 🟠 < 15 min, 🔴, ⚪ nenahráno).
- **Názvy souborů jsou jedno** (např. `export (3).xlsx`), report se pozná podle hlaviček (test v `apps/server/test`).
- **Rytmus nahrávání: jednou za 5 herních dní** (den 4–5, 9–10, 14–15, 19–20) všechny 3 najednou = zároveň další MRP cyklus.
- Bez dat appka **nesmí** tvrdit nesmysly typu „DC 12: 0 prodejů“. Analýzy bez vstupu se nezobrazují vůbec, ne jako chyba.

### Rozšířené vstupy (pod tlačítkem „Rozšířené“)
ProcSourcing (ZME13: ceny surovin, mění se po 5 dnech), PurchaseOrderTracking (ZME2N), ProductionReport (ZCOOIS), Company-Valuation, ruční finance (cash, AR, AP, loan, net income, 478000).

## 4. Fáze hry a co appka dělá v každé
Fáze se určí z dat (max Round/Day v SalesReport). Bez dat = **„Před hrou“**. **Den 20 (kromě posledního kola) = „Mezi koly“ automaticky.** Jde přepnout i ručně – **jen ve vlastním prohlížeči** (`/api/state?phase=…`, localStorage), ostatním se nepřepne. Sdílené jsou jen ✓ karet, Nastavení a herní den.

### 4.1 Před hrou (žádná data) – musí fungovat z presetu
Appka zobrazí **startovní checklist** v pořadí (každý bod = akční karta s hodnotami ke zkopírování):
1. **Sortiment – „plošně a po 1. kole rozseknout“**: 1. kolo všechny zaškrtnuté výrobky (Nastavení → Sortiment; default 8 příchutí kromě Original/Mixed, **tým GG má zaškrtnuto 6: F01–F04, F11, F13**), abychom poznali preference trhu. Po 1. kole (`assortmentReview`) appka seřadí **jen zaškrtnuté** podle tržeb celého trhu (ZMARKET) × naší marže a nechá `assortmentTarget` = 5 (vždy ≥ 1× 1 kg a ≥ 1× 500 g). Vyřazené dostanou MD61 = 0 a doprodají se; karta „Sortiment od kola 2“ v fázi Mezi koly. Vypínač `assortmentAuto` v Nastavení.
2. **ZCS02 recept**: default ponechat (35/35/30). V Rozšířeném je kalkulačka levnějšího receptu s varováním „může snížit poptávku“. Rozhodnout TEĎ, protože po výrobě už to nejde.
3. **VK32 startovní ceny** per SKU × DC [ODHAD, editovatelné]: 500 g ≈ €5,20, 1 kg ≈ €7,50. DC10 −€0,30 (velmi cenově citlivé), DC14 +€0,30. Ceny jen tam, kde se balení prodává (DC10 jen 1 kg, DC14 jen 500 g).
4. **ZFB50 setup reduction** (doporučení s výpočtem, viz 5.4). Default návrh 125k → 6 h [ODHAD].
5. **MD61 prognóza – 1. cyklus**: 1 kg po 24 000, 500 g po 16 000 (8 SKU) → 160k ks + 8 setupů = 224k / 240k ks kapacity za 10 dní. Limity: suroviny 128 000 kg (< 250k), obaly 320k (< 750k), náklad < cash.
6. **MD01 → ME59N** (Fixed Vendor prázdné) → čekat na dodávku → **CO41**.
7. Připomínka: **2. MRP cyklus spustit nejpozději den 4–5**, aby suroviny dorazily dřív, než doběhne 1. cyklus (lead time až 5 dní).

### 4.2 Během kola (data nahraná)
Appka **hlásí stav, ne úkoly**: tabulka „Co se děje → doporučení“ (max 12 řádků, podle dopadu v €, max 2 červené), Přehled výrobků, Obchody (DC, 5 dní), Výroba a sklady, MD61, VK32. Žádné kroky ani ✓ – SAP hodnoty a postup jsou v detailu pod (?).

## 5. Výpočty (čisté funkce v `packages/engine`, každá s testem)
### 5.1 Poptávka per SKU
`dailyDemand` = průměr prodejů za posledních 5 dní, **jen ze dnů, kdy byl SKU skladem** (stockout dny by poptávku podhodnotily). Bez historie → default z presetu (podíl trhu × velikost kanálu). Když byl SKU vyprodaný ≥ 2 dny → `dailyDemand × 1,2` [ODHAD, parametr].

### 5.2 MD61 doporučení (hlavní výstup)
- Horizont `H` = dny do dalšího plánovaného MRP + max lead time (default 5 + 5 = 10) [parametr].
- `forecast_SKU = roundUp1000(dailyDemand × H)`.
- **Kapacitní kontrola**: `Σ shortfall + setupy × hodinyNaSetup × kapacita/24 ≤ kapacita × H`. Při přetlaku krátit SKU s nejnižší **marží na kus** (`cena − unitCost`, z SalesReport Cost/Quantity).
- U každé řádky ukaž i **očekávané planned orders** = `forecast − sklad − rozpracovaná výroba`, nařezané podle lot size. Tým po MD01 zkontroluje, že SAP vytvořil to samé. [OVĚŘIT na cvičné hře, jak MD61 nakládá se spotřebou prognózy prodeji. Když nesedí, přepínač „prognóza = doplnění“ vs „prognóza = celková poptávka“ v Rozšířeném.]

### 5.3 VK32 ceny per SKU × DC
- `coverDays = stock / dailyDemand`.
- < 3 dny nebo vyprodáno → **+€0,30**. > 8 dní → **−€0,30**, ale ne pod kotvu trhu −10 %. Jinak beze změny. (Krok i prahy jsou parametry.)
- Kotva = průměrná tržní cena SKU z posledního ZMARKET okna.
- **Podlaha = unitCost** (pravidlo hry). Pod `unitCost + fixníNáklad/ks` (Extended ≈ €28k/den / 24k ≈ €1,17) jen žluté varování.
- DC, kde SKU nesmí být (DC10 × 500 g, DC14 × 1 kg), se nezobrazí.

### 5.4 Investice (karta ve fázi „Před hrou“ a mezi koly)
- **Splátka úvěru**: rating se nezmění, úrok klesne. Doporuč splatit `cash − rezerva`, kde rezerva = fixní náklady 10 dní + suroviny na příští cyklus + €200k buffer [parametry]. Bez financí jen obecná karta s výpočtem úspory úroku.
- **Setup reduction** (marginální tabulka): pro každý další krok spočítej `ušetřené hodiny × počet přestaveb/kolo × 1 000 ks × marže/ks × zbývající kola` vs. marginální výdaj. Výdaj se ve valuaci odečte jednou (neanualizuje se). Doporuč kroky, kde návratnost > 2×.
- **Kapacita**: jen když je poptávka trvale > kapacita (stockouty + plný rozvrh). Break-even: `+1 000 ks/den × marže × zbývající dny` vs. odpisy (~€417/den za €1M) + pokles ratingu.

### 5.5 Alerty (kritické karty)
SKU vyprodaný · do konce výroby < lead time a není nový MRP cyklus · cena pod unitCost · sklad nad kapacitou skladu · kanál bez ceny (0 prodejů v DC, kde balení smí, **jen když data existují**) · BOM pozor: „recept už nejde měnit“.

## 6. UI – JEDNA obrazovka
```
┌ ERPsim Copilot ─ [Před hrou | Kolo 2 · den 9/20] ─ Valuace 77,3M (A−) ─ [⬆ Drop xlsx] 🟢Sklad 🟢Prodeje 🟠Trh ─ [Rozšířené ▸] ┐
│ CO SE DĚJE → DOPORUČENÍ (max 12 řádků)                                                                                   │
│  ● GG-F12 dojde za 1,5 dne (sklad 600, prodej 4 871/den)   │ Prognóza MD61 GG-F12 = 49 000            +157k €   (?)      │
│    GG-F03: pokrytí 0,4 dne < 3                             │ Zvýšit cenu GG-F03: DC 12 5,20 → 5,50 €   +14k €   (?)      │
│ PŘEHLED VÝROBKŮ · OBCHODY (DC) · VÝROBA A SKLADY                                                                          │
├─────────────────────────────── MD61 – PROGNÓZA ──────────┬──────────── VK32 – CENY ──────────────────────────────────┤
│ SKU   sklad  dny  prognóza  → planned orders              │ SKU    DC10      DC12      DC14     trh                   │
│ F12   12k    1,5  96 000   2× 48k                         │ F12    7,20 ↑    7,50 ↑     –       7,73                  │
└───────────────────────────────────────────────────────────┴───────────────────────────────────────────────────────────┘
```
- Tabulky MD61 a VK32 jsou **přesně ve tvaru, v jakém se zadávají do SAPu** (stejné pořadí materiálů jako v SAP formuláři). U každé hodnoty je kopírování kliknutím.
- **Appka hlásí, co se děje, a doporučuje** (řádek = pozorování z dat + doporučení). Žádný seznam úkolů. Důvody a hodnoty pro SAP jsou pod (?).
- (?) u každé karty i řádku: **hover = krátký důvod** (1 věta + klíčová čísla), **klik → boční panel**: proč, čísla, pravidlo, riziko, jistota (jisté / pravděpodobné / odhad).
- **„Rozšířené ▸“** = šuplík/drawer zprava, záložky: Další importy · Investice (what-if) · Recept (BOM kalkulačka) · Marketing (ZADS) · Strategie (text) · Nastavení (preset, parametry, počet kol, sortiment, PIN).
- Velké fonty, tmavý režim, čeština. Žádné modály. Nic se nepočítá na serveru déle než 200 ms.

## 7. Technika (zachovat z v1)
Monorepo Vite + React + Tailwind / Hono + better-sqlite3 / `packages/engine` (čisté funkce). `npm run game` (0.0.0.0, vypíše LAN + Tailscale URL + QR), záloha `npm run game:share` (cloudflared). PIN volitelný. SSE s reconnectem. **Zero-code během eventu**: vše, co se může lišit, je v Nastavení.

## 8. Testy (povinné)
- Preset `extended` = hodnoty z kap. 2 (snapshot test).
- Bez dat: fáze „Před hrou“, vygeneruje se 7 karet startovního checklistu, **žádná karta „0 prodejů“**, rating A−, diskont 12,25 %.
- Valuace: příklad z briefingu (17 884 615) + Intro ověření (77 388 994,40 z čísel v archivu 4.3).
- Setup tabulka 50k→7 h … 1,25M→3 h.
- Parsery nad `fixtures/` (kontrolní součty v archivu 4.5).
- MD61 návrh nad fixtures: součet nepřekročí kapacitu × H. Lot-size řezání podle tabulky z guide (1→16k, 15 500→16k, 16 001→17k, 40 000→40k, 47 500→48k, 48 001→48k+16k).
- Ceny nikdy pod unitCost.
