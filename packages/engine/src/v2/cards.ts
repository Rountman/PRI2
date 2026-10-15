// 4.2 / 5.5 Action cards during a round: MD61 cycle, VK32 price changes, alerts, investments.
import { fmtEUR, fmtNum, fmtPrice, sapValue } from '../format.ts';
import { isFinishedGood } from '../normalize.ts';
import type { ActionCard } from '../types.ts';
import { avgMargin, capacityAdvice, changeoversPerRound, loanAdvice, setupMarginalTable } from './invest.ts';
import type { Md61Plan, Md61Row } from './md61.ts';
import { allowedDcs, type Model } from './model.ts';
import type { Vk32Table } from './vk32.ts';

const MRP = 'MD61 → MD01 → ME59N → CO41';
const d1 = (x: number | null) => (x === null ? '∞' : fmtNum(x, 1));

function card(m: Model, c: Omit<ActionCard, 'impactEUR'>): ActionCard {
  return { ...c, impactEUR: c.profitEUR !== undefined ? m.toValuation(c.profitEUR) : undefined };
}

const forecastCopy = (rows: Md61Row[]) => rows.map((r) => ({ label: r.mat, value: sapValue(r.forecast, 0) }));
const mrpSteps = (md: Md61Plan, rows: Md61Row[]) => [
  ...rows.map((r) => `MD61 ${r.mat} = ${fmtNum(r.forecast)} (→ planned ${r.lots.length ? r.lots.map((l) => fmtNum(l)).join(' + ') : '0'})`),
  'MD01: spusť MRP, zkontroluj, že planned orders sedí s tabulkou MD61.',
  'ME59N (Fixed Vendor prázdné) → po dodání surovin CO41.',
  ...rows.filter((r) => r.cut).map((r) => `Kapacita: ${r.mat} kráceno (nejnižší marže/ks z plánu)`),
];

/** 5.5 Alerts – critical cards. Each fires only when its inputs exist. */
export function alerts(m: Model, md: Md61Plan, vk: Vk32Table): ActionCard[] {
  const { cfg, ds, a } = m;
  const g = m.gameDay;
  const out: ActionCard[] = [];
  const lead = cfg.md61.leadTimeMax;

  // SKU sold out / runs out before new production can arrive
  if (a.has.inventory)
    for (const r of md.rows) {
      const d = r.demand.perDay;
      if (d <= 0 || (!cfg.assortment.includes(r.sku) && r.stock <= 0 && r.wip <= 0)) continue;
      const sold = r.stock <= 0;
      const cover = (r.stock + r.wip) / d;
      if (!sold && cover >= lead) continue;
      const lostDays = sold ? (1 + lead) / 2 : Math.max(0, lead - cover);
      const profit = lostDays * d * Math.max(0, r.margin);
      const when = sold ? `${r.mat} vyprodaný` : `${r.mat} dojde za ${d1(cover)} dne`;
      const data = [
        { label: 'Sklad', value: `${fmtNum(r.stock)} ks` },
        { label: 'Rozpracovaná výroba', value: md.wipKnown ? `${fmtNum(r.wip)} ks` : 'neznámá (chybí ProductionReport)' },
        { label: 'Poptávka / den', value: `${fmtNum(d)} ks${r.demand.boosted ? ` (× ${cfg.md61.stockoutBoost} – byl vyprodaný)` : ''}` },
        { label: 'Marže / ks', value: fmtPrice(r.margin) },
      ];
      if (r.planned <= 0) {
        // capacity is full and this SKU has the lowest margin → it cannot be produced now; sell the rest dearer
        const raise = vk.rows.find((x) => x.sku === r.sku)?.cells.filter((c) => c.action === 'zvýšit') ?? [];
        out.push(
          card(m, {
            id: `alert:stock:${r.sku}:d${g}`,
            kind: 'alert',
            priority: 'běžné',
            title: `${when} – kapacita plná${raise.length ? ` → zvedni cenu ${raise.map((c) => `DC ${c.dc} na ${fmtPrice(c.recommended)}`).join(', ')}` : ''}`,
            profitEUR: raise.reduce((x, c) => x + (c.delta ?? 0) * c.demandPerDay * Math.min(lead, m.remainingDays), 0),
            tcode: raise.length ? 'VK32' : 'MD61',
            steps: [
              `Kapacita na ${md.horizon} dní je plná – ${r.mat} má nejnižší marži/ks, proto se teď nevyrábí.`,
              ...raise.map((c) => `VK32: ${r.mat}, DC ${c.dc}: ${fmtPrice(c.current)} → ${sapValue(c.recommended)}`),
              'Zbytek skladu prodej dráž; do výroby se vrátí, až se uvolní kapacita (nebo zvaž +kapacitu v Rozšířené → Investice).',
            ],
            copyValues: raise.map((c) => ({ label: `${r.mat} DC${c.dc}`, value: sapValue(c.recommended) })),
            why: { summary: 'Vyprodá se dřív, než by stihla výroba – ale kapacitu má lepší marže jinde.', data, rule: '5.2 kapacitní kontrola + 5.5', confidence: 'pravděpodobné' },
          }),
        );
        continue;
      }
      out.push(
        card(m, {
          id: `alert:stock:${r.sku}:d${g}`,
          kind: 'alert',
          priority: 'kritické',
          title: `${when} → MD61 ${r.mat} = ${fmtNum(r.forecast)}`,
          profitEUR: profit,
          deadline: 'teď – lead time až ' + lead + ' dní',
          tcode: MRP,
          steps: mrpSteps(md, [r]),
          copyValues: forecastCopy([r]),
          why: {
            summary: sold ? 'Bez zásob se nic neprodá – každý den bez zboží = ztracená marže.' : `Sklad + rozpracovaná výroba vydrží méně než lead time surovin (${lead} dní).`,
            data,
            rule: '5.5 SKU vyprodaný / dojde dřív než lead time',
            confidence: md.wipKnown ? 'pravděpodobné' : 'odhad',
          },
        }),
      );
    }

  // production queue ends within lead time and no new MRP cycle (no open purchase orders)
  if (a.has.production) {
    const queued = Object.values(m.wip).reduce((x, y) => x + y, 0);
    const days = queued / cfg.capacityPerDay;
    const openPO = ds.purchases.some((p) => !cfg.ignoreVendors.includes(p.vendor) && (p.reception === null || p.reception > g));
    if (days < lead && !(a.has.purchases && openPO)) {
      const rows = md.rows.filter((r) => r.planned > 0);
      out.push(
        card(m, {
          id: `alert:queue:d${g}`,
          kind: 'alert',
          priority: 'kritické',
          title: `Výroba doběhne za ${d1(days)} dne – spusť nový MRP cyklus`,
          profitEUR: Math.max(0, lead - days) * cfg.capacityPerDay * Math.max(0, avgMargin(m)),
          deadline: 'teď',
          tcode: MRP,
          steps: mrpSteps(md, rows),
          copyValues: forecastCopy(rows),
          why: {
            summary: `Ve frontě je ${fmtNum(queued)} ks, suroviny dorazí až za 1–${lead} dní. Linka bude stát.`,
            data: [
              { label: 'Ve frontě', value: `${fmtNum(queued)} ks ≈ ${d1(days)} dne` },
              { label: 'Otevřené nákupní objednávky', value: a.has.purchases ? (openPO ? 'ano' : 'ne') : 'neznámé' },
            ],
            rule: '5.5 Do konce výroby < lead time',
            confidence: 'pravděpodobné',
          },
        }),
      );
    }
  }

  // price below unit cost
  for (const r of vk.rows)
    for (const c of r.cells)
      if (c.belowCost)
        out.push(
          card(m, {
            id: `alert:cost:${r.sku}:${c.dc}:d${g}`,
            kind: 'alert',
            priority: 'kritické',
            title: `Cena ${r.mat} v DC ${c.dc} (${fmtPrice(c.current)}) je pod nákladem ${fmtPrice(r.unitCost)} → VK32 ${fmtPrice(c.recommended)}`,
            profitEUR: (r.unitCost - (c.current ?? 0)) * c.demandPerDay * 5,
            tcode: 'VK32',
            steps: [`VK32: ${r.mat}, DC ${c.dc} → ${sapValue(c.recommended)}`],
            copyValues: [{ label: `${r.mat} DC${c.dc}`, value: sapValue(c.recommended) }],
            why: {
              summary: 'Každý prodaný kus prodělává. Konečný sklad se oceňuje v nákladech – neprodávat pod nákladem.',
              data: [
                { label: 'Naše cena', value: fmtPrice(c.current) },
                { label: `Unit cost (${r.unitCostSource})`, value: fmtPrice(r.unitCost) },
              ],
              rule: '5.5 Cena pod unitCost',
              confidence: 'jisté',
            },
          }),
        );

  // storage over capacity
  if (a.has.inventory) {
    const fg = Object.entries(m.stock).filter(([s]) => isFinishedGood(s)).reduce((x, [, v]) => x + Math.max(0, v), 0);
    const checks = [
      { key: 'finishedGoods' as const, label: 'hotové výrobky', qty: fg, unit: 'ks' },
      { key: 'raw' as const, label: 'suroviny', qty: m.rawStock.kg, unit: 'kg' },
      { key: 'packaging' as const, label: 'obaly', qty: m.rawStock.packaging, unit: 'ks' },
    ];
    for (const c of checks) {
      const lim = cfg.storage[c.key];
      if (c.qty <= lim) continue;
      const perDay = Math.ceil((c.qty - lim) / 50_000) * cfg.storageExtraPerDay[c.key];
      out.push(
        card(m, {
          id: `alert:storage:${c.key}:d${g}`,
          kind: 'alert',
          priority: 'kritické',
          title: `Sklad (${c.label}) nad kapacitou: ${fmtNum(c.qty)} / ${fmtNum(lim)} ${c.unit}`,
          profitEUR: perDay * Math.min(10, m.remainingDays),
          tcode: c.key === 'finishedGoods' ? 'VK32' : 'MD61',
          steps: c.key === 'finishedGoods' ? ['Sniž ceny u SKU s vysokým pokrytím (tabulka VK32).', 'Sniž prognózu MD61 v dalším cyklu.'] : ['Sniž prognózu MD61 – MRP objedná méně surovin.'],
          why: {
            summary: `Přetečení skladu stojí ${fmtEUR(perDay)}/den navíc.`,
            data: [{ label: 'Příplatek', value: `${fmtEUR(cfg.storageExtraPerDay[c.key])}/den za 50 000 ${c.unit}` }],
            rule: '5.5 Sklad nad kapacitou',
            confidence: 'jisté',
          },
        }),
      );
    }
  }

  // channel without sales – only when sales data exist and we have a SKU allowed there
  if (a.has.sales) {
    const W = cfg.md61.demandWindow;
    for (const ch of cfg.channels) {
      const skus = md.rows.filter((r) => allowedDcs(cfg, r.sku).includes(ch.dc) && (r.stock > 0 || cfg.assortment.includes(r.sku)));
      if (!skus.length) continue;
      if (ds.sales.some((s) => s.dc === ch.dc && s.gameDay > g - W)) continue;
      const cells = vk.rows.flatMap((r) => r.cells.filter((c) => c.dc === ch.dc && skus.some((s) => s.sku === r.sku)).map((c) => ({ sku: r.mat, c, cost: r.unitCost })));
      const ratio = cells.length ? cells.reduce((x, y) => x + (y.c.recommended - y.cost) / y.c.recommended, 0) / cells.length : 0.5;
      out.push(
        card(m, {
          id: `alert:dc:${ch.dc}:d${g}`,
          kind: 'alert',
          priority: 'kritické',
          title: `DC ${ch.dc} (${ch.name}) bez prodejů ${W} dní – nastav ceny ve VK32`,
          profitEUR: (ch.marketPer5DaysPerTeam / 5) * ratio * Math.min(5, m.remainingDays),
          tcode: 'VK32',
          steps: cells.map((x) => `VK32: ${x.sku}, DC ${ch.dc} → ${sapValue(x.c.recommended)}`),
          copyValues: cells.map((x) => ({ label: `${x.sku} DC${ch.dc}`, value: sapValue(x.c.recommended) })),
          why: {
            summary: `Za posledních ${W} dní jsme v DC ${ch.dc} neprodali nic, přestože sem naše balení smí. Pravděpodobně chybí cena.`,
            data: [
              { label: 'Balení v kanálu', value: ch.sizes.join(', ') },
              { label: 'Trh / tým / 5 dní', value: fmtEUR(ch.marketPer5DaysPerTeam) },
            ],
            rule: '5.5 Kanál bez ceny',
            risk: 'Když je zboží vyprodané, 0 prodejů je kvůli skladu, ne ceně.',
            confidence: 'pravděpodobné',
          },
        }),
      );
    }
  }
  return out;
}

/** Main MD61 cycle card + VK32 changes + investment cards between rounds. */
export function roundCards(m: Model, md: Md61Plan, vk: Vk32Table): ActionCard[] {
  const { cfg, a } = m;
  const g = m.gameDay;
  const out: ActionCard[] = [];

  const planned = md.rows.filter((r) => r.planned > 0);
  if (planned.length && (a.has.inventory || a.has.sales)) {
    const shortfall = planned.reduce((x, r) => x + Math.max(0, r.demand.perDay * md.horizon - r.stock - r.wip) * Math.max(0, r.margin), 0);
    out.push(
      card(m, {
        id: `md61:d${g}`,
        kind: 'md61',
        priority: 'běžné',
        title: `MRP cyklus: ${planned.map((r) => `${r.mat} = ${fmtNum(r.forecast)}`).join(', ')}`,
        profitEUR: shortfall,
        tcode: MRP,
        steps: mrpSteps(md, planned),
        copyValues: forecastCopy(md.rows),
        why: {
          summary: `Prognóza na ${md.horizon} dní (příští MRP + lead time). Pokryje poptávku, kterou sklad a výroba nepokryjí.`,
          data: [
            ...md.rows.map((r) => ({ label: r.mat, value: `poptávka ${fmtNum(r.demand.perDay)}/den · sklad ${fmtNum(r.stock)} · výroba ${fmtNum(r.wip)} → ${fmtNum(r.forecast)}` })),
            { label: 'Kapacita', value: `${fmtNum(md.capacity.used)} / ${fmtNum(md.capacity.available)} ks (${md.capacity.setups} setupy)` },
          ],
          rule: '5.2 MD61',
          risk: md.wipKnown ? '[OVĚŘIT] jak MD61 spotřebovává prognózu prodeji – po MD01 porovnej planned orders.' : 'Rozpracovaná výroba neznámá (ProductionReport v Rozšířeném) – počítá se 0.',
          confidence: 'pravděpodobné',
        },
      }),
    );
  }

  for (const r of vk.rows) {
    const ch = r.cells.filter((c) => c.action === 'zvýšit' || c.action === 'snížit');
    if (!ch.length) continue;
    const up = ch[0].action === 'zvýšit';
    const profit = up
      ? ch.reduce((x, c) => x + (c.delta ?? 0) * c.demandPerDay * Math.min(5, m.remainingDays), 0)
      : Math.max(0, r.stock - cfg.pricing.highCoverDays * (m.demand[r.sku]?.perDay ?? 0)) * Math.max(0, ch[0].recommended - r.unitCost) * 0.5;
    out.push(
      card(m, {
        id: `vk32:${r.sku}:d${g}`,
        kind: 'vk32',
        priority: 'běžné',
        title: `${up ? 'Zvedni' : 'Sniž'} cenu ${r.mat} ${ch.map((c) => `v DC ${c.dc} na ${fmtPrice(c.recommended)}`).join(', ')}`,
        profitEUR: profit,
        tcode: `VK32 · DC ${ch.map((c) => c.dc).join('/')}`,
        steps: ch.map((c) => `VK32: ${r.mat}, DC ${c.dc}: ${fmtPrice(c.current)} → ${sapValue(c.recommended)}`),
        copyValues: ch.map((c) => ({ label: `${r.mat} DC${c.dc}`, value: sapValue(c.recommended) })),
        why: {
          summary: ch[0].reason,
          data: [
            { label: 'Sklad', value: `${fmtNum(r.stock)} ks` },
            { label: 'Pokrytí', value: `${d1(r.coverDays)} dne` },
            { label: 'Kotva trhu (ZMARKET)', value: fmtPrice(r.anchor) },
            { label: `Unit cost (${r.unitCostSource})`, value: fmtPrice(r.unitCost) },
            ...(ch.some((c) => c.warnFixed) ? [{ label: '⚠ pod unit cost + fixní/ks', value: fmtPrice(r.unitCost + r.fixedPerUnit) }] : []),
          ],
          rule: '5.3 VK32',
          risk: up ? 'Když se prodeje zastaví při plném skladu, vrať cenu o krok zpět.' : 'Snižuj po krocích – cenová válka bolí všechny.',
          confidence: 'pravděpodobné',
        },
      }),
    );
  }

  if (a.clock.phase === 'mezi-koly') {
    out.push(...investCards(m, md));
    const locked = md.rows.filter((r) => r.stock > 1000 || r.wip > 0);
    if (locked.length)
      out.push({
        id: `bom:locked:d${g}`,
        kind: 'alert',
        priority: 'běžné',
        title: `Recept už nejde měnit u ${locked.map((r) => r.mat).join(', ')}`,
        tcode: 'ZCS02',
        steps: ['ZCS02 jde jen u SKU s ≤ 1 000 ks skladem a bez výrobních zakázek.', 'Nevalidní BOM = produkt se neprodá.'],
        why: {
          summary: 'Změnu receptu plánuj u SKU, které doprodáš, ještě před dalším MRP.',
          data: locked.map((r) => ({ label: r.mat, value: `sklad ${fmtNum(r.stock)} · výroba ${fmtNum(r.wip)}` })),
          rule: '5.5 BOM zamčený',
          confidence: 'jisté',
        },
      });
  }
  return out;
}

export function investCards(m: Model, md: Md61Plan): ActionCard[] {
  const { cfg } = m;
  const out: ActionCard[] = [];
  const loan = loanAdvice(cfg, { cash: m.cash, loan: m.loan, rawNextCycle: md.materials.cost, remainingDays: m.remainingDays });
  if (m.loan > 0 && (loan.generic || loan.repay > 0)) {
    out.push(
      card(m, {
        id: `invest:loan:d${m.gameDay}`,
        kind: 'invest',
        priority: 'běžné',
        title: loan.generic ? `Splátka úvěru: každý splacený 1M ušetří ${fmtEUR(loan.perMillionPerDay)}/den` : `ZFB50 splať úvěr ${fmtEUR(loan.repay)} → úspora ${fmtEUR(loan.interestSaved)}`,
        profitEUR: loan.interestSaved,
        tcode: 'ZFB50',
        steps: loan.generic ? ['Opiš Cash a Loan do Rozšířené → Další importy (ruční finance) → appka spočítá částku.'] : ['ZFB50: splátka úvěru', `Částka ${fmtEUR(loan.repay)}`],
        copyValues: loan.generic ? [] : [{ label: 'Splátka', value: sapValue(loan.repay, 0) }],
        why: {
          summary: 'Rating se nezmění (DebtLoading = Cash − Loan zůstává), úrok klesne.',
          data: [
            { label: 'Cash', value: fmtEUR(loan.cash) },
            { label: 'Rezerva', value: `${fmtEUR(loan.reserve)} (fixní ${cfg.reserve.fixedDays} dní + suroviny + ${fmtEUR(cfg.reserve.buffer)})` },
            { label: 'Úvěr', value: fmtEUR(loan.loan) },
          ],
          rule: '5.4 Splátka úvěru',
          confidence: loan.generic ? 'odhad' : 'pravděpodobné',
        },
      }),
    );
  }
  const steps = setupMarginalTable(cfg, { currentSpend: m.setupSpend, changeoversPerRound: changeoversPerRound(m), marginPerUnit: avgMargin(m), remainingRounds: m.remainingRounds });
  const rec = steps.filter((s) => s.recommended);
  if (rec.length) {
    const last = rec.at(-1)!;
    const spend = last.to - m.setupSpend;
    const gain = rec.reduce((x, s) => x + s.gain, 0);
    out.push(
      card(m, {
        id: `invest:setup:d${m.gameDay}`,
        kind: 'invest',
        priority: 'běžné',
        title: `ZFB50 setup reduction ${fmtEUR(spend)} → ${fmtNum(last.hoursTo, 1)} h`,
        profitEUR: gain - spend,
        tcode: 'ZFB50',
        steps: ['ZFB50: investice do setupu (účet 478000)', `Částka ${fmtEUR(spend)}`],
        copyValues: [{ label: 'Částka', value: sapValue(spend, 0) }],
        why: {
          summary: `Návratnost > ${cfg.investPayback}× u ${rec.length} kroků.`,
          data: steps.map((s) => ({ label: `${fmtEUR(s.from)} → ${fmtEUR(s.to)}`, value: `${fmtNum(s.savedHours, 2)} h · ${fmtEUR(s.gain)} / ${fmtEUR(s.spend)} = ${fmtNum(s.ratio, 1)}×` })),
          rule: '5.4 Setup reduction',
          confidence: 'odhad',
        },
      }),
    );
  }
  const demand = m.skus.reduce((x, s) => x + m.demand[s].perDay, 0);
  const cap = capacityAdvice(m, demand, md.rows.filter((r) => r.stock <= 0 && r.demand.perDay > 0).length);
  if (cap.relevant && cap.net > 0) {
    out.push(
      card(m, {
        id: `invest:capacity:d${m.gameDay}`,
        kind: 'invest',
        priority: 'běžné',
        title: `ZFB50 kapacita +1 000 ks/den za ${fmtEUR(1e6)} – čistý přínos ${fmtEUR(cap.net)}`,
        profitEUR: cap.net,
        tcode: 'ZFB50',
        steps: ['ZFB50: investice do strojů', `Částka ${fmtEUR(1e6)}`],
        copyValues: [{ label: 'Částka', value: '1000000' }],
        why: {
          summary: 'Poptávka trvale převyšuje kapacitu a SKU se vyprodávají.',
          data: [
            { label: 'Poptávka / kapacita', value: `${fmtNum(cap.demandPerDay)} / ${fmtNum(cap.capacityPerDay)} ks/den` },
            { label: 'Marže z extra kapacity', value: fmtEUR(cap.gain) },
            { label: 'Odpisy', value: fmtEUR(cap.depreciation) },
            { label: 'Rating', value: cap.ratingBefore ? `${cap.ratingBefore} → ${cap.ratingAfter}` : 'neznámý (bez financí)' },
          ],
          rule: '5.4 Kapacita',
          risk: 'Výdaj zhorší DebtLoading o 1M – může spadnout rating a zvýšit diskont.',
          confidence: 'odhad',
        },
      }),
    );
  }
  return out;
}

/** Max N cards, max K critical (extra critical ones are downgraded), critical first, then by € impact. */
export function selectCards(cards: ActionCard[], maxCards: number, maxCritical: number): ActionCard[] {
  const byImpact = (x: ActionCard, y: ActionCard) => (y.profitEUR ?? 0) - (x.profitEUR ?? 0);
  const crit = cards.filter((c) => c.priority === 'kritické').sort(byImpact);
  const rest = [...crit.slice(maxCritical).map((c) => ({ ...c, priority: 'běžné' as const })), ...cards.filter((c) => c.priority !== 'kritické')].sort(byImpact);
  return [...crit.slice(0, maxCritical), ...rest].slice(0, maxCards);
}
