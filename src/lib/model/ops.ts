// Op builders: each computes the concrete mutations for a physical action
// (shuffle, draw, deal, move…). The acting peer resolves all randomness and
// choice locally and broadcasts only the resulting mutations, applied
// atomically everywhere (SPEC §5).
//
// The universal primitive is moveToMat: everything that changes what
// contains an item goes through it, so entry rules (faceDefault, snapping)
// apply in exactly one place.

import type {
  CardEntity,
  DiceEntity,
  Entity,
  MatEntity,
  Pos,
  TokenEntity,
  Version,
} from './types';
import type { Mutation, TableState } from './reducers';
import { getMat, matItems } from './mats';
import { newId } from './types';
import { randInt, shuffled } from './rng';

export interface OpCtx {
  state: TableState;
  /** bump and return the local Lamport version */
  next(): Version;
  /** deep-copy an entity out of (possibly reactive) state before editing */
  clone<T extends Entity>(e: T): T;
}

function put(ctx: OpCtx, e: Entity): Mutation {
  e.version = ctx.next();
  return { t: 'put', entity: e };
}

/** Remove an item id from whatever mat order-list mentions it. */
function pluckFromMat(ctx: OpCtx, item: Entity): Mutation[] {
  const holder = getMat(ctx.state, item.parent);
  if (!holder) return [];
  if (!holder.state.order.includes(item.id)) return [];
  const m = ctx.clone(holder);
  m.state.order = m.state.order.filter((id) => id !== item.id);
  return [put(ctx, m)];
}

/** Half-extent of an item, for centering it on a slot. Bar tokens (roads)
 *  render 0.3× as tall as they are wide, so their vertical half differs. */
export function halfSize(item?: Entity): { hw: number; hh: number } {
  if (!item) return { hw: 0, hh: 0 };
  if (item.kind === 'card') return { hw: item.config.w / 2, hh: item.config.h / 2 };
  if (item.kind === 'token') {
    const hw = item.config.size / 2;
    return { hw, hh: item.config.shape === 'bar' ? Math.round(item.config.size * 0.3) / 2 : hw };
  }
  return { hw: 0, hh: 0 };
}

/** Snap a mat-relative (top-left) position per the mat's placement policy.
 *  Slot mats center the item on the nearest slot whose `accepts` matches the
 *  item's tags (slots without `accepts` take anything) and apply slot rot. */
export function snapPos(mat: MatEntity, pos: Pos, item?: Entity): Pos {
  const p = mat.config.placement;
  if (p.type === 'grid' && p.grid) {
    const g = p.grid.size;
    if (p.grid.hex) {
      // staggered hex-center lattice: rows every 0.866·g, odd rows offset g/2
      const dy = Math.round(g * 0.866);
      const row = Math.round(pos.y / dy);
      const xoff = row % 2 ? g / 2 : 0;
      return { ...pos, x: Math.round((pos.x - xoff) / g) * g + xoff, y: row * dy };
    }
    return { ...pos, x: Math.round(pos.x / g) * g, y: Math.round(pos.y / g) * g };
  }
  if (p.type === 'slots' && p.slots?.length) {
    const tags = item?.kind === 'token' ? (item.config.tags ?? []) : item ? [item.kind] : [];
    const eligible = p.slots.filter(
      (s) => !s.accepts?.length || s.accepts.some((a) => tags.includes(a)),
    );
    if (eligible.length === 0) return pos;
    const { hw, hh } = halfSize(item);
    const cx = pos.x + hw;
    const cy = pos.y + hh;
    let best = eligible[0];
    let bd = Infinity;
    for (const s of eligible) {
      const d = (s.x - cx) ** 2 + (s.y - cy) ** 2;
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return { ...pos, x: best.x - hw, y: best.y - hh, rot: best.rot ?? 0 };
  }
  return pos;
}

export interface MoveOpts {
  /** mat-relative position (free/grid/slots mats) */
  pos?: Pos;
  /** order insertion for stack/fan mats */
  where?: 'top' | 'bottom' | 'shuffle';
  /** override the mat's faceDefault for this move (e.g. shift-drop) */
  face?: 'up' | 'down' | 'keep';
  /** false skips grid/slot snapping (⌥-drag bypass, v4 §3) */
  snap?: boolean;
}

const clonePrefix = (e: Entity) => (e.kind === 'token' ? 'tok' : e.kind);

/** THE move: item into a mat. Applies the entry face rule only when the
 *  parent actually changes (moving within a mat never re-flips, SPEC §10).
 *  Infinite supplies (v4 §6): pulling OUT of one clones the item; putting
 *  INTO one destroys it. */
export function moveToMat(ctx: OpCtx, item: Entity, mat: MatEntity, opts: MoveOpts = {}): Mutation[] {
  const entering = item.parent !== mat.id;
  // the bank absorbs returns
  if (entering && mat.config.supply === 'infinite') {
    return [...pluckFromMat(ctx, item), { t: 'del', id: item.id, version: ctx.next() }];
  }
  const src = getMat(ctx.state, item.parent);
  const fromSupply = entering && src?.config.supply === 'infinite';
  const muts = entering && !fromSupply ? pluckFromMat(ctx, item) : [];

  const it = ctx.clone(item);
  if (fromSupply) it.id = newId(clonePrefix(item)); // the original stays in the supply

  const m = ctx.clone(mat);
  const rest = m.state.order.filter((id) => id !== it.id);
  const where = opts.where ?? (m.config.placement.type === 'fan' ? 'bottom' : 'top');
  m.state.order =
    where === 'top'
      ? [it.id, ...rest]
      : where === 'bottom'
        ? [...rest, it.id]
        : shuffled([it.id, ...rest]);

  it.parent = mat.id;
  if (opts.pos) it.pos = opts.snap === false ? opts.pos : snapPos(m, opts.pos, it);
  if (it.kind === 'card' && entering) {
    const face = opts.face ?? m.config.faceDefault;
    if (face !== 'keep') it.state.faceUp = face === 'up';
  }
  return [...muts, put(ctx, m), put(ctx, it)];
}

/** Move an item to the root table (or out of any mat) at a table position.
 *  Out of an infinite supply, the item is a fresh clone (v4 §6). */
export function moveToTable(ctx: OpCtx, item: Entity, pos: Pos, faceUp?: boolean): Mutation[] {
  const src = getMat(ctx.state, item.parent);
  const fromSupply = src?.config.supply === 'infinite';
  const muts = fromSupply ? [] : pluckFromMat(ctx, item);
  const it = ctx.clone(item);
  if (fromSupply) it.id = newId(clonePrefix(item));
  it.parent = null;
  it.pos = pos;
  if (it.kind === 'card' && faceUp !== undefined) it.state.faceUp = faceUp;
  return [...muts, put(ctx, it)];
}

/** Move an item already in `mat` to a new index in its order (tray reorder).
 *  Index is in matItems order (0 = top of a stack, leftmost of a fan). */
export function reorderInMat(ctx: OpCtx, mat: MatEntity, item: Entity, index: number): Mutation[] {
  const ids = matItems(ctx.state, mat)
    .map((e) => e.id)
    .filter((id) => id !== item.id);
  ids.splice(Math.max(0, Math.min(index, ids.length)), 0, item.id);
  const m = ctx.clone(mat);
  m.state.order = ids;
  return [put(ctx, m)];
}

export function shuffleMat(ctx: OpCtx, mat: MatEntity): Mutation[] {
  const m = ctx.clone(mat);
  m.state.order = shuffled(matItems(ctx.state, mat).map((e) => e.id));
  return [put(ctx, m)];
}

/** Move the top n items of `from` into `to` (draw). Drawing from an
 *  infinite supply mints clones (cycling through its items). */
export function drawTo(ctx: OpCtx, from: MatEntity, to: MatEntity, n = 1): Mutation[] {
  if (from.config.supply === 'infinite') {
    const pool = matItems(ctx.state, from);
    if (pool.length === 0) return [];
    const t = ctx.clone(to);
    const muts: Mutation[] = [];
    const minted: string[] = [];
    for (let i = 0; i < n; i++) {
      const it = ctx.clone(pool[i % pool.length]);
      it.id = newId(clonePrefix(it));
      it.parent = to.id;
      if (it.kind === 'card' && t.config.faceDefault !== 'keep')
        it.state.faceUp = t.config.faceDefault === 'up';
      minted.push(it.id);
      muts.push(put(ctx, it));
    }
    t.state.order =
      t.config.placement.type === 'fan'
        ? [...t.state.order, ...minted]
        : [...minted.reverse(), ...t.state.order];
    return [put(ctx, t), ...muts];
  }
  const items = matItems(ctx.state, from).slice(0, n);
  if (items.length === 0) return [];
  const f = ctx.clone(from);
  const t = ctx.clone(to);
  const taken = new Set(items.map((e) => e.id));
  f.state.order = f.state.order.filter((id) => !taken.has(id));
  const rest = t.state.order.filter((id) => !taken.has(id));
  t.state.order =
    t.config.placement.type === 'fan'
      ? [...rest, ...items.map((e) => e.id)]
      : [...items.map((e) => e.id).reverse(), ...rest];
  const muts = [put(ctx, f), put(ctx, t)];
  for (const item of items) {
    const it = ctx.clone(item);
    it.parent = to.id;
    if (it.kind === 'card' && t.config.faceDefault !== 'keep')
      it.state.faceUp = t.config.faceDefault === 'up';
    muts.push(put(ctx, it));
  }
  return muts;
}

/** Deal n cards to each mat, round-robin from the top, like a real deal. */
export function deal(ctx: OpCtx, from: MatEntity, hands: MatEntity[], n: number): Mutation[] {
  if (hands.length === 0) return [];
  const available = matItems(ctx.state, from);
  const f = ctx.clone(from);
  const hs = hands.map((h) => ctx.clone(h));
  const cardMuts: Mutation[] = [];
  let i = 0;
  for (let round = 0; round < n; round++) {
    for (const h of hs) {
      const item = available[i++];
      if (!item) break;
      h.state.order = [...h.state.order.filter((id) => id !== item.id), item.id];
      const it = ctx.clone(item);
      it.parent = h.id;
      if (it.kind === 'card' && h.config.faceDefault !== 'keep')
        it.state.faceUp = h.config.faceDefault === 'up';
      cardMuts.push(put(ctx, it));
    }
  }
  const dealt = new Set(available.slice(0, i).map((e) => e.id));
  f.state.order = f.state.order.filter((id) => !dealt.has(id));
  return [put(ctx, f), ...hs.map((h) => put(ctx, h)), ...cardMuts];
}

/** Pull the top item of a stack onto the table at pos. */
export function drawToTable(ctx: OpCtx, from: MatEntity, pos: Pos, faceUp: boolean): Mutation[] {
  const item = matItems(ctx.state, from)[0];
  if (!item) return [];
  return moveToTable(ctx, item, pos, item.kind === 'card' ? faceUp : undefined);
}

export function flipCard(ctx: OpCtx, card: CardEntity): Mutation[] {
  const c = ctx.clone(card);
  c.state.faceUp = !c.state.faceUp;
  return [put(ctx, c)];
}

/** Flip the mat's top card in place. */
export function flipTop(ctx: OpCtx, mat: MatEntity): Mutation[] {
  const item = matItems(ctx.state, mat)[0];
  if (!item || item.kind !== 'card') return [];
  return flipCard(ctx, item);
}

/** Gather every loose card on the table back into a mat (face per entry rule). */
export function gatherTableCards(ctx: OpCtx, mat: MatEntity): Mutation[] {
  const loose = Object.values(ctx.state.entities).filter(
    (e): e is CardEntity => e.kind === 'card' && e.parent === null,
  );
  if (loose.length === 0) return [];
  const m = ctx.clone(mat);
  m.state.order = [...loose.map((c) => c.id), ...matItems(ctx.state, mat).map((e) => e.id)];
  const muts: Mutation[] = [];
  for (const card of loose) {
    const c = ctx.clone(card);
    c.parent = mat.id;
    if (m.config.faceDefault !== 'keep') c.state.faceUp = m.config.faceDefault === 'up';
    else c.state.faceUp = false;
    muts.push(put(ctx, c));
  }
  return [...muts, put(ctx, m)];
}

const itemTags = (e: Entity): string[] =>
  e.kind === 'token' ? (e.config.tags ?? []) : [e.kind];

/** Deal items from `from` onto the EMPTY matching slots of a board, in slot
 *  order (v4 §7) — "shuffle the tiles, lay out the island" as one op. A slot
 *  counts as occupied only by an item sharing a tag with the candidate, so
 *  chits still deal onto tiled cells. */
export function dealToSlots(ctx: OpCtx, from: MatEntity, board: MatEntity): Mutation[] {
  const slots = board.config.placement.slots ?? [];
  if (slots.length === 0) return [];
  const children = matItems(ctx.state, board);
  const pool = [...matItems(ctx.state, from)];
  const muts: Mutation[] = [];
  const taken: string[] = [];
  for (const slot of slots) {
    if (pool.length === 0) break;
    const idx = pool.findIndex((cand) => {
      const tags = itemTags(cand);
      if (slot.accepts?.length && !slot.accepts.some((a) => tags.includes(a))) return false;
      // occupied by a like item? (a tile blocks tiles, not chits)
      return !children.some((c) => {
        if (!itemTags(c).some((t) => tags.includes(t))) return false;
        const { hw, hh } = halfSize(c);
        return Math.abs(c.pos.x + hw - slot.x) < 2 && Math.abs(c.pos.y + hh - slot.y) < 2;
      });
    });
    if (idx === -1) continue;
    const [item] = pool.splice(idx, 1);
    const it = ctx.clone(item);
    const { hw, hh } = halfSize(it);
    it.parent = board.id;
    it.pos = { ...it.pos, x: slot.x - hw, y: slot.y - hh, rot: slot.rot ?? 0 };
    taken.push(it.id);
    muts.push(put(ctx, it));
  }
  if (taken.length === 0) return [];
  const f = ctx.clone(from);
  f.state.order = f.state.order.filter((id) => !taken.includes(id));
  const b = ctx.clone(board);
  b.state.order = [...taken, ...b.state.order.filter((id) => !taken.includes(id))];
  return [put(ctx, f), put(ctx, b), ...muts];
}

/** Move a batch of items (from anywhere) into a mat, top of the order,
 *  entry face rule applied ('keep' gathers face down). */
export function moveItemsInto(ctx: OpCtx, items: Entity[], target: MatEntity): Mutation[] {
  const moved = items.filter(
    (e) => e.kind !== 'mat' && e.id !== target.id && e.parent !== target.id,
  );
  if (moved.length === 0) return [];
  const bySrc = new Map<string, Set<string>>();
  for (const e of moved) {
    if (!e.parent) continue;
    if (!bySrc.has(e.parent)) bySrc.set(e.parent, new Set());
    bySrc.get(e.parent)!.add(e.id);
  }
  const muts: Mutation[] = [];
  for (const [srcId, ids] of bySrc) {
    const src = getMat(ctx.state, srcId);
    if (!src) continue;
    const m = ctx.clone(src);
    m.state.order = m.state.order.filter((id) => !ids.has(id));
    muts.push(put(ctx, m));
  }
  const movedIds = new Set(moved.map((e) => e.id));
  const t = ctx.clone(target);
  t.state.order = [...moved.map((e) => e.id), ...t.state.order.filter((id) => !movedIds.has(id))];
  muts.push(put(ctx, t));
  for (const e of moved) {
    const it = ctx.clone(e);
    it.parent = target.id;
    if (it.kind === 'card')
      it.state.faceUp =
        target.config.faceDefault === 'keep' ? false : target.config.faceDefault === 'up';
    muts.push(put(ctx, it));
  }
  return muts;
}

/** Roll a die: the actor resolves randomness locally (SPEC §5). One entity
 *  is one die (v4 §4); pre-v4 multi-value dice keep rolling all values. */
export function rollDice(ctx: OpCtx, dice: DiceEntity, rolledBy: string): Mutation[] {
  const d = ctx.clone(dice);
  const n = Math.max(1, d.state.values.length);
  d.state.values = Array.from({ length: n }, () => randInt(d.config.sides) + 1);
  d.state.rolledBy = rolledBy;
  d.state.rolledAt = Date.now();
  return [put(ctx, d)];
}

/** Merge a dragged stack into a matching one (same label/color/size). */
export function mergeTokens(ctx: OpCtx, src: TokenEntity, dst: TokenEntity): Mutation[] {
  const d = ctx.clone(dst);
  d.state.count = (d.state.count || 1) + (src.state.count || 1);
  return [{ t: 'del', id: src.id, version: ctx.next() }, put(ctx, d)];
}

export function tokensMatch(a: TokenEntity, b: TokenEntity): boolean {
  return (
    a.config.label === b.config.label &&
    a.config.color === b.config.color &&
    a.config.shape === b.config.shape &&
    a.config.size === b.config.size
  );
}

/** Take one piece off a stack and place it — on the table (mat = null) or
 *  into a mat (snapped, e.g. a road onto an edge slot). The reserve-stack
 *  gesture: finite supplies stay finite by construction. */
export function takeOneTo(
  ctx: OpCtx,
  src: TokenEntity,
  mat: MatEntity | null,
  pos: Pos,
): Mutation[] {
  const have = src.state.count || 1;
  const one = ctx.clone(src);
  one.id = newId('tok');
  one.state.count = 1;
  one.parent = mat ? mat.id : null;
  one.pos = mat ? snapPos(mat, pos, one) : pos;
  const muts: Mutation[] = [];
  if (have <= 1) {
    // taking the last piece: the stack is gone
    muts.push({ t: 'del', id: src.id, version: ctx.next() });
  } else {
    const rest = ctx.clone(src);
    rest.state.count = have - 1;
    muts.push(put(ctx, rest));
  }
  if (mat) {
    const m = ctx.clone(mat);
    m.state.order = [one.id, ...m.state.order];
    muts.push(put(ctx, m));
  }
  muts.push(put(ctx, one));
  return muts;
}

/** Move one piece from a stack onto a matching stack. */
export function transferToken(ctx: OpCtx, src: TokenEntity, dst: TokenEntity): Mutation[] {
  const have = src.state.count || 1;
  const d = ctx.clone(dst);
  d.state.count = (d.state.count || 1) + 1;
  if (have <= 1) return [{ t: 'del', id: src.id, version: ctx.next() }, put(ctx, d)];
  const s = ctx.clone(src);
  s.state.count = have - 1;
  return [put(ctx, s), put(ctx, d)];
}

/** Split n pieces off a stack into a new stack at pos. */
export function splitToken(ctx: OpCtx, src: TokenEntity, n: number, pos: Pos): Mutation[] {
  const have = src.state.count || 1;
  if (n <= 0 || n >= have) return [];
  const rest = ctx.clone(src);
  rest.state.count = have - n;
  const taken = ctx.clone(src);
  taken.id = newId('tok');
  taken.pos = pos;
  taken.state.count = n;
  return [put(ctx, rest), put(ctx, taken)];
}

/** Delete an entity; deleting a mat deletes everything inside, recursively. */
export function deleteEntity(ctx: OpCtx, e: Entity): Mutation[] {
  const muts: Mutation[] = [];
  if (e.kind === 'mat') {
    for (const item of matItems(ctx.state, e)) muts.push(...deleteEntity(ctx, item));
  }
  muts.push({ t: 'del', id: e.id, version: ctx.next() });
  return muts;
}
