import type { StateResponse } from '../api.ts';
import { Panel } from '../components/ui.tsx';

const SECTIONS: { title: string; items: string[] }[] = [
  {
    title: 'Role v týmu GG',
    items: [
      '1 · Suroviny a MRP: MD61 → MD01 → ME59N. Hlídá tabulku MD61 a karty „dojde za X dne“. Nahrává ZMB52.',
      '2 · Výroba: CO41 po dodání surovin, ZCS02. Hlídá kartu MRP cyklu. Zástup za #1.',
      '3 · Ceny: VK32 pro DC 10/12/14. Hlídá tabulku VK32. Nahrává ZVA05 + ZMARKET (den 5/10/15/20).',
      '4 · Kapitán: ZADS, ZFB50, ruční finance, karty investic mezi koly. Zástup za #3.',
      'Appka rozhoduje – kdo má kartu, naťuká ji a dá ✓. Důvod je pod (?).',
    ],
  },
  {
    title: 'Před hrou',
    items: [
      'Sortiment (default F02, F03, F11, F12, F13) – top 5 podle tržeb trhu, pokryje DC 10/12/14.',
      'ZCS02 recept nech 35 / 35 / 30 – po první výrobě je zamčený.',
      'VK32 startovní ceny jen tam, kde se balení smí prodávat.',
      'ZFB50 setup reduction podle marginální tabulky (návratnost > 2×).',
      'MD61 1. cyklus: 1 kg po 48 000, 500 g po 24 000 → MD01 → ME59N (Fixed Vendor prázdné) → CO41.',
      '2. MRP cyklus nejpozději den 4–5 (lead time až 5 dní).',
    ],
  },
  {
    title: 'Během kola (každý cyklus)',
    items: [
      'Nahraj ZMB52 + ZVA05 (+ ZMARKET každých 5 dní).',
      'MD61 podle tabulky → MD01 → zkontroluj planned orders → ME59N → CO41.',
      'VK32: pokrytí < 3 dny → +0,30 €, > 8 dní → −0,30 € (ne pod kotvu trhu −10 %), nikdy pod unit cost.',
      'Max 5 karet, max 2 kritické – vždy nahoře to s největším dopadem v €.',
    ],
  },
  {
    title: 'Mezi koly',
    items: ['Splátka úvěru: cash − rezerva (rating se nemění, úrok klesá).', 'Setup / kapacita jen s návratností.', 'Lot size jen přes MM02 se svolením instruktora.'],
  },
  {
    title: 'Pravidla hry',
    items: [
      'Bez zásob se nic neprodá. Preference zákazníků se nemění.',
      'Konečný sklad se oceňuje v nákladech → nikdy neprodávat pod nákladem.',
      'Zakázky ve frontě nejdou přeřadit ani zrušit. CO41 jen když jsou všechny suroviny skladem.',
      'Ceny surovin se mění každých 5 dní.',
    ],
  },
  {
    title: 'Otevřené [OVĚŘIT]',
    items: [
      'Jak MD61 spotřebovává prognózu prodeji (přepínač režimu v Nastavení).',
      'Sortiment, startovní ceny, setup 125k, boost poptávky × 1,2 – odhady.',
      'Úrok závisí na ratingu a prime rate – může se změnit.',
    ],
  },
];

export function Strategie(_: { s: StateResponse }) {
  return (
    <div className="space-y-4">
      {SECTIONS.map((x) => (
        <Panel key={x.title} title={x.title}>
          <ul className="list-disc space-y-1 pl-5">
            {x.items.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </Panel>
      ))}
    </div>
  );
}
