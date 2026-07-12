// Built-in template: Settlers of Catan (base, beginner layout).
// Proves the slot-graph board: one slots-mat carries hex slots (tiles,
// robber), vertex slots (settlements/cities), and edge slots (roads, with
// rotation). Piece supplies are finite by construction — token stacks in
// per-color reserves hold exactly the box counts. No rules are enforced:
// players roll, collect, build, and argue like at a real table (SPEC §1).

import type { Pos, SlotDef, TokenEntity, Version } from './types';
import type { Mutation } from './reducers';
import type { OpCtx } from './ops';
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

interface HexGeom {
  cx: number;
  cy: number;
  terrain: Terrain;
  chit: number | null;
}

/** Hex centers + the deduplicated vertex/edge slot graph. */
export function boardGeometry(w: number, h: number) {
  const x0 = w / 2;
  const y0 = h / 2;
  const hexes: HexGeom[] = [];
  LAYOUT.forEach((row, ri) => {
    const r = ri - 2;
    row.forEach(([terrain, chit], ci) => {
      const q = Math.max(-2, -2 - r) + ci;
      hexes.push({
        cx: x0 + S * (q + r / 2),
        cy: y0 + 0.75 * S * r,
        terrain,
        chit,
      });
    });
  });

  const corners = (hx: HexGeom): Array<{ x: number; y: number }> => [
    { x: hx.cx, y: hx.cy - S / 2 },
    { x: hx.cx + S / 2, y: hx.cy - S / 4 },
    { x: hx.cx + S / 2, y: hx.cy + S / 4 },
    { x: hx.cx, y: hx.cy + S / 2 },
    { x: hx.cx - S / 2, y: hx.cy + S / 4 },
    { x: hx.cx - S / 2, y: hx.cy - S / 4 },
  ];

  const key = (x: number, y: number) => `${Math.round(x)}:${Math.round(y)}`;
  const vertices = new Map<string, { x: number; y: number }>();
  const edges = new Map<string, { x: number; y: number; rot: number }>();
  for (const hx of hexes) {
    const cs = corners(hx);
    cs.forEach((c, i) => {
      vertices.set(key(c.x, c.y), c);
      const n = cs[(i + 1) % 6];
      const mx = (c.x + n.x) / 2;
      const my = (c.y + n.y) / 2;
      const rot = Math.round((Math.atan2(n.y - c.y, n.x - c.x) * 180) / Math.PI);
      edges.set(key(mx, my), { x: mx, y: my, rot: ((rot % 180) + 180) % 180 });
    });
  }
  return { hexes, vertices: [...vertices.values()], edges: [...edges.values()] };
}

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

  // ---- board: one slots-mat with hex/vertex/edge slot classes ----
  const W = 5 * S + 60;
  const H = 4 * S + 40;
  const geo = boardGeometry(W, H);
  const slots: SlotDef[] = [
    ...geo.hexes.map((hx, i) => ({ id: `hex-${i}`, x: hx.cx, y: hx.cy, accepts: ['tile', 'chit'] })),
    ...geo.vertices.map((v, i) => ({ id: `v-${i}`, x: v.x, y: v.y, accepts: ['building'] })),
    ...geo.edges.map((e, i) => ({ id: `e-${i}`, x: e.x, y: e.y, rot: e.rot, accepts: ['road'] })),
  ];
  const board = makeMat(ctx.next(), { x: origin.x, y: origin.y, z: z++, rot: 0 }, {
    label: 'Island',
    placement: { type: 'slots', slots },
    size: { w: W, h: H },
    locked: true,
  });
  muts.push({ t: 'put', entity: board });

  // tiles + number chits (locked scenery) and the robber (mobile)
  for (const hx of geo.hexes) {
    const tile: TokenEntity = {
      id: newId('tok'),
      kind: 'token',
      version: ctx.next(),
      parent: board.id,
      pos: { x: hx.cx - S / 2, y: hx.cy - S / 2, z: z++, rot: 0 },
      locked: true,
      config: { shape: 'hex', color: TERRAIN[hx.terrain], label: '', size: S, tags: ['tile'] },
      state: { count: 1 },
    };
    muts.push({ t: 'put', entity: tile });
    if (hx.chit !== null) {
      const chit: TokenEntity = {
        id: newId('tok'),
        kind: 'token',
        version: ctx.next(),
        parent: board.id,
        pos: { x: hx.cx - 13, y: hx.cy - 13, z: z + 500, rot: 0 },
        locked: true,
        config: { shape: 'disc', color: '#f0ece1', label: String(hx.chit), size: 26, tags: ['chit'] },
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
        config: { shape: 'disc', color: '#33343b', label: '☠', size: 30, tags: ['chit'] },
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

  // ---- dice, scoreboard, setup note ----
  muts.push({
    t: 'put',
    entity: {
      id: newId('dice'),
      kind: 'dice',
      version: ctx.next(),
      parent: null,
      pos: { x: origin.x + W + 50, y: origin.y - 60, z: z++, rot: 0 },
      locked: false,
      config: { sides: 6, count: 2 },
      state: { values: [3, 4], rolledBy: null, rolledAt: 0 },
    },
  });
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
          'SETUP: claim a color mat; drag pieces off its stacks (one comes off at a time). Place 2 settlements + 2 roads each — they snap to corners and edges.\n\nTURN: roll (double-click dice), collect resources, trade, build. Robber moves on a 7. First to 10 VP wins.',
      },
    },
  });
  return muts;
}
