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

// ---- Dominion: base set, "First Game" kingdom (mirror of dominion.ts) -----
const D_ACTION = '#4a4f58';
const D_TREASURE = '#a5741a';
const D_VICTORY = '#2e7d46';
const D_CURSE = '#7d3fa0';
const CARD_W = 72;
const CARD_H = 100;

const dMoney = (name, worth, cost, count) => ({
  title: name, body: worth, sub: `$${cost} · Treasure`, color: D_TREASURE, count,
});
const dVp = (name, points, cost, count, color = D_VICTORY) => ({
  title: name, body: points, sub: `$${cost} · Victory`, color, count,
});
const dAction = (name, body, cost, type = 'Action') => ({
  title: name, body, sub: `$${cost} · ${type}`, color: D_ACTION, count: 10,
});

const KINGDOM = [
  dAction('Cellar', '+1 Action\nDiscard any number of cards, then draw that many.', 2),
  dAction('Moat', '+2 Cards\nWhen another player plays an Attack, you may reveal this to be unaffected.', 2, 'Action–Reaction'),
  dAction('Merchant', '+1 Card, +1 Action\nThe first time you play a Silver this turn, +$1.', 3),
  dAction('Village', '+1 Card, +2 Actions', 3),
  dAction('Workshop', 'Gain a card costing up to $4.', 3),
  dAction('Militia', '+$2\nEach other player discards down to 3 cards in hand.', 4, 'Action–Attack'),
  dAction('Remodel', 'Trash a card from your hand. Gain a card costing up to $2 more than it.', 4),
  dAction('Smithy', '+3 Cards', 4),
  dAction('Market', '+1 Card, +1 Action, +1 Buy, +$1', 5),
  dAction('Mine', 'Trash a Treasure from your hand. Gain a Treasure to your hand costing up to $3 more than it.', 5),
];

const D_GAP_X = CARD_W + 28;
const D_GAP_Y = CARD_H + 34;
const round2 = (n) => Math.round(n * 100) / 100;
const dAt = (col, row) => [round2(col * D_GAP_X), round2(row * D_GAP_Y)];
const dPile = (spec, at, count) => ({
  type: 'cardset',
  at,
  spec: { name: spec.title, facePolicy: 'up', shuffle: false, cards: [{ ...spec, count: count ?? spec.count ?? 1 }] },
});

const dominionLayout = [
  // treasure & victory columns (starters come out of copper/estate, 4 players)
  dPile(dMoney('Copper', '$1', 0, 1), dAt(0, 0), 60 - 28),
  dPile(dMoney('Silver', '$2', 3, 1), dAt(0, 1), 40),
  dPile(dMoney('Gold', '$3', 6, 1), dAt(0, 2), 30),
  dPile(dVp('Estate', '1 VP', 2, 1), dAt(1, 0), 12),
  dPile(dVp('Duchy', '3 VP', 5, 1), dAt(1, 1), 12),
  dPile(dVp('Province', '6 VP', 8, 1), dAt(1, 2), 12),
  dPile(dVp('Curse', '−1 VP', 0, 1, D_CURSE), dAt(2, 2), 30),
  // kingdom: two rows of five, cheap to expensive
  ...KINGDOM.map((spec, i) => dPile(spec, dAt(3 + (i % 5), Math.floor(i / 5)), 10)),
  // starter decks: 7 Copper + 3 Estate each, shuffled face down
  ...[0, 1, 2, 3].map((p) => ({
    type: 'cardset',
    at: dAt(p * 1.6 + 1, 4.3), // below the play-area zone
    spec: {
      name: `Starter deck ${p + 1}`,
      facePolicy: 'down',
      cards: [dMoney('Copper', '$1', 0, 7), dVp('Estate', '1 VP', 2, 3)],
    },
  })),
  // trash pile (empty face-up mat) and setup note
  {
    type: 'mat',
    at: dAt(2, 0),
    opts: { label: 'Trash', placement: { type: 'stack' }, faceDefault: 'up', visibility: { faces: 'public' } },
  },
  {
    type: 'mat',
    at: dAt(3, 2.9),
    opts: {
      label: 'Play area',
      placement: { type: 'grid', grid: { size: 40 } },
      faceDefault: 'keep',
      size: { w: D_GAP_X * 5 - 28, h: CARD_H + 60 },
      groups: ['play'],
    },
  },
  {
    type: 'note',
    at: dAt(8.2, 0),
    text:
      'SETUP: each player takes a starter deck (7 Copper, 3 Estate), shuffles (right-click), and draws 5 to hand (double-click ×5).\n\nBuy: drag a card off a supply pile to your discard. Game ends when Provinces (or any 3 piles) run out.',
  },
];

writeBox('dominion', {
  gamebox: 1,
  name: 'Dominion (base, first game)',
  blurb: 'Full supply, kingdom, and starter decks.',
  version: '1.0.0',
  layout: dominionLayout,
});

// ---- Catan: Settlers of Catan (beginner board, mirror of catan.ts) --------
const C_S = 88; // hex tile size

const TERRAIN = {
  forest: '#2e7a3c',
  pasture: '#82c24a',
  field: '#d9b032',
  hill: '#b4552e',
  mountain: '#8a8f98',
  desert: '#d8c48e',
};

// rulebook beginner layout, rows left→right, top→bottom (null = no chit)
const C_LAYOUT = [
  [['mountain', 10], ['pasture', 2], ['forest', 9]],
  [['field', 12], ['hill', 6], ['pasture', 4], ['hill', 10]],
  [['field', 9], ['forest', 11], ['desert', null], ['forest', 3], ['mountain', 8]],
  [['forest', 8], ['mountain', 3], ['field', 4], ['pasture', 5]],
  [['hill', 5], ['field', 6], ['pasture', 11]],
];

const COLORS = [
  { name: 'Red', color: '#c0392b' },
  { name: 'Blue', color: '#2e6da4' },
  { name: 'White', color: '#e8e6e0' },
  { name: 'Orange', color: '#d9822b' },
];

const RES = [
  ['Wood', '#2e7a3c'],
  ['Brick', '#b4552e'],
  ['Wool', '#82c24a'],
  ['Grain', '#d9b032'],
  ['Ore', '#8a8f98'],
];

// duplicate of hexGeometry() (src/lib/model/boards.ts) — node-side generator
// only; the manifest keeps plain coordinates for tile/chit/robber tokens
// (the Island mat's own slot graph is generated at load time via
// placement.generate, see below). AGENTS.md M18 design call.
function hexGeometry(radius, size) {
  const S = size;
  const w = (2 * radius + 1) * S + 60;
  const h = 1.5 * radius * S + S + 40;
  const x0 = w / 2;
  const y0 = h / 2;
  const hexes = [];
  for (let r = -radius; r <= radius; r++) {
    const qMin = Math.max(-radius, -radius - r);
    const qMax = Math.min(radius, radius - r);
    for (let q = qMin; q <= qMax; q++) {
      hexes.push({ cx: x0 + S * (q + r / 2), cy: y0 + 0.75 * S * r });
    }
  }
  return { hexes, w, h };
}

const cGeo = hexGeometry(2, C_S);
const cW = cGeo.w;
const cH = cGeo.h;
const cTerrains = C_LAYOUT.flat();

const catanLayout = [
  {
    type: 'mat',
    at: [0, 0],
    opts: {
      label: 'Island',
      placement: {
        type: 'slots',
        generate: {
          kind: 'hexgrid',
          radius: 2,
          size: C_S,
          classes: { cell: ['tile', 'chit', 'robber'], vertex: ['building'], edge: ['road'] },
        },
      },
      size: { w: Math.round(cW), h: Math.round(cH) },
      locked: true,
    },
  },
  // tiles first, then chits + robber (both above every tile — mirrors the
  // z+500/z+600 offsets in catan.ts via insertion order)
  ...cGeo.hexes.map((hx, i) => {
    const [terrain] = cTerrains[i];
    return {
      type: 'token',
      at: [hx.cx - C_S / 2, hx.cy - C_S / 2],
      in: 'Island',
      config: { shape: 'hex', color: TERRAIN[terrain], label: '', size: C_S, tags: ['tile'] },
    };
  }),
  ...cGeo.hexes.flatMap((hx, i) => {
    const [, chitNo] = cTerrains[i];
    if (chitNo !== null) {
      return [{
        type: 'token',
        at: [hx.cx - 13, hx.cy - 13],
        in: 'Island',
        config: { shape: 'disc', color: '#f0ece1', label: String(chitNo), size: 26, tags: ['chit'] },
      }];
    }
    return [{
      type: 'token',
      at: [hx.cx - 15, hx.cy - 15],
      in: 'Island',
      config: { shape: 'disc', color: '#33343b', label: '☠', size: 30, tags: ['robber'] },
    }];
  }),
  // per-color reserves: finite supplies as token piles
  ...COLORS.flatMap((c, i) => [
    {
      type: 'mat',
      at: [i * 200, cH + 40],
      opts: {
        label: `${c.name} pieces`,
        placement: { type: 'grid', grid: { size: 40 } },
        faceDefault: 'keep',
        size: { w: 180, h: 100 },
      },
    },
    {
      type: 'pile',
      at: [16, 40],
      in: `${c.name} pieces`,
      token: { shape: 'square', color: c.color, label: '', size: 22, tags: ['building'] },
      count: 5,
    },
    {
      type: 'pile',
      at: [70, 36],
      in: `${c.name} pieces`,
      token: { shape: 'square', color: c.color, label: 'C', size: 30, tags: ['building'] },
      count: 4,
    },
    {
      type: 'pile',
      at: [124, 45],
      in: `${c.name} pieces`,
      token: { shape: 'bar', color: c.color, label: '', size: 36, tags: ['road'] },
      count: 15,
    },
  ]),
  // resource + development stacks
  ...RES.map(([name, color], i) => ({
    type: 'cardset',
    at: [i * 110, cH + 180],
    spec: {
      name,
      facePolicy: 'up',
      shuffle: false,
      cards: [{ title: name, body: '', sub: 'Resource', color, count: 19 }],
    },
  })),
  {
    type: 'cardset',
    at: [5 * 110 + 30, cH + 180],
    spec: {
      name: 'Development',
      facePolicy: 'down',
      cards: [
        { title: 'Knight', body: 'Move the robber. Steal 1 card from a player next to it.', sub: 'Development', count: 14 },
        { title: 'Victory Point', body: 'Worth 1 VP. Keep hidden until the game ends.', sub: 'Development', count: 5 },
        { title: 'Road Building', body: 'Place 2 free roads.', sub: 'Development', count: 2 },
        { title: 'Year of Plenty', body: 'Take any 2 resources from the bank.', sub: 'Development', count: 2 },
        { title: 'Monopoly', body: 'Name a resource. All players give you theirs.', sub: 'Development', count: 2 },
      ],
    },
  },
  // staging stacks for "Random island": gather → shuffle → deal-to-slots
  { type: 'mat', at: [cW + 40, 40], opts: { label: 'Tiles', placement: { type: 'stack' } } },
  { type: 'mat', at: [cW + 150, 40], opts: { label: 'Chits', placement: { type: 'stack' } } },
  // dice (one entity per die), scoreboard, setup note
  { type: 'dice', at: [cW + 40, -60], value: 3 },
  { type: 'dice', at: [cW + 40 + 46, -60], value: 4 },
  { type: 'scoreboard', at: [-210, 0], label: 'Victory points' },
  {
    type: 'note',
    at: [-210, 120],
    text:
      'SETUP: claim a color mat; drag pieces off its stacks (one comes off at a time). Place 2 settlements + 2 roads each — they snap to corners and edges. "Random island" (top left) re-lays tiles and chits; swap the desert chit off by hand.\n\nTURN: roll (double-click dice), collect resources, trade, build. Robber moves on a 7. First to 10 VP wins.',
  },
];

writeBox('catan', {
  gamebox: 1,
  name: 'Settlers of Catan (beginner board)',
  blurb: 'Snap-slot island, finite pieces, resources.',
  version: '1.0.0',
  layout: catanLayout,
  macros: [
    {
      id: 'random-island',
      label: 'Random island',
      steps: [
        { op: 'move', from: 'Island', to: 'Chits', where: { tag: 'chit' } },
        { op: 'move', from: 'Island', to: 'Tiles', where: { tag: 'tile' } },
        { op: 'shuffle', from: 'Tiles' },
        { op: 'deal-to-slots', from: 'Tiles', to: 'Island' },
        { op: 'shuffle', from: 'Chits' },
        { op: 'deal-to-slots', from: 'Chits', to: 'Island' },
      ],
    },
  ],
});

// ---- index of built-ins (the lobby fetches this) ---------------------------
writeFileSync(
  join(root, 'index.json'),
  JSON.stringify({ gameboxes: ['cards52', 'euchre', 'dominion', 'catan'] }, null, 2) + '\n',
);
console.log('wrote index.json');
