// 4.1 "Před hrou" – start checklist from the preset only (no data needed).
import { formatRecipe } from '../bom.ts';
import { fmtEUR, fmtNum, fmtPrice, sapValue } from '../format.ts';
import { skuFlavor, skuLabel } from '../normalize.ts';
import type { ActionCard } from '../types.ts';
import { avgMargin, setupMarginalTable } from './invest.ts';
import type { Md61Plan } from './md61.ts';
import { allowedDcs, type Model } from './model.ts';
import type { Vk32Table } from './vk32.ts';

export function pregameChecklist(m: Model, md61: Md61Plan, vk32: Vk32Table): ActionCard[] {
  const { cfg } = m;
  const skus = md61.rows.map((r) => r.sku);
  const mats = md61.rows.map((r) => r.mat);
  const sh = (x: number) => fmtNum(x, 1);
  const setup = setupMarginalTable(cfg, { currentSpend: m.setupSpend, changeoversPerRound: cfg.md61.changeoversPerRound, marginPerUnit: avgMargin(m), remainingRounds: cfg.rounds });
  const rec = setup.filter((s) => s.recommended).at(-1);
  const setupTarget = rec?.to ?? cfg.setupProposal;
  const setupSpend = Math.max(0, setupTarget - m.setupSpend);
  const mat = md61.materials;
  const cap = md61.capacity;

  const cards: ActionCard[] = [
    {
      id: 'start:1-sortiment',
      kind: 'checklist',
      priority: 'běžné',
      title: `1. Sortiment: ${mats.join(', ')}`,
      tcode: 'Nastavení',
      steps: [
        ...skus.map((s) => `${m.mat(s)} ${skuLabel(s)} → DC ${allowedDcs(cfg, s).join(' + ')}`),
        'Sortiment jde změnit v Rozšířené → Nastavení. Po prvním ZMARKET (den 5) ho appka přehodnotí.',
      ],
      copyValues: mats.map((s) => ({ label: 'Materiál', value: s })),
      why: {
        summary: 'V cvičné hře měly tyto SKU nejvyšší ceny i objemy. 4 SKU pokryjí všechny 3 DC s málo přestavbami.',
        data: [
          { label: '1 kg', value: 'DC 10 (jen 1 kg) + DC 12' },
          { label: '500 g', value: 'DC 12 + DC 14 (jen 500 g)' },
          { label: 'Přestavby', value: `${skus.length} setupy na cyklus × ${sh(m.setupHours)} h` },
        ],
        rule: '4.1 Sortiment',
        risk: 'Odhad z dat Intro – preference zákazníků v Extended se ukážou až v ZMARKET.',
        confidence: 'odhad',
      },
    },
    {
      id: 'start:2-recept',
      kind: 'checklist',
      priority: 'kritické',
      title: '2. ZCS02 recept: ponech 35 / 35 / 30 – rozhodni TEĎ',
      tcode: 'ZCS02',
      deadline: 'před prvním MD01',
      steps: [
        ...skus.map((s) => `${m.mat(s)}: ${formatRecipe(cfg.recipes[skuFlavor(s)] ?? {})}`),
        'Recept nejde změnit, když má produkt > 1 000 ks skladem nebo výrobní zakázky.',
        'Levnější recept: Rozšířené → Recept (může snížit poptávku).',
      ],
      why: {
        summary: 'Po první výrobě je recept zamčený. Nevalidní BOM = produkt se neprodá.',
        data: [
          { label: 'Minima', value: `oat ≥ ${cfg.recipeMin.oats * 100} %, wheat ≥ ${cfg.recipeMin.wheat * 100} %, příchuť ≥ ${cfg.recipeMin.flavor * 100} %` },
          { label: 'Výchozí BOM 500 g', value: '0,175 / 0,175 / 0,150 kg' },
        ],
        rule: '4.1 Recept / guide kap. 5',
        risk: 'Recept ovlivňuje atraktivitu produktu – levnější není automaticky lepší.',
        confidence: 'jisté',
      },
    },
    {
      id: 'start:3-vk32',
      kind: 'checklist',
      priority: 'běžné',
      title: `3. VK32 startovní ceny (500 g ≈ ${fmtPrice(cfg.startPrices['500g'])}, 1 kg ≈ ${fmtPrice(cfg.startPrices['1kg'])})`,
      tcode: 'VK32',
      steps: [...vk32.rows.flatMap((r) => r.cells.map((c) => `${r.mat} · DC ${c.dc} → ${fmtPrice(c.recommended)}`)), 'Ceny jen tam, kde se balení prodává (DC 10 jen 1 kg, DC 14 jen 500 g).'],
      copyValues: vk32.rows.flatMap((r) => r.cells.map((c) => ({ label: `${r.mat} DC${c.dc}`, value: sapValue(c.recommended) }))),
      why: {
        summary: 'Bez ceny ve VK32 se v kanálu neprodá nic. DC 10 je velmi cenově citlivé (−0,30 €), DC 14 snese víc (+0,30 €).',
        data: cfg.channels.map((c) => ({ label: `DC ${c.dc} ${c.name}`, value: `cena ${c.priceSensitivity}, reklama ${c.marketingSensitivity}` })),
        rule: '4.1 Startovní ceny',
        risk: 'Odhad – po prvním ZMARKET (den 5) se ceny ukotví na trh.',
        confidence: 'odhad',
      },
    },
    {
      id: 'start:4-setup',
      kind: 'checklist',
      priority: 'běžné',
      title: `4. ZFB50 setup reduction: ${fmtEUR(setupSpend)} → setup ${sh(setupTarget > 0 ? setup.find((s) => s.to === setupTarget)?.hoursTo ?? m.setupHours : m.setupHours)} h`,
      tcode: 'ZFB50',
      steps: ['ZFB50: investice do setupu (účet 478000)', `Částka ${fmtEUR(setupSpend)}`, 'Simulace reaguje okamžitě, jde i před kolem 1.'],
      copyValues: [{ label: 'Částka', value: sapValue(setupSpend, 0) }],
      why: {
        summary: `Kratší setup = víc kusů při každé přestavbě. Vyplatí se kroky s návratností > ${cfg.investPayback}×.`,
        data: setup.map((s) => ({
          label: `${fmtEUR(s.from)} → ${fmtEUR(s.to)}`,
          value: `${sh(s.hoursFrom)} → ${sh(s.hoursTo)} h · zisk ${fmtEUR(s.gain)} / výdaj ${fmtEUR(s.spend)} = ${fmtNum(s.ratio, 1)}× ${s.recommended ? '✓' : '✗'}`,
        })),
        rule: '5.4 Setup reduction (marginální tabulka)',
        risk: `Počítá s ${cfg.md61.changeoversPerRound} přestavbami/kolo a marží ${fmtPrice(avgMargin(m))}/ks. Zisk je jen když je kapacita úzké hrdlo.`,
        confidence: 'odhad',
      },
    },
    {
      id: 'start:5-md61',
      kind: 'checklist',
      priority: 'kritické',
      title: `5. MD61 prognóza 1. cyklu: ${mats.map((s) => `${s} = ${fmtNum(cfg.md61.firstCycleQty)}`).join(', ')}`,
      tcode: 'MD61',
      steps: [
        ...md61.rows.map((r) => `${r.mat}: ${fmtNum(r.forecast)} (→ planned ${r.lots.map((l) => fmtNum(l)).join(' + ')})`),
        `Celkem ${fmtNum(cap.units)} ks ≈ ${sh(cap.units / cap.perDay)} dní výroby + ${cap.setups} setupy (${sh(cap.setupUnits / cap.perDay)} dne)`,
      ],
      copyValues: md61.rows.map((r) => ({ label: r.mat, value: sapValue(r.forecast, 0) })),
      why: {
        summary: 'Sklad je na startu prázdný – bez prognózy MRP nic nenaplánuje a bez zásob se nic neprodá.',
        data: [
          { label: 'Suroviny', value: `${fmtNum(mat.rawKg)} kg (limit ${fmtNum(cfg.storage.raw)}) ${mat.rawKg <= mat.rawLimit ? '✓' : '✗'}` },
          { label: 'Obaly', value: `${fmtNum(mat.packaging)} ks (limit ${fmtNum(cfg.storage.packaging)}) ${mat.packaging <= mat.packagingLimit ? '✓' : '✗'}` },
          { label: 'Náklad na suroviny', value: `${fmtEUR(mat.cost)} (cash ${fmtEUR(mat.cash)}) ${mat.cash === null || mat.cost <= mat.cash ? '✓' : '✗'}` },
          { label: 'Lot size', value: `${fmtNum(cfg.lotMin)}–${fmtNum(cfg.lotMax)}` },
        ],
        rule: '4.1 / 5.2 MD61',
        confidence: 'jisté',
      },
    },
    {
      id: 'start:6-mrp',
      kind: 'checklist',
      priority: 'běžné',
      title: '6. MD01 → ME59N (Fixed Vendor prázdné) → po dodání CO41',
      tcode: 'MD01 → ME59N → CO41',
      steps: [
        'MD01: spusť MRP – vzniknou planned orders + nákupní požadavky.',
        'ME59N: převeď požadavky na objednávky. Pole Fixed Vendor nech PRÁZDNÉ.',
        `Počkej na dodání surovin (lead time 1–${cfg.md61.leadTimeMax} dní).`,
        'CO41: převeď planned orders na výrobní zakázky – jde jen když jsou VŠECHNY suroviny skladem.',
      ],
      why: {
        summary: 'Zakázky ve frontě nejdou přeřadit ani zrušit – pořadí CO41 = pořadí výroby.',
        data: [{ label: 'Dodavatelé', value: 'V01, V02 · splatnost 20 dní' }],
        rule: 'Job aid Extended',
        confidence: 'jisté',
      },
    },
    {
      id: 'start:7-mrp2',
      kind: 'checklist',
      priority: 'běžné',
      title: '7. Připomínka: 2. MRP cyklus nejpozději den 4–5',
      tcode: 'MD61 → MD01 → ME59N',
      deadline: 'den 4–5',
      steps: [`Suroviny musí dorazit dřív, než doběhne 1. cyklus (≈ ${sh(cap.days)} dne výroby, lead time až ${cfg.md61.leadTimeMax} dní).`, 'Po nahrání InventoryReport + SalesReport appka spočítá další MD61.'],
      why: {
        summary: 'Bez překryvu cyklů linka stojí a fixní náklady běží dál.',
        data: [
          { label: 'Fixní náklady', value: `${fmtEUR(m.fixedPerUnit * cfg.capacityPerDay)}/den` },
          { label: 'Kapacita', value: `${fmtNum(cfg.capacityPerDay)} ks/den` },
        ],
        rule: '4.1 krok 7',
        confidence: 'pravděpodobné',
      },
    },
  ];
  return cards;
}
