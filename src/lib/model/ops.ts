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
import { getMat, makeMat, matItems } from './mats';
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

/** Implicit stacks (M17) exist only while they hold 2+ items: once removals
 *  leave 0 or 1, the survivor steps out to the stack's own spot and the mat
 *  vanishes — a lone chip is a chip again, not a pile of one. */
function dissolveImplicit(ctx: OpCtx, holder: MatEntity, removedIds: string[]): Mutation[] {
  if (!holder.config.implicit) return [];
  const rest = matItems(ctx.state, holder).filter((e) => !removedIds.includes(e.id));
  if (rest.length > 1) return [];
  const muts: Mutation[] = [];
  const last = rest[0];
  if (last) {
    const it = ctx.clone(last);
    it.parent = holder.parent;
    it.pos = { ...holder.pos, rot: it.pos.rot };
    muts.push(put(ctx, it));
    const gp = getMat(ctx.state, holder.parent);
    if (gp) {
      const g = ctx.clone(gp);
      g.state.order = [it.id, ...g.state.order.filter((id) => id !== it.id)];
      muts.push(put(ctx, g));
    }
  }
  muts.push({ t: 'del', id: holder.id, version: ctx.next() });
  return muts;
}

/** Remove an item id from whatever mat order-list mentions it. */
function pluckFromMat(ctx: OpCtx, item: Entity): Mutation[] {
  const holder = getMat(ctx.state, item.parent);
  if (!holder) return [];
  if (!holder.state.order.includes(item.id)) return [];
  const m = ctx.clone(holder);
  m.state.order = m.state.order.filter((id) => id !== item.id);
  return [put(ctx, m), ...dissolveImplicit(ctx, holder, [item.id])];
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
  const dissolve = dissolveImplicit(ctx, from, [...taken]);
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
  return [...muts, ...dissolve];
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
    muts.push(put(ctx, m), ...dissolveImplicit(ctx, src, [...ids]));
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

/** Build an implicit stack: `n` copies of a token piled at `pos` (a chip
 *  stack, a road reserve). n = 1 is just a token — no mat wrapper (M17). */
export function tokenPile(
  ctx: OpCtx,
  parent: string | null,
  pos: Pos,
  cfg: TokenEntity['config'],
  n: number,
): Mutation[] {
  const tok = (id: string, p: string | null, at: Pos): TokenEntity => ({
    id,
    kind: 'token',
    version: ctx.next(),
    parent: p,
    pos: at,
    locked: false,
    config: cfg,
    state: { count: 1 },
  });
  if (n <= 1) return [{ t: 'put', entity: tok(newId('tok'), parent, pos) }];
  const mat = makeMat(ctx.next(), pos, {
    label: '',
    implicit: true,
    placement: { type: 'stack' },
    faceDefault: 'keep',
    showSum: cfg.values ? 'value' : undefined,
  });
  mat.parent = parent;
  const muts: Mutation[] = [];
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = tok(newId('tok'), mat.id, { x: 0, y: 0, z: i, rot: 0 });
    ids.push(t.id);
    muts.push({ t: 'put', entity: t });
  }
  mat.state.order = ids;
  return [{ t: 'put', entity: mat }, ...muts];
}

/** Bullseye drop of one item onto another (M17): bundle both into a fresh
 *  implicit stack mat at the target's spot. ANY mix may share a stack —
 *  mixed colors, denominations, cards on chips. Faces are kept as they lie. */
export function stackOnto(ctx: OpCtx, item: Entity, target: Entity): Mutation[] {
  if (item.id === target.id || item.kind === 'mat' || target.kind === 'mat') return [];
  const muts: Mutation[] = [];
  const src = getMat(ctx.state, item.parent);
  const it = ctx.clone(item);
  if (src?.config.supply === 'infinite') it.id = newId(clonePrefix(item));
  else if (item.parent !== target.parent) muts.push(...pluckFromMat(ctx, item));
  const mat = makeMat(ctx.next(), { ...target.pos }, {
    label: '',
    implicit: true,
    placement: { type: 'stack' },
    faceDefault: 'keep',
    showSum: 'value',
  });
  mat.parent = target.parent;
  mat.state.order = [it.id, target.id];
  const holder = getMat(ctx.state, target.parent);
  if (holder) {
    const g = ctx.clone(holder);
    g.state.order = [mat.id, ...g.state.order.filter((id) => id !== target.id && id !== it.id)];
    muts.push(put(ctx, g));
  }
  const tgt = ctx.clone(target);
  tgt.parent = mat.id;
  tgt.pos = { x: 0, y: 0, z: 0, rot: tgt.pos.rot };
  it.parent = mat.id;
  it.pos = { x: 0, y: 0, z: 1, rot: it.pos.rot };
  return [...muts, put(ctx, mat), put(ctx, tgt), put(ctx, it)];
}

/** Split the top n items off a pile into a new implicit stack at pos
 *  (n = 1 just sets the lone item down). The source dissolves if it was
 *  implicit and drops below 2. */
export function splitPile(ctx: OpCtx, src: MatEntity, n: number, pos: Pos): Mutation[] {
  const items = matItems(ctx.state, src);
  const taken = items.slice(0, Math.max(0, Math.min(n, items.length)));
  if (taken.length === 0) return [];
  const ids = taken.map((i) => i.id);
  const s = ctx.clone(src);
  s.state.order = s.state.order.filter((id) => !ids.includes(id));
  const muts: Mutation[] = [put(ctx, s), ...dissolveImplicit(ctx, src, ids)];
  if (taken.length === 1) {
    const it = ctx.clone(taken[0]);
    it.parent = src.parent;
    it.pos = { ...pos, rot: it.pos.rot };
    return [...muts, put(ctx, it)];
  }
  const mat = makeMat(ctx.next(), pos, {
    label: '',
    implicit: true,
    placement: { type: 'stack' },
    faceDefault: 'keep',
    showSum: src.config.showSum,
  });
  mat.parent = src.parent;
  mat.state.order = ids;
  muts.push(put(ctx, mat));
  for (const [i, item] of taken.entries()) {
    const it = ctx.clone(item);
    it.parent = mat.id;
    it.pos = { x: 0, y: 0, z: taken.length - i, rot: it.pos.rot };
    muts.push(put(ctx, it));
  }
  return muts;
}

/** Bullseye drop of a whole stack onto another stack/fan: pour every item
 *  in on top. An implicit source vanishes; a real mat (deck) stays, empty.
 *  Pouring into an infinite supply destroys the items (v4 §6). */
export function mergeStacks(ctx: OpCtx, src: MatEntity, dst: MatEntity): Mutation[] {
  if (src.id === dst.id) return [];
  const items = matItems(ctx.state, src);
  if (items.length === 0) return [];
  const muts: Mutation[] = [];
  if (dst.config.supply === 'infinite') {
    for (const i of items) muts.push({ t: 'del', id: i.id, version: ctx.next() });
  } else {
    const ids = items.map((i) => i.id);
    const d = ctx.clone(dst);
    d.state.order = [...ids, ...d.state.order.filter((id) => !ids.includes(id))];
    muts.push(put(ctx, d));
    for (const i of items) {
      const it = ctx.clone(i);
      it.parent = dst.id;
      if (it.kind === 'card' && dst.config.faceDefault !== 'keep')
        it.state.faceUp = dst.config.faceDefault === 'up';
      muts.push(put(ctx, it));
    }
  }
  if (src.config.implicit) {
    muts.push({ t: 'del', id: src.id, version: ctx.next() });
  } else {
    const s = ctx.clone(src);
    s.state.order = [];
    muts.push(put(ctx, s));
  }
  return muts;
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
