# Předpoklady a [OVĚŘIT] body

Vše, co se může lišit mezi Intro a Extended, je parametr v `config/game.ts` a dá se změnit v appce v záložce **Nastavení** (uloží se do SQLite). Tabulka uvádí, kde je přepínač a jak předpoklad ověřit v cvičném kole.

## Herní parametry

| # | Předpoklad | Výchozí hodnota | Přepínač | Jak ověřit |
|---|---|---|---|---|
| 1 | Kapacita linky | 24 000 ks/den (intro i extended) | `capacityPerDay` | Intro má stroje za €16M, což by mohlo znamenat 16k/den. Při 24k vychází využití 40–53 %, jak čekal briefing. Zjisti z ProductionReportu, kolik ks se reálně vejde do dne při plné lince. |
| 2 | Kapacita se počítá v kusech bez ohledu na gramáž | ano | `capacityInUnits` | Porovnej délku 16k dávky 1 kg vs. 500 g (Start/Finish). |
| 3 | Počet kol | 4 | `rounds` | Instruktor / briefing. Ovlivňuje převod profit → valuace (×12 / kola / diskont). |
| 4 | Recept Original | 50 % oats / 50 % wheat | `recipes['5']` | Unit Cost v ProductionReportu po první výrobě F05/F15. Sanity check upozorní na nesoulad. |
| 5 | Recept Mixed | 35/35 + 4 × 7,5 % | `recipes['6']` | Totéž pro F06/F16. |
| 6 | Složení receptu neovlivňuje poptávku | ne | `recipeAffectsDemand` | R15 nejdřív na jednom SKU a 2–3 dny sledovat prodeje. Ověřit i to, že ZCS02 jde v dané verzi měnit. |
| 7 | Počáteční sklad | intro 30 000/SKU, extended 0 | `initial.finishedGoodsPerSku` | Sanity check upozorní, pokud data (PO od V03) ukazují něco jiného. |
| 8 | Fixní náklady Intro | 14 600 €/den (dopočteno) | `fixedCostPerDay` | ZCK11 / Income Statement. |
| 9 | Rating bez finančních výkazů | intro AAA+, extended A− | `defaultRating` | Formulář Finance → ✅ / ❌ kontrola. |
| 10 | Rezerva hotovosti pro splátku úvěru (R13) | 500 000 € | `cashReserve` | ZFF7B; ověřit, co se stane při záporném cashi. |
| 11 | Využití přidané kapacity ve what-if | 50 % | `extraCapacityUtilization` + posuvník | Odhad poptávky. |
| 12 | Marketing | 1 000 €/region/den, jen DC 14 | `marketingEurPerRegionDay`, `marketingDcs` | Chybí export ZADS, takže efekt reklamy není změřený. |
| 13 | Lead time surovin | max 5 dní, horizont nákupu 5 dní | `leadTimeDaysMax`, `purchaseHorizonDays` | `firstSeenGameDay` v DB + `Reception` v PO Tracking. |
| 14 | Max lot size | 48 000 | `lotMax` | MM02 mezi koly. R1 navrhuje `max(lotMax, 3 × lotMin)`. |
| 15 | Klikací návody per T-code | `config/howto.ts` | Nastavení → Návody (JSON) | Projít v ostré hře, hlavně ME59N vs. ME21N, Loan, Investment. |

## Metodika analýz (rozhodnutí, ne fakta z briefingu)

- **Dny pokrytí** = sklad ÷ průměrný prodej za posledních 5 dní, kdy byl SKU **skladem** (hledá se max. 20 dní zpět). Zadání ve 4.4 říká „posledních 5 herních dní“, jenže výpadek by pak vypadal jako nízká poptávka. Okno je `coverageWindowDays`.
- **Rekonstrukce skladu**: počáteční sklad (PO od `ignoreVendors` = V03, jinak config) + dokončená výroba (Confirmed k datu Finish) − prodeje. Na fixtures sedí na kus s InventoryReportem u všech 12 SKU.
- **Den výpadku (stockout)** = SKU, které jsme v kole prodávali, začíná den s nulovým zrekonstruovaným skladem a trh ho v tom 5denním okně kupoval. **Ztracené kusy** = poptávka ve dnech se skladem, zastropovaná tržním objemem × naším nejvyšším dosaženým podílem. Je to odhad.
- **Poptávka pro výrobní plán** = prodeje / dny se skladem za posledních 20 dní.
- **Cena per SKU**: PriceMarket nemá DC, takže doporučená cena se aplikuje na DC, kde jsme SKU prodávali (default 12).
- **Dopad na valuaci (`impactEUR`)** = ΔProfit × 12 / (počet kol × diskont), kde diskont je z finančního výkazu, jinak z `defaultRating`. Řadí se podle něj. Vysoké hodnoty (×30) jsou dané vzorcem valuace.
- **Fáze kola**: start = den ≤ 3, konec = den ≥ délka kola − 4. „Před kolem“ se zapíná ručně (Nastavení → Herní čas), protože data mezi koly vypadají stejně jako den 20.
- **Otevřené PO** = status, který neobsahuje „deliver“ (ve fixtures je jen `Delivered`). V Extended čekej další hodnoty.
- **Dodavatel**: nejlevnější s `Source = X` z ProcSourcing (Extended může mít víc dodavatelů na materiál).

## Zjištění z dat, která se liší od CLAUDE.md

- Kolo 2 má v ProductionReportu **10 přestaveb** (Setup = 8 h), ne 12. R1 se spouští nad limit `maxChangeoversPerRound` = 6.
- Odhad marže na kus v kole 3 sedí (F12 6,28; F13 5,83; F01 4,17), drobné rozdíly jsou jen zaokrouhlení.

## Chybějící reporty

| Co | Stav |
|---|---|
| Finanční výkazy | Ruční formulář ve **Finance** (Fiori nemá xlsx export). [OVĚŘIT], jestli existuje Trial Balance s exportem. |
| Marketing (ZADS) | Export není. R10 je proto jen „odhad“. |
| BOM (ZCS02) | Dopočítává se z receptu v configu. Shoda s Unit Cost je ověřená testem. |
| SalesReport pro všechny DC | [PRAVDĚP.] obsahuje všechny DC. Fixtures mají jen DC 12. |
