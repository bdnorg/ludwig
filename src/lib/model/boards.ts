// Slot-graph generators (v4 §7): boards are data. A slots-mat can declare
// `placement.generate` instead of hand-listing its graph; makeMat expands it
// into concrete SlotDefs at creation, so peers, saves, and ops only ever see
// the list. Hex tiles, chit tokens, and slot boards are general primitives.

import type { SlotDef, SlotGenerate } from './types';

export interface HexGeom {
  cx: number;
  cy: number;
}

/** Pointy-top hexes in a hexagonal ring layout (radius 2 = the 19-hex Catan
 *  island), plus the deduplicated vertex/edge graph. Sized so the board
 *  extent is roughly (2·radius+1)·size wide. */
export function hexGeometry(radius: number, size: number) {
  const S = size;
  const w = (2 * radius + 1) * S + 60;
  const h = 1.5 * radius * S + S + 40;
  const x0 = w / 2;
  const y0 = h / 2;
  const hexes: HexGeom[] = [];
  for (let r = -radius; r <= radius; r++) {
    const qMin = Math.max(-radius, -radius - r);
    const qMax = Math.min(radius, radius - r);
    for (let q = qMin; q <= qMax; q++) {
      hexes.push({ cx: x0 + S * (q + r / 2), cy: y0 + 0.75 * S * r });
    }
  }

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
  return { hexes, vertices: [...vertices.values()], edges: [...edges.values()], w, h };
}

/** Expand a SlotGenerate into concrete slots + a natural mat size. */
export function generateSlots(gen: SlotGenerate): { slots: SlotDef[]; w: number; h: number } {
  const classes = gen.classes ?? { cell: [] };
  const slots: SlotDef[] = [];
  if (gen.kind === 'hexgrid') {
    const geo = hexGeometry(gen.radius ?? 2, gen.size);
    if (classes.cell)
      geo.hexes.forEach((hx, i) =>
        slots.push({ id: `cell-${i}`, x: hx.cx, y: hx.cy, accepts: classes.cell }),
      );
    if (classes.vertex)
      geo.vertices.forEach((v, i) =>
        slots.push({ id: `v-${i}`, x: v.x, y: v.y, accepts: classes.vertex }),
      );
    if (classes.edge)
      geo.edges.forEach((e, i) =>
        slots.push({ id: `e-${i}`, x: e.x, y: e.y, rot: e.rot, accepts: classes.edge }),
      );
    return { slots, w: geo.w, h: geo.h };
  }
  // squaregrid: rows × cols cell centers
  const rows = gen.rows ?? 8;
  const cols = gen.cols ?? 8;
  const s = gen.size;
  const pad = 20;
  if (classes.cell)
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        slots.push({
          id: `cell-${r}-${c}`,
          x: pad + c * s + s / 2,
          y: pad + r * s + s / 2,
          accepts: classes.cell,
        });
  return { slots, w: cols * s + 2 * pad, h: rows * s + 2 * pad };
}
