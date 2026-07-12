// Built-in template: Settlers of Catan (base, beginner layout).
// Proves that boards are data (v4 §7): the island is a slots-mat DECLARED
// as a hexgrid slot graph (cells for tiles/chits/robber, vertices for
// buildings, edges for roads) and expanded by makeMat. Piece supplies are
// finite by construction; the "Random island" macro re-lays the board via
// shuffle + deal-to-slots. No rules are enforced: players roll, collect,
// build, and argue like at a real table (SPEC §1).

import type { MacroDef, Pos, TokenEntity, Version } from './types';
import type { Mutation } from './reducers';
import type { OpCtx } from './ops';
import { hexGeometry } from './boards';
import { makeMat, matPresets } from './mats';
import { newId } from './types';
import { buildCardSet } from './cardsets';

const S = 88; // hex tile size (width = height; clip-path corners at 25%/75%)

const TERRAIN = {
  forest: '#2e7a3c',
  pasture: '#82c24a',
  field: '#d9b032',
  hill: '#b4552e',
  mountain: '#8a8f98',
  desert: '#d8c48e',
} as const;
type Terrain = keyof typeof TERRAIN;

// rulebook beginner layout, rows left→right, top→bottom (null = no chit)
const LAYOUT: Array<Array<[Terrain, number | null]>> = [
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

function pieceStack(
  version: Version,
  parent: string,
  pos: Pos,
  cfg: Partial<TokenEntity['config']> & { color: string },
  count: number,
): TokenEntity {
  return {
    id: newId('tok'),
    kind: 'token',
    version,
    parent,
    pos,
    locked: false,
    config: { shape: 'square', label: '', size: 22, tags: [], ...cfg },
    state: { count },
  };
}

export function catanTable(ctx: OpCtx, origin: Pos): Mutation[] {
  const muts: Mutation[] = [];
  let z = origin.z;

  // ---- board: a DECLARED hexgrid slot graph, expanded by makeMat (v4 §7) ----
  const geo = hexGeometry(2, S);
  const W = geo.w;
  const H = geo.h;
  const board = makeMat(ctx.next(), { x: origin.x, y: origin.y, z: z++, rot: 0 }, {
    label: 'Island',
    placement: {
      type: 'slots',
      generate: {
        kind: 'hexgrid',
        radius: 2,
        size: S,
        classes: { cell: ['tile', 'chit', 'robber'], vertex: ['building'], edge: ['road'] },
      },
    },
    size: { w: Math.round(W), h: Math.round(H) },
    locked: true,
  });
  muts.push({ t: 'put', entity: board });

  // tiles + number chits (movable: "Random island" re-lays them) + robber
  const terrains = LAYOUT.flat();
  for (const [i, hx] of geo.hexes.entries()) {
    const [terrain, chitNo] = terrains[i];
    const tile: TokenEntity = {
      id: newId('tok'),
      kind: 'token',
      version: ctx.next(),
      parent: board.id,
      pos: { x: hx.cx - S / 2, y: hx.cy - S / 2, z: z++, rot: 0 },
      locked: false,
      config: { shape: 'hex', color: TERRAIN[terrain], label: '', size: S, tags: ['tile'] },
      state: { count: 1 },
    };
    muts.push({ t: 'put', entity: tile });
    if (chitNo !== null) {
      const chit: TokenEntity = {
        id: newId('tok'),
        kind: 'token',
        version: ctx.next(),
        parent: board.id,
        pos: { x: hx.cx - 13, y: hx.cy - 13, z: z + 500, rot: 0 },
        locked: false,
        config: { shape: 'disc', color: '#f0ece1', label: String(chitNo), size: 26, tags: ['chit'] },
        state: { count: 1 },
      };
      muts.push({ t: 'put', entity: chit });
    } else {
      const robber: TokenEntity = {
        id: newId('tok'),
        kind: 'token',
        version: ctx.next(),
        parent: board.id,
        pos: { x: hx.cx - 15, y: hx.cy - 15, z: z + 600, rot: 0 },
        locked: false,
        config: { shape: 'disc', color: '#33343b', label: '☠', size: 30, tags: ['robber'] },
        state: { count: 1 },
      };
      muts.push({ t: 'put', entity: robber });
    }
  }
  z += 700;

  // ---- per-color reserves: finite supplies as token stacks ----
  COLORS.forEach((c, i) => {
    const mat = makeMat(
      ctx.next(),
      { x: origin.x + i * 200, y: origin.y + H + 40, z: z++, rot: 0 },
      { ...matPresets.zone(`${c.name} pieces`), size: { w: 180, h: 100 } },
    );
    muts.push({ t: 'put', entity: mat });
    const pieces: Array<[Partial<TokenEntity['config']>, number, number, number]> = [
      [{ shape: 'square', size: 22, tags: ['building'], label: '' }, 5, 16, 40], // settlements
      [{ shape: 'square', size: 30, tags: ['building'], label: 'C' }, 4, 70, 36], // cities
      [{ shape: 'bar', size: 36, tags: ['road'], label: '' }, 15, 124, 45], // roads
    ];
    for (const [cfg, count, px, py] of pieces) {
      muts.push({
        t: 'put',
        entity: pieceStack(ctx.next(), mat.id, { x: px, y: py, z: 1, rot: 0 }, { ...cfg, color: c.color }, count),
      });
    }
  });

  // ---- resource + development stacks ----
  const RES: Array<[string, string]> = [
    ['Wood', '#2e7a3c'],
    ['Brick', '#b4552e'],
    ['Wool', '#82c24a'],
    ['Grain', '#d9b032'],
    ['Ore', '#8a8f98'],
  ];
  const bankY = origin.y + H + 180; // its own row, clear of the reserves
  RES.forEach(([name, color], i) => {
    muts.push(
      ...buildCardSet(
        ctx,
        {
          name,
          facePolicy: 'up',
          shuffle: false,
          cards: [{ title: name, body: '', sub: 'Resource', color, count: 19 }],
        },
        { x: origin.x + i * 110, y: bankY, z: z++, rot: 0 },
      ),
    );
  });
  muts.push(
    ...buildCardSet(
      ctx,
      {
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
      { x: origin.x + 5 * 110 + 30, y: bankY, z: z++, rot: 0 },
    ),
  );

  // ---- staging stacks for "Random island": gather → shuffle → deal-to-slots ----
  muts.push({
    t: 'put',
    entity: makeMat(ctx.next(), { x: origin.x + W + 40, y: origin.y + 40, z: z++, rot: 0 }, {
      label: 'Tiles',
      placement: { type: 'stack' },
    }),
  });
  muts.push({
    t: 'put',
    entity: makeMat(ctx.next(), { x: origin.x + W + 150, y: origin.y + 40, z: z++, rot: 0 }, {
      label: 'Chits',
      placement: { type: 'stack' },
    }),
  });

  // ---- dice (one entity per die, v4 §4), scoreboard, setup note ----
  for (const [i, v] of [3, 4].entries()) {
    muts.push({
      t: 'put',
      entity: {
        id: newId('dice'),
        kind: 'dice',
        version: ctx.next(),
        parent: null,
        pos: { x: origin.x + W + 40 + i * 46, y: origin.y - 60, z: z++, rot: 0 },
        locked: false,
        config: { sides: 6 },
        state: { values: [v], rolledBy: null, rolledAt: 0 },
      },
    });
  }
  muts.push({
    t: 'put',
    entity: {
      id: newId('scoreboard'),
      kind: 'scoreboard',
      version: ctx.next(),
      parent: null,
      pos: { x: origin.x - 210, y: origin.y, z: z++, rot: 0 },
      locked: false,
      config: { label: 'Victory points' },
      state: { values: {} },
    },
  });
  muts.push({
    t: 'put',
    entity: {
      id: newId('note'),
      kind: 'note',
      version: ctx.next(),
      parent: null,
      pos: { x: origin.x - 210, y: origin.y + 120, z: z++, rot: 0 },
      locked: false,
      config: { color: '#e7d980' },
      state: {
        text:
          'SETUP: claim a color mat; drag pieces off its stacks (one comes off at a time). Place 2 settlements + 2 roads each — they snap to corners and edges. "Random island" (top left) re-lays tiles and chits; swap the desert chit off by hand.\n\nTURN: roll (double-click dice), collect resources, trade, build. Robber moves on a 7. First to 10 VP wins.',
      },
    },
  });
  return muts;
}

/** Quick actions for the gamebox strip: re-lay the island from config —
 *  shuffle + deal-to-slots, no board code (v4 §7). */
export function catanMacros(): MacroDef[] {
  return [
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
  ];
}
