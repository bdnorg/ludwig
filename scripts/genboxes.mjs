// Generate the built-in gamebox packages under public/gameboxes/ (M18).
// Gameboxes are pure config; this script exists so the JSON stays exactly
// reproducible from one place. Re-run after changing a built-in:
//   node scripts/genboxes.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'gameboxes');

function writeBox(dir, manifest) {
  mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`wrote ${dir}/manifest.json (${manifest.layout.length} layout items)`);
}

// ---- standard 52-card deck (mirror of src/lib/model/cards52.ts) ----------
const SUITS = [
  { sym: '♠', color: '#1b1b20' },
  { sym: '♥', color: '#c0303a' },
  { sym: '♦', color: '#c0303a' },
  { sym: '♣', color: '#1b1b20' },
];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const playingCards = (ranks) =>
  SUITS.flatMap((s) =>
    ranks.map((r) => ({ corner: `${r}${s.sym}`, center: s.sym, color: s.color })),
  );

writeBox('cards52', {
  gamebox: 1,
  name: '52-card deck',
  blurb: 'Poker, hearts, rummy… a shuffled standard deck.',
  version: '1.0.0',
  layout: [
    {
      type: 'cardset',
      at: [560, 240],
      spec: { name: 'Deck', facePolicy: 'down', shuffle: true, cards: playingCards(RANKS) },
    },
  ],
  macros: [
    {
      id: 'deal5',
      label: 'Deal 5 to hands',
      steps: [{ op: 'deal', from: 'Deck', to: 'hands', n: 5 }],
    },
    {
      id: 'reset',
      label: 'Gather & shuffle',
      steps: [
        { op: 'gather', from: 'hands', to: 'Deck' },
        { op: 'gather', from: 'play', to: 'Deck' },
        { op: 'gather', from: 'table', to: 'Deck' },
        { op: 'shuffle', from: 'Deck' },
      ],
    },
  ],
});

// ---- Euchre: 24-card deck (9–A) + score counters ---------------------------
writeBox('euchre', {
  gamebox: 1,
  name: 'Euchre',
  blurb: '24-card deck (9–A), deal 5, trump lives in the players’ heads.',
  version: '1.0.0',
  layout: [
    {
      type: 'cardset',
      at: [560, 240],
      spec: {
        name: 'Deck',
        facePolicy: 'down',
        shuffle: true,
        cards: playingCards(['9', '10', 'J', 'Q', 'K', 'A']),
      },
    },
    { type: 'counter', at: [340, 240], label: 'Us' },
    { type: 'counter', at: [340, 330], label: 'Them' },
    {
      type: 'note',
      at: [340, 420],
      text: 'Deal 5 each (macro), turn up the top card for trump talk. First team to 10.',
    },
  ],
  macros: [
    {
      id: 'deal5',
      label: 'Deal 5 to hands',
      steps: [{ op: 'deal', from: 'Deck', to: 'hands', n: 5 }],
    },
    {
      id: 'reset',
      label: 'Gather & shuffle',
      steps: [
        { op: 'gather', from: 'hands', to: 'Deck' },
        { op: 'gather', from: 'play', to: 'Deck' },
        { op: 'gather', from: 'table', to: 'Deck' },
        { op: 'shuffle', from: 'Deck' },
      ],
    },
  ],
  reference: [
    {
      title: 'Quick rules',
      md: 'Deal 5 each. Turn up the top card; bidding names trump. Jack of trump (right bower) is high, other jack of same color (left bower) second. Take 3+ tricks to score 1; all 5 = 2; euchred = 2 for defenders. First to 10.',
    },
  ],
});

// ---- index of built-ins (the lobby fetches this) ---------------------------
writeFileSync(
  join(root, 'index.json'),
  JSON.stringify({ gameboxes: ['cards52', 'euchre'] }, null, 2) + '\n',
);
console.log('wrote index.json');
