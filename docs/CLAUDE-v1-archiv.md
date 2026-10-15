# ERPsim Copilot – CLAUDE.md

## O co jde
Stavíme lokální analytickou appku pro soutěž **ERPsim – Manufacturing Extended** (HEC Montréal ERPsim Lab, SAP S/4HANA, Fiori). Týmy řídí výrobce müsli „ERP Muesli Germany“ a soutěží proti sobě na stejném trhu. **Vyhrává tým s nejvyšší Company Valuation na konci simulace.** Během kola běží simulovaný čas (řádově 1 den ≈ 1 minuta). Rozhoduje se pod tlakem, takže appka musí za pár sekund převést čerstvá data na konkrétní akce.

Uživatelé: tým 3–6 lidí. Appka běží na jednom Macu (operátor) a ostatní ji sledují v prohlížeči přes LAN nebo na sdílené obrazovce. UI je v češtině, kód a identifikátory v angličtině.

Označení jistoty v tomto souboru:
- **[JISTÉ]** = přímo z oficiálního briefingu.
- **[PRAVDĚP.]** = silná dedukce.
- **[OVĚŘIT]** = hypotéza, kterou je potřeba potvrdit v cvičném kole. Kód s ní musí počítat jako s konfigurovatelným parametrem, ne jako s natvrdo zadanou konstantou.

---

## 1. Herní fakta [JISTÉ]

### Trh / distribuční kanály
| DC | Kanál | Balení | Produktů v objednávce | Splatnost | Citlivost cena / reklama | Trh / tým / 5 dní |
|---|---|---|---|---|---|---|
| 10 | Hypermarkety (12 prodejen) | jen 1 kg | 3 | 20 dní | velmi vysoká / nízká | ~€90 000 |
| 12 | Grocery chains (59) | 1 kg i 500 g | 4 | 10–20 dní | vysoká / střední | ~€360 000 |
| 14 | Independent grocers (123) | jen 500 g | 1 | 1–20 dní | střední / vysoká | ~€135 000 |

Regiony: North, South, West (marketing ZADS se zadává denně per produkt per region).
Preference zákazníků se během hry nemění.

### Produkty (12 SKU) – recepty jsou MINIMA
Kódy `$$-F01..F06` (500 g) a `$$-F11..F16` (1 kg), kde `$$` je kód firmy/týmu.
Nut, Blueberry, Strawberry, Raisin, Original, Mixed.
- Všechny: ≥20 % wheat, ≥30 % oat, 1 krabice + 1 sáček.
- Nut, Blueberry, Strawberry a Raisin mají navíc ≥20 % své příchuti.
- Mixed: ≥30 % fruits & nuts, přičemž obsahuje aspoň něco z každé suroviny.
- BOM jde měnit přes ZCS02. Nevalidní BOM = produkt nejde prodávat.
- Příklad z briefingu, 500 g Nut: 0,175 kg oats, 0,175 kg wheat, 0,150 kg nuts.

### Výroba
- Kapacita 24 000 jednotek/den. Navýšení stojí €1 000 000 za +1 000 jednotek/den (Kapacita = zůstatek účtu 11000 / 1000). Zvyšuje to odpisy.
- Setup mezi dvěma různými produkty je 8 h. Zkracuje se investicí do účtu 478000:
  `SetupTime = 2 + (6 × 250 000) / (250 000 + balance478000)`
  Kontrolní hodnoty: 50k → 7 h, 125k → 6 h, 250k → 5 h, 500k → 4 h, 1,25M → 3 h.
- Lot size: min 16 000, max 48 000. Max lze měnit přes MM02, ale jen před hrou a mezi koly.
- Dodavatelé V01 a V02: dodací lhůta 1–5 dní, splatnost 20 dní. Ceny surovin jsou v ZME13.

### Fixní náklady (strhávány automaticky každých 5 dní)
Labor 20 000, Mfg overhead 15 000, SG&A 40 000, Odpisy budovy 1 250, Odpisy strojů 50 000 (roste s kapacitou). K tomu úroky z úvěru.
- Denně podle ZCK11: 4 000 + 3 000 + 10 000 + 250 + 8 000 + úrok 2 644,80 = **27 894,80 €/den**.
- Odpisy strojů: 10 000 €/den na €24M strojů, tedy ~0,0417 %/den. Každý další €1M znamená ~+417 €/den.
- Úrok: 2 644,80 €/den na €8M úvěru, tedy ~330,6 €/den na každý €1M.

### Sklad
Hotové výrobky 250 000 krabic (+€500/den za každých dalších 50k), suroviny 250 000 kg (+€1 000/den za 50k), obaly 750 000 ks (+€100/den za 50k).

### Výchozí stav
Podle briefingu: cash €2 000 000, úvěr €8 000 000, žádný počáteční sklad. Cvičná hra ale měla počáteční sklad ~30k ks u 8 SKU (viz 4.3). Výchozí stav proto patří do configu, ne do konstant.

### Pravidla
1. Konečný sklad se oceňuje v nákladové ceně, proto **nikdy neprodávat pod nákladem**.
2. Prodat lze jen to, co je skladem.

---

## 2. Vzorce, které musí engine počítat přesně [JISTÉ]

```
CompanyValue = ( ((Profit − Setup) / RoundsPlayed) × 12 + Setup ) / (0.07 + CompanyRiskRate)
  Setup = zůstatek nákladů na setup time reduction (záporné číslo, např. −75 000)
  → náklady na setup se NEanualizují, započtou se jen jednou

DebtLoading = Cash + AccReceivable + Loan(−) + AccPayable(−)

Rating lookup (DebtLoading → rating → risk premium), krok €1M:
  ≥0 AAA+ 3.00 | −1M AA+ 3.75 | −2M AA 4.00 | −3M AA− 4.25 | −4M A+ 4.75 | −5M A 5.00
  −6M A− 5.25 | −7M BBB+ 5.75 | −8M BBB 6.00 | −9M BBB− 6.25 | −10M BB+ 6.75 | −11M BB 7.00
  −12M BB− 7.25 | −13M B+ 7.75 | −14M B 8.00 | −15M B− 8.25 | −16M CCC+ 9.00 | −17M CCC 10.00
  −18M CCC− 11.00 | −19M CC 12.00 | ≤−20M C 15.00
  Pravidlo: vezmi poslední řádek, kde DebtLoading ≤ threshold (−8.4M → BBB).
```

Unit testy, které MUSÍ projít (příklady z briefingu):
- Profit 125 000, Setup −75 000, 1 kolo, BBB → **€17 884 615**.
- Cash 1,5M, AR 450k, Loan −10M, AP −350k → DebtLoading −8,4M → BBB → 6 %.
- Výchozí stav (2M cash, −8M úvěr) → −6M → A− → diskont 12,25 %.

Dopady akcí na DebtLoading:
- Nákup strojů: cash ↓ → rating ↓ (€3M = −3 stupně), profit 0, týdenní náklady ↑.
- Setup reduction: cash ↓ → rating ↓, profit ↓ (jednorázově), týdenní náklady 0.
- Splátka úvěru: cash ↓ a loan ↑ zároveň → **rating beze změny**, týdenní náklady ↓ (úrok).
- Goods receipt: AP ↓ → rating ↓. Úhrada dodavateli: neutrální.
- Prodej: AR ↑ → rating ↑ a profit ↑ (€1M tržeb = +1 stupeň). Přijetí platby: neutrální.

---

## 3. Strategické páky – co má engine aktivně hlídat

1. **Splácení úvěru [PRAVDĚP. – silná páka].** Rating se nemění a úrok klesá. €1M splacený na začátku hry ≈ +6,6k profitu za 20denní kolo. Po anualizaci ×12 a vydělení ~12 % to dává řádově +€0,6M valuace. Splácet včas, protože profit je kumulativní. Omezení: musí zůstat likvidní rezerva podle ZFF7B. [OVĚŘIT], co se stane při záporném cashi.
2. **Rating = jmenovatel.** Jeden stupeň ≈ 0,25–0,5 p.b. na diskontu ~12 %, tj. 2–4 % valuace. Engine má vždy ukazovat „vzdálenost k dalšímu stupni nahoru/dolů v €“ a dopad každé investice na rating.
3. **Kapacitní investice** se vyplatí jen tehdy, když existuje neuspokojená poptávka s marží. Engine počítá break-even: (extra jednotky/den × marže/ks) vs. (+417 €/den odpisů + ztráta valuace z ratingu) přes zbývající dny hry.
4. **Setup reduction.** Každá přestavba stojí `SetupTime × 1 000` jednotek kapacity (24k/den = 1k/h). Hodnota = počet přestaveb za zbytek hry × ušetřené hodiny × 1 000 × marže. Náklad se započte jednou (neanualizuje se), ale sníží cash a tím i rating.
5. **Mix produktů a velikost balení.** [OVĚŘIT] Pokud je kapacita v krabicích bez ohledu na gramáž, 1 kg krabice nese víc tržby na kapacitní slot. Engine má řadit SKU podle marže na kapacitní jednotku. 12 SKU × setup 8 h je moc, takže doporučit užší sortiment a dlouhé dávky.
6. **Optimalizace BOM.** Nejlevnější validní recept podle cen ze ZME13 (víc oats/wheat nad minimum, pokud jsou levnější). [OVĚŘIT], zda složení ovlivňuje poptávku.
7. **Cenotvorba.** Z ZMARKET (ceny a objemy všech týmů za posledních 5 dní) odhadnout per SKU × DC tržní cenu a citlivost. Doporučit cenu s ohledem na sklad: přetlak skladu → zlevnit, výpadek → zdražit. Nikdy pod jednotkovým nákladem.
8. **Marketing (ZADS)** dává smysl hlavně v DC14 (vysoká citlivost), v DC10 skoro ne.

---

## 4. Vstup dat – nejdůležitější část appky

### 4.1 Reálné exporty, které máme [JISTÉ] (`fixtures/*.xlsx`)
Všechny pochází z Fiori aplikací („SAPUI5 Export“, jeden list, hlavička v řádku 1, žádné prázdné řádky). Jsou z cvičné hry týmu **GG**: kola 01–03 po 20 dnech, kolo 04 je v SummarySales vyplněné nulami.

| Soubor | Sloupce (přesně) | Granularita | Poznámky k parsování |
|---|---|---|---|
| `Company-Valuation.xlsx` | `Simulation Round`, `Simulation Step`, `Company Valuation` | 1 řádek / den | Round a Step jsou stringy `"01"`. Valuace je float v €. |
| `PriceMarket.xlsx` | `Simulation Date`, `Material`, `Description`, `Area`, `Price`, `Quantity`, `Value` | **celý trh (všechny týmy dohromady)** per materiál × region za 5denní okno | Datum `"RR/DD"`, jen dny 05/10/15/20. Material **bez prefixu** (`F12`). Area je `North/South/West`. **Nemá DC ani tým.** Price = průměr (Value/Quantity). |
| `SalesReport.xlsx` | `Round`, `Day`, `Area`, `Location`, `D. Channel`, `Material`, `Description`, `Net Price`, `Quantity`, `Net Value`, `Cost` | 1 řádek / naše prodejní objednávka | Area je `NO/SO/WE` (≠ PriceMarket!). Material s prefixem (`GG-F12`). D. Channel a Location jsou stringy (`"12"`, `"02"`). Cost = COGS řádku. |
| `SummarySalesReport.xlsx` | `Round`, `Day`, `Material`, `Description`, `Orders`, `Quantity`, `Net Value`, `Cost` | den × materiál (vč. nulových řádků) | Není seřazený. Součty sedí 1:1 se SalesReport. |
| `InventoryReport.xlsx` | `Location`, `Category`, `Material`, `Description`, `Stock`, `Reserved`, `Unit` | snapshot (aktuální stav) | Location `02` = hotové výrobky, `88` = suroviny a obaly. Category: `Finished Goods` / `Packaging` / `Raw Materials`. Unit `ST`/`KG`. **Nemá datum → doplnit časem importu a herním dnem z UI.** |
| `ProductionReport.xlsx` | `Order`, `Material`, `Description`, `Start`, `Finish`, `Setup`, `Released`, `Unit Cost`, `Target`, `Confirmed` | 1 řádek / výrobní zakázka | Datumy `"RR/DD"`. Setup v hodinách (0 nebo 8). Unit Cost = plánovaný jednotkový náklad SKU (náhrada za ZCK11). |

| `ProcSourcing.xlsx` | `Vendor`, `Material`, `Gross Price`, `Source` | 1 řádek / surovina | Ceník surovin a obalů. V Intro má každý materiál jednoho dodavatele (V01 suroviny, V02 obaly). [OVĚŘIT] Extended může mít víc dodavatelů na materiál → vybírat nejlevnější s `Source = X`. |
| `PurchaseOrderTracking.xlsx` | `Order`, `Vendor`, `Material`, `Description`, `Status`, `Reception`, `Price`, `Quantity`, `Value` | řádek PO (jedna PO = víc řádků) | `Status`: zatím jen `Delivered` (čekat i jiné hodnoty, třeba „Ordered“/„In transit“). `Reception` = `"RR/DD"` nebo `"Unscheduled"`. **Nemá datum objednání** → appka si při každém importu ukládá `firstSeenGameDay` per Order, z toho odhad lead time. V03 = počáteční nákup hotových výrobků (Intro scénář, ignorovat v nákupní logice). |

**Kusovník (BOM) se dopočítá, nepotřebuje export [JISTÉ, ověřeno]:** současné recepty = 35 % oats + 35 % wheat + 30 % příchuť (Original/Mixed [OVĚŘIT]). Na kus 500 g: 0,175 / 0,175 / 0,150 kg, na 1 kg dvojnásobek. K tomu 1 krabice + 1 sáček (P01+P02 pro 1 kg, P03+P04 pro 500 g). Kontrola: F01 = 0,175×0,92 + 0,175×0,99 + 0,15×1,82 + 0,21 + 0,09 = **0,91** ✓, F12 = 0,35×0,92 + 0,35×0,99 + 0,3×4,00 + 0,28 + 0,12 = **2,27** ✓ (= Unit Cost v ProductionReport). Potvrzují to i PO: 32 000 krabic ↔ 5 600 kg oats.
→ BOM je v `config/game.ts` jako výchozí recept + editovatelný v UI. Spotřeba surovin = BOM × plán výroby.

Normalizace (dělá ji jedna vrstva `normalize.ts`, na kterou pak navazuje vše ostatní):
- `materialKey` = posledních 3 znaků (`GG-F12` → `F12`). Prefix týmu (`GG`) se ukládá zvlášť jako `teamCode`.
- `area` → enum `N|S|W` (z `NO/SO/WE` i `North/South/West`).
- Čas → `gameDay = (round−1)×20 + day` (int). Z `"RR/DD"` i ze dvojice Round+Day. Délku kola (20) brát z configu.
- Odvozené atributy z kódu: `size` = `F0x` → 500 g, `F1x` → 1 kg. `flavor` = poslední číslice (1 Nut, 2 Blueberry, 3 Strawberry, 4 Raisin, 5 Original, 6 Mixed).
- Autodetekce reportu = podle **množiny hlaviček** (signatura). Při paste z Fiori (Cmd+A/C v tabulce) přijde TSV se stejnými hlavičkami. Parser musí brát xlsx i TSV.
- Tolerovat i jiný locale (`1.234,56`, `75,000-`) a přehozené pořadí sloupců. Neznámou signaturu → ruční mapování a uložení profilu.

### 4.2 Reporty, které CHYBÍ (požádat o ně uživatele, než začneš stavět danou část)
| Priorita | Co | Proč |
|---|---|---|
| ✅ | Ceny surovin (ProcSourcing) a nákupní objednávky (PurchaseOrderTracking) **máme**. BOM a ZCK11 se dopočítají (viz 4.1). Marketing export není k dispozici. |
| — | Finanční výkazy (Financial Statement / Balance Sheet + P&L, ve hře F.01 nebo Fiori „Financial Statement“) | Bez cash, AR, AP, Loan a Profit nelze spočítat rating, DebtLoading ani ověřit vzorec valuace (viz 4.3). |
| P1 | Stav nákupních objednávek + ceny surovin (Purchase Orders / ZME2N, ZME13) | Výroba stála kvůli surovinám. Potřebujeme lead time a nákupní plán. |
| P1 | BOM / kusovník (ZCS02 nebo Material BOM) | Optimalizace receptu a výpočet spotřeby surovin na dávku. |
| P2 | Marketing expenses (ZADS přehled) | Efekt reklamy. |
| P2 | Ověřit, jestli SalesReport opravdu ukazuje všechny DC, nebo je jen filtr na DC 12. | Ve všech datech je jen DC 12. |

### 4.3 Co jsem z cvičných dat vyčetl – engine to musí umět spočítat a hlídat
- **[JISTÉ] Prodávali jsme JEN v DC 12** (grocery chains). DC 10 (hypermarkety, 1 kg) a DC 14 (independents, 500 g) nemají ani jeden prodej. Alert: „DC X má 0 prodejů – nastavená cena ve VK32?“
- **[JISTÉ] Hlavní problém je nabídka, ne poptávka.** Spousta dní má nulové prodeje (kolo 1 dny 15–20, kolo 3 dny 2–4 a další). Sklad hotových výrobků končí prakticky na nule a podíl na trhu je jen 5–20 %. Trh by bral víc.
- **[JISTÉ] Výroba jede hluboko pod kapacitou.** Kolo 1: žádná výrobní zakázka, jen se doprodával počáteční sklad (~30k/SKU, takže tato hra MĚLA počáteční zásoby). Kolo 2: 16 dávek = 256k ks. Kolo 3: 12 dávek = 192k ks, prvních 5 dní nic. Všechny dávky jsou na minimu 16 000. Teoretické maximum je ~24k/den ≈ 480k/kolo.
- **[PRAVDĚP.] Příčina prostojů = suroviny.** Na konci kola 3 je sklad surovin i obalů 0 a lead time je 1–5 dní, takže začátek kola stojí. → **Alert: „Na konci kola musí být objednané suroviny na prvních 5 dní dalšího kola.“**
- **[PRAVDĚP.] Kapacita se počítá v kusech (krabicích) bez ohledu na gramáž**: 16k dávka 1 kg i 500 g trvá stejně. 1 kg SKU má vyšší marži na kus. Kolo 3 (průměrná cena − Unit Cost): F12 ≈ 8,55 − 2,27 = **6,28 €**, F13 ≈ 5,82 €, F01 ≈ 4,18 €, F02 ≈ 4,36 €, F04 ≈ 3,71 €. → Řadit výrobu podle **marže na kus kapacity**. [OVĚŘIT] ještě poptávku: 1 kg nejde do DC 14.
- **[JISTÉ] Jednotkové náklady (Unit Cost)**: F01 0,91 · F02 1,23 · F03 1,24 · F04 0,79 · F11 1,61 · F12 2,27 · F13 2,27 · F14 1,39. F05/F06/F15/F16 jsme nevyráběli a trh je skoro nezná (jen pár transakcí v kole 3), což může být nevyužitá nika s cenou F16 ≈ 9,62.
- **[JISTÉ] Setup**: každá změna produktu = 8 h. V kole 2 bylo 12 přestaveb na 16 dávek. Engine má počítat ztracené hodiny a navrhovat delší běhy stejného SKU (víc dávek po sobě nebo větší lot přes MM02 mezi koly).
- **[JISTÉ] Prostoj na začátku kola 3 potvrzen:** velká nákupka (PO 4500000300/301) dorazila 03/04, výroba začala 03/06. Suroviny se objednaly až na začátku kola. V kolech 1–2 se nakupovalo po malých dávkách na každé 2 výrobní dávky (32k ks).
- **[PRAVDĚP.] Levnější recept = velká páka (pravidlo R15).** Recepty jsou MINIMA (≥ 30 % oats, ≥ 20 % wheat, ≥ 20 % příchuť). Nejlevnější validní recept je 60 % oats (0,92 €/kg) / 20 % wheat (0,99) / 20 % příchuť. Úspora na kus: F12/F13 ≈ **0,32 €** (1,87 → 1,55), F02/F03 ≈ 0,16 €, F11 ≈ 0,10 €, F01 ≈ 0,05 €, F14 ≈ 0,03 €. Při objemech z kola 3 to je ≈ €30k profitu za kolo, tedy ≈ +€3–4M valuace za celou hru. Změna přes ZCS02. **[OVĚŘIT] jestli složení neovlivňuje poptávku** a jestli jde BOM měnit i v Intro verzi. Engine počítá úsporu, UI ukazuje riziko.
- **[PRAVDĚP.] SalesReport opravdu obsahuje všechny DC** (i nový export má jen DC 12), takže DC 10 a 14 jste skutečně nevyužili.
- **[JISTÉ] Ceny**: tržní průměr se v čase hýbe hodně (F12: 5,37 → 11,05 na konci kola 1, kdy byl trh vyprodaný → ~7,7–9). Naše ceny byly často nad trhem a stejně se prodalo vše, takže při nedostatku zboží jsme mohli jít výš.
- **[JISTÉ – OVĚŘENO] Vzorec valuace z kap. 2 platí.** Balance Sheet/Income Statement (Intro hra, začátek kola 4 = 3 odehraná kola):
  Cash 3 376 340,64 · AR 1 261 952,50 · FG 38 419,68 · Machinery 16 000 000 · Liabilities −326 988,00 (žádný úvěr) · Net Income 1 934 724,86
  → DebtLoading = +4 311 305 → AAA+ (3 %) → (1 934 724,86 / 3 × 12) / 0,10 = **77 388 994,40** = přesně reportovaná valuace. **Toto je povinný unit test.**
  Intro konfigurace se liší od briefingu (Extended): **úvěr 0**, stroje €16M (kapacita ~16k/den?), fixní náklady ≈ €14,6k/den (dopočteno z hrubé marže − net income), počáteční sklad ~30k/SKU. → Preset `intro` v configu.
  Strategický důsledek pro Intro: AAA+ s rezervou €4,3M → investice do kapacity/setupu do ~€4M **nemění rating**. Pravidlo R14 *Volný cash*: když DebtLoading − investice ≥ 0 a výroba je úzké hrdlo → doporuč investici a ukaž break-even.
- **Finance je NEPOVINNÁ a nízkofrekvenční** (jednou za kolo, hlavně pro investice / splátku úvěru). Bez ní appka plně funguje: operativní pravidla (ceny, výroba, nákup) ji nepotřebují. Fallback: rating z configu (default AAA+ pro Intro) a `impliedProfit = reportedValuation × (0.07 + riskRate) × roundsPlayed / 12`.
- **Finanční data = RUČNÍ FORMULÁŘ (když se vyplní).** Fiori app Balance Sheet/Income Statement **nemá export do xlsx** (jen PDF preview). Proto obrazovka **„Finance“**: pole `cash` (113300), `receivables` (140000), `payables`, `loan`, `netIncome`, `setupSpend` (478000, default 0), `roundsPlayed` (předvyplněno z dat). Čísla přijímají vložený text typu `3,376,340.64 EUR` i `-326,988.00`. Po uložení appka hned spočítá DebtLoading → rating → valuaci a **porovná s reportovanou valuací** (Company-Valuation): ✅ shoda < 0,5 %, ❌ červeně „zkontroluj opsaná čísla“. Ukládá se jako snapshot s herním dnem. Hodnoty z minula jsou předvyplněné, takže se mění jen to, co se pohnulo.
- Volitelně později: drop PDF z PDF preview → `pdfjs-dist` → vytáhnout řádky podle čísel G/L účtů. Nikdy nesmí blokovat formulář.
- [OVĚŘIT] Jestli Accounting obsahuje Trial Balance / G/L Account Balances s exportem do xlsx. Pokud ano, přidat parser.
- Struktura reportu **Balance Sheet/Income Statement** (Fiori, hierarchická tabulka, pro případný PDF parser): sloupce `Description`, `G/L Account`, `Period Balance`, `Comparison Balance (Actual)`, `Absolute Difference`, `Relative Difference`. Klíčové účty: 113300 Bank Cash, 140000 Receivables, 792000 Finished goods, 11000 Machinery, 11010 Acc. depreciation. Hodnoty jako text `"3,376,340.64 EUR"`, záporné s mínusem vpředu. Parser hledá řádky podle **G/L Account** (stabilní), součtové řádky (Liabilities, Net Income) podle `Description`. Úvěr, AP a 478000 (setup) budou v rozbaleném Liabilities/Equity, takže [OVĚŘIT] na exportu.
- [JISTÉ] Valuace skáče denně (kolo 3: 70,8M → 81,7M → 77,4M). Den 20 typicky klesá, protože se strhnou 5denní fixní náklady. Kolo 1 den 1–2 ukazuje ~290M, což je artefakt anualizace jednoho dne. Graf má tyto první dny ořezat.

### 4.4 Analýzy, které z těchto dat appka počítá (MVP)
1. **Dny pokrytí** per SKU = Stock / průměrné denní prodeje za posledních 5 herních dní (ze SummarySales). Alert pod 3 dny (lead time výroby + surovin).
2. **Stockout detektor**: dny s 0 prodeji, kdy trh daný SKU kupoval (PriceMarket Quantity > 0), počítat jako ztracenou marži ≈ průměrné denní prodeje × marže.
3. **Podíl na trhu** per SKU × region × 5denní okno = naše Quantity (SalesReport, agregace do okna `ceil(day/5)×5`) / tržní Quantity.
4. **Cenová pozice**: naše průměrná Net Price vs. tržní Price per SKU × region. Doporučení: když je sklad < X dní pokrytí a prodáváme vše → zvednout cenu o krok (konfigurovatelný, default +0,30 €). Když se sklad hromadí (> 10 dní pokrytí) → snížit směrem k tržnímu průměru. **Nikdy pod Unit Cost** (a ideálně ne pod Unit Cost + fixní náklady / ks).
5. **Využití výroby** per kolo: vyrobené ks / (24 000 × dny), počet setupů, hodiny ztracené setupem, dny bez zakázky.
6. **Výrobní plán na dalších N dní**: SKU seřazené podle (marže/ks) × (nedostatek vůči poptávce). Seskupit do běhů po ≥2 dávkách, minimalizovat počet přestaveb.
7. **Valuace – trend** (graf podle gameDay) + delta den/den a kolo/kolo.

---

### 4.5 Ingest – UX
- **Primární cesta: drag & drop .xlsx** (víc souborů najednou). Sekundární: paste TSV do textového pole.
- Autodetekce podle signatur v 4.1. Neznámé → ruční mapování.
- Každý import dostane timestamp a herní den (Inventory nemá datum v datech, takže herní den zadá nebo potvrdí operátor). UI ukazuje stáří dat (zelená < 2 min, oranžová, červená).
- Reporty jsou kumulativní (Sales, Market, Valuation obsahují celou historii). Import = **upsert podle přirozeného klíče** (např. Order u výroby, Round+Day+Material u SummarySales), ne append.
- SQLite drží historii snapshotů Inventory (kvůli trendu skladu).
- Parsery testovat na `fixtures/`. Kontrolní součty: SalesReport Quantity po kolech = 232 372 / 218 099 / 213 898. Valuace na konci kola 3 = 77 388 994,40. 28 výrobních zakázek.

---

## 5. Architektura

- **Monorepo, TypeScript všude.** Frontend Vite + React + Tailwind, grafy Recharts. Backend Node + Hono, `better-sqlite3`, live push přes SSE nebo WebSocket.
- Server běží na Macu operátora a naslouchá na `0.0.0.0`. Tým otevře `http://<hostname>.local:<port>`. Jeden příkaz `npm run game` spustí vše a vypíše LAN URL a QR kód.
- **Sdílení – primárně Tailscale.** Tým je v jednom tailnetu (Personal plan, ≤ 6 uživatelů). `npm run game` při startu zavolá `tailscale ip -4` a `tailscale status --json` (MagicDNS jméno). Když je Tailscale aktivní, vypíše i `http://<magicdns-jméno>:<port>` a `http://100.x.y.z:<port>` + QR. Když `tailscale` chybí nebo neběží, jen to oznámí a pokračuje (nespadne). Server naslouchá na 0.0.0.0, takže tailscale rozhraní pokrývá.
- **Záloha – Cloudflare quick tunnel (eventová Wi-Fi často izoluje klienty):** `npm run game:share` spustí server + `cloudflared tunnel --url http://localhost:<port>` (quick tunnel, bez účtu), vyparsuje veřejnou `https://*.trycloudflare.com` adresu z výstupu a vypíše ji + QR kód. Když `cloudflared` chybí, vypiš `brew install cloudflared` a pokračuj jen v LAN režimu (nespadni).
- **PIN**: volitelný sdílený PIN (env `GAME_PIN` nebo nastavení v UI). Bez PINu nejde načíst API ani SSE. Cookie po zadání, žádné účty. V LAN režimu může být vypnutý.
- Frontend volá API relativně (`/api/...`) a SSE se po výpadku sám znovu připojí s exponenciálním čekáním. Banner „offline – data z HH:MM“, když spojení spadne.
- Stav je na serveru. Kdokoli z týmu může vložit data (každý jiný report = paralelní ingest), ostatním se UI aktualizuje živě.
- **Rozhodovací engine = čisté deterministické funkce** v `packages/engine` (bez I/O), pokryté testy ve Vitestu. Parametry hry jsou v `config/game.ts`, aby šly upravit v UI, kdyby instruktor změnil nastavení.
- Volitelné tlačítko „Zeptej se Clauda“ pošle aktuální snapshot a doporučení do Claude API a vrátí komentář. Nikdy nesmí být v kritické cestě a musí fungovat i offline.
- Žádný login, žádný cloud. Vše offline kromě volitelného LLM.

---

## 6. Obrazovky (priorita MVP shora)

1. **Velín (dashboard)** – Valuace teď (reportovaná) + trend, dny pokrytí per SKU (barevně), využití výroby, kanály s nulovými prodeji, po dodání finančních výkazů navíc odhad ke konci hry, rating a € do dalšího stupně ↑/↓, cash runway, top 5 doporučených akcí. Každá akce = *co udělat + T-code + konkrétní číslo + jedna věta proč + odhad dopadu na valuaci v €*.
2. **Ingest** – pole pro paste, drop zóna, seznam reportů se stářím dat.
3. **Investice / What-if** – posuvníky: splátka úvěru, +kapacita, setup spend. Živě přepočítává valuaci, rating a break-even.
4. **Ceny** – tabulka SKU × DC: náš sklad, dny pokrytí, naše cena vs. průměr / min / max trhu, jednotkový náklad, doporučená cena a delta pro VK32.
5. **Výroba** – doporučený rozvrh dávek (min 16k), počet přestaveb, ztráta kapacity setupem, kontrola surovin vs. MRP.
6. **Nákup a BOM** – nejlevnější validní recepty, výpadky surovin s ohledem na lead time 1–5 dní.
7. **Alerty** – sklad blízko kapacity, SKU vyprodané, cena pod nákladem, cash pod rezervou, nevalidní BOM.

UX zásady: velké fonty (čte se z TV a z dálky), tmavý režim, žádné modální okna v kritické cestě, klávesové zkratky, čísla s mezerami jako tisícovými oddělovači a €. Doporučení řadit podle dopadu na valuaci.

---

## 6a. AKČNÍ KARTY, STRATEGIE A „PROČ“ – jádro UI

### Princip
Appka neukazuje jen čísla, ale **říká, co udělat teď**. Každé doporučení je **akční karta** se stejnou strukturou. UI je řazené podle **fáze kola**, protože správné kroky se mění během kola.

### Akční karta (typ `ActionCard` v `packages/engine`)
```ts
type ActionCard = {
  id: string;
  priority: 'kritické' | 'vysoká' | 'střední';      // barva: červená / oranžová / šedá
  title: string;              // "Zvyš cenu 1kg Blueberry (F12) na 9,10 €"
  impactEUR?: number;         // odhad dopadu na valuaci nebo marži, řadí se podle něj
  deadline?: string;          // "do dne 18 – lead time surovin"
  tcode: string;              // "VK32"
  steps: string[];            // klikací návod krok po kroku, s konkrétními hodnotami
  why: {                      // obsah po kliku na ikonu (?)
    summary: string;          // 1 věta – proč
    data: {label: string; value: string}[];  // čísla, ze kterých to vyplynulo
    rule: string;             // jaké pravidlo z playbooku se uplatnilo
    risk?: string;            // co když se pleteme
    confidence: 'jisté' | 'pravděpodobné' | 'odhad';
  };
  done?: boolean;             // tým odškrtne → sdílený stav přes SSE
};
```
- Karty generují **pravidla** (`rules/*.ts`). Jedno pravidlo = jedna čistá funkce `(snapshot, config) => ActionCard[]` s unit testem na fixtures.
- Kroky (`steps`) obsahují **konkrétní hodnoty** (materiál, DC, cena, množství), aby se daly naťukat do SAPu bez přemýšlení. Tlačítko „kopírovat“ u každé hodnoty.
- Ikona (?) otevře **popover / boční panel**, nikdy modál. Panel se dá nechat otevřený.
- Odškrtnutá karta zešedne a sjede dolů. Vidí to celý tým.

### Klikací návody per T-code [OVĚŘIT – zkontrolovat v ostré hře, texty jsou v `config/howto.ts` a v UI editovatelné]
| Akce | T-code / dlaždice | Kroky (šablona) |
|---|---|---|
| Změna ceny | Change Price List – **VK32** | Otevři → vyber materiál `{mat}` a DC `{dc}` → přepiš cenu na `{price}` → Save |
| Marketing | Marketing Expense Planning – **ZADS** | Vyber materiál `{mat}`, region `{area}` → zadej částku `{eur}` → Save |
| Výroba | MRP (Planning) → Convert Planned Orders – **CO41** | Spusť MRP → v CO41 vyber zakázky `{mat}` → Convert |
| Nákup | Procurement – Create Purchase Order (ME59N / ME21N) | Vyber surovinu `{mat}`, dodavatele `{vendor}`, množství `{qty}` → Save |
| Splátka úvěru | Accounting – Loan repayment | Zadej částku `{eur}` → Post |
| Kapacita / setup | Accounting – Investment | Zadej typ investice + částku `{eur}` → Post |

### Strategický playbook (pravidla, která generují karty)
Na Velínu je nahoře **lišta fáze kola** (podle aktuálního dne z dat): `Před kolem` · `Start (den 1–3)` · `Běh (4–15)` · `Konec (16–20)`.
Každé pravidlo má v `why.rule` lidsky čitelný název.

**Před kolem / mezi koly**
- R1 *Lot size*: když bylo v minulém kole > 6 přestaveb → navrhni zvýšit max lot v MM02 (smí se jen mezi koly). Proč: každá přestavba = 8 h = ~8 000 ks ztracené kapacity.
- R2 *Sortiment*: vyber 4–6 SKU s nejvyšší marží na kus kapacity a s poptávkou. Proč: méně SKU = méně přestaveb.
- R3 *Kanály*: každý DC s 0 prodeji, kde dané balení prodávat smí (DC10 = 1 kg, DC14 = 500 g) → nastavit cenu ve VK32.

**Start kola**
- R4 *Suroviny na rozjezd*: sklad surovin < spotřeba na 5 dní → **kritická** karta „objednej hned“. Proč: lead time 1–5 dní. Ve cvičné hře stála výroba celých 5 dní.
- R4b *Nákupní plán*: potřeba = BOM × plán výroby na příštích N dní (N = lead time + 2, default 5) − sklad surovin − otevřené PO (Status ≠ Delivered). Kladný rozdíl → karta „objednej X kg suroviny Y u V01“ s konkrétními množstvími. Obaly zaokrouhlit nahoru na násobky dávky.
- R15 *Recept*: když je aktuální recept dražší než nejlevnější validní → karta s úsporou €/kus a €/kolo, T-code ZCS02, confidence „odhad“ + riziko „možný vliv na poptávku – nejdřív otestuj na jednom SKU“.
- R5 *Výroba běží*: žádná otevřená výrobní zakázka → kritická karta.

**Běh kola**
- R6 *Cena nahoru*: SKU vyprodáno nebo < 3 dny pokrytí a naše cena ≤ tržní průměr + 10 % → zvedni o krok. Proč: prodáváš všechno, takže necháváš peníze na stole.
- R7 *Cena dolů*: > 10 dní pokrytí → sniž směrem k tržnímu průměru, nikdy pod unit cost. Proč: sklad na konci se oceňuje v nákladech, marže se ztratí.
- R8 *Výrobní pořadí*: plán dalších dávek seřazený podle marže na kus × nedostatek. Sdružené do běhů po ≥ 2 dávkách.
- R9 *Využití kapacity*: prostoj > 0,5 dne → karta.
- R10 *Marketing*: jen DC14 / 500 g, a jen když máme sklad. Proč: bez zboží reklama jen pálí peníze.

**Konec kola**
- R11 *Suroviny přes hranici kola*: objednej na prvních 5 dní dalšího kola (deadline = den 20 − lead time).
- R12 *Doprodej*: SKU s > 5 dny pokrytí → mírná sleva, ať zboží neleží (sklad se oceňuje v nákladech).
- R13 *Finance* (jen s finančními výkazy): volný cash nad rezervu → splátka úvěru. Ukaž dopad na úrok a valuaci a ověř, že rating se nezmění.

### Obrazovka Velín (layout)
```
┌ Fáze: ● Běh kola (den 9/20) ─ Valuace 77,3M ▲ ─ Data: 🟢 1 min ┐
│ KRITICKÉ (červené karty, max 3)                                 │
│ DALŠÍ AKCE (seřazeno podle dopadu €)            [✓ hotovo]  (?)  │
├──────────────────────┬──────────────────────────────────────────┤
│ Sklad: dny pokrytí   │ Výroba: využití %, prostoje, setupy      │
│ (heatmapa SKU)       │ Ceny: naše vs trh per SKU (mini tabulka) │
└──────────────────────┴──────────────────────────────────────────┘
```
- Nahoře vždy **max 3 kritické karty**. Víc lidi v tlaku nepřečtou.
- Každé číslo na Velínu má taky (?) s vysvětlením, co znamená a odkud je (report + sloupec).
- Záložka **„Strategie“**: celý playbook čitelně (pravidla R1–R13 s vysvětlením), aby si to tým přečetl před hrou. Obsah se generuje z metadat pravidel, takže se nepíše dvakrát.

## 6b. ZERO-CODE BĚHEM EVENTU (tvrdé pravidlo)
Cvičná data jsou z **Manufacturing Introduction**, soutěž poběží na **Manufacturing Extended**. Během eventu se nesmí sahat do kódu. Proto:
1. **Všechny herní parametry** (počáteční cash/úvěr/sklad, fixní náklady, kapacita, setup, lot size, délka kola, počet kol, rating tabulka, krok ceny) jsou v `config/game.ts` jako výchozí hodnoty a v UI je obrazovka **„Nastavení hry“**, která je přepíše (uloženo v SQLite). Předvolby: `intro` (kalibrováno na fixtures) a `extended` (z briefingu).
2. **Žádný odhad, kde existují reportovaná data.** Profit, cash, AR, AP, Loan se berou z finančních výkazů, když jsou k dispozici. Odhad z prodejů − fixní náklady je jen fallback a v UI je viditelně označený „odhad“.
3. **Autokalibrace valuace**: appka spočítá valuaci vzorcem z kap. 2 a porovná ji s reportovanou (Company-Valuation). Odchylka > 5 % → žlutý banner + korekční faktor `reported/computed` aplikovaný na what-if. Rozhodování ukazuje **delta valuace** (dopad akce), ne absolutní predikci.
4. **Sanity checky configu vůči datům** (jen varování, nic nepadá): počáteční sklad ≠ 0, unit cost z ProductionReport ≠ config, délka kola ≠ max Day v datech, neznámé SKU/DC/regiony.
5. **Ingest nikdy nespadne**: neznámá hlavička → mapovací dialog (přetáhni sloupec → pole), uloží se jako profil. Chybějící nepovinný sloupec → analýza, která ho potřebuje, se schová s vysvětlením. Ostatní běží dál.
6. **Každá analýza degraduje sama**: když chybí report, kartička řekne „nahraj X“ místo chyby.
7. Test `e2e`: načti fixtures → všechny obrazovky se vyrenderují bez chyby. Totéž s jedním náhodně vynechaným reportem a s přejmenovaným sloupcem.

## 7. Postup práce pro Claude Code
- Pořadí: parsery + normalizace nad `fixtures/` → analýzy z 4.4 (čisté funkce + testy s kontrolními součty) → UI Velín + Ingest → vzorce z kapitoly 2 (rating, what-if) → zbytek.
- Pro reporty ze 4.2, které ještě nemáme, nepiš parser naslepo. Udělej rozhraní (typ + prázdný adapter) a požádej mě o export. Hlavičky si nevymýšlej.
- Každý [OVĚŘIT] předpoklad má v kódu přepínač nebo parametr a je vypsaný v `docs/assumptions.md`.
- Malé commity, `npm test` musí procházet před každým commitem.
