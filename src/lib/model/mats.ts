// Mat helpers: membership, ordering, visibility derivation, and factories.
//
// Two sources of truth exist by design: item.parent is the membership
// authority (per-entity LWW converges it), mat.state.order is the order
// authority. Concurrent edits can leave the order list mentioning an item
// that has since moved, or missing one that points at it — these helpers
// reconcile, so every reader self-heals.

import type {
  CardEntity,
  Entity,
  MatEntity,
  MatPrivacy,
  MatVisibility,
  Pos,
  Version,
  VisibilityRule,
} from './types';
import { newId } from './types';
import type { TableState } from './reducers';

/** Items actually in `mat`, in order-list order; strays appended (stable). */
export function matItems(s: TableState, mat: MatEntity): Entity[] {
  const inIt = (id: string): Entity | null => {
    const e = s.entities[id];
    return e && e.parent === mat.id ? e : null;
  };
  const seen = new Set<string>();
  const out: Entity[] = [];
  for (const id of mat.state.order) {
    const e = inIt(id);
    if (e && !seen.has(id)) {
      out.push(e);
      seen.add(id);
    }
  }
  for (const e of Object.values(s.entities)) {
    if (e.parent === mat.id && !seen.has(e.id)) out.push(e);
  }
  return out;
}

export function matCards(s: TableState, mat: MatEntity): CardEntity[] {
  return matItems(s, mat).filter((e): e is CardEntity => e.kind === 'card');
}

export function topItem(s: TableState, mat: MatEntity): Entity | undefined {
  return matItems(s, mat)[0];
}

export function getMat(s: TableState, id: string | null | undefined): MatEntity | undefined {
  if (!id) return undefined;
  const e = s.entities[id];
  return e?.kind === 'mat' ? e : undefined;
}

/** Absolute table coordinates of a mat's origin (walks the parent chain). */
export function matOrigin(s: TableState, matId: string | null): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let cur = matId;
  let hops = 0;
  while (cur && hops++ < 20) {
    const m = s.entities[cur];
    if (!m) break;
    x += m.pos.x;
    y += m.pos.y;
    cur = m.parent;
  }
  return { x, y };
}

// ---- visibility (SPEC §10–11) ------------------------------------------

export function ruleAllows(rule: VisibilityRule, viewerId: string, ownerId: string | null): boolean {
  if (rule === 'public') return true;
  if (rule === 'owner') return ownerId === viewerId;
  return rule.includes(viewerId);
}

export function canSeeFaces(mat: MatEntity, viewerId: string): boolean {
  return ruleAllows(mat.config.visibility.faces, viewerId, mat.config.ownerId);
}
export function canSeeCount(mat: MatEntity, viewerId: string): boolean {
  return ruleAllows(mat.config.visibility.count, viewerId, mat.config.ownerId);
}
export function canSeeExistence(mat: MatEntity, viewerId: string): boolean {
  return ruleAllows(mat.config.visibility.existence, viewerId, mat.config.ownerId);
}

/** Is this card's front visible to viewer? An explicitly face-up card is
 *  public wherever it lies; otherwise the containing mat's faces rule
 *  decides (the table root shows nothing that isn't face up). */
export function faceVisible(s: TableState, card: CardEntity, viewerId: string): boolean {
  if (card.state.faceUp) return true;
  const mat = getMat(s, card.parent);
  return mat ? canSeeFaces(mat, viewerId) : false;
}

/** A mat view is privileged if I can see faces some connected player can't. */
export function privileged(mat: MatEntity, viewerId: string, connected: string[]): boolean {
  if (!canSeeFaces(mat, viewerId)) return false;
  return connected.some((pid) => pid !== viewerId && !canSeeFaces(mat, pid));
}

export function describeRule(rule: VisibilityRule): string {
  if (rule === 'public') return 'everyone';
  if (rule === 'owner') return 'the owner only';
  if (rule.length === 0) return 'nobody';
  return rule.length === 1 ? '1 chosen player' : `${rule.length} chosen players`;
}

// ---- privacy presets (SPEC §15) ------------------------------------------

/** The visibility spectrum each preset stands for. */
export function privacyVisibility(p: MatPrivacy): MatVisibility {
  if (p === 'public') return { faces: 'public', count: 'public', existence: 'public' };
  if (p === 'nothing') return { faces: 'owner', count: 'owner', existence: 'owner' };
  return { faces: 'owner', count: 'public', existence: 'public' }; // backs | count
}

// ---- factories -----------------------------------------------------------

export const VIS_PUBLIC: MatVisibility = { faces: 'public', count: 'public', existence: 'public' };

export interface MatOpts {
  id?: string;
  label: string;
  placement?: MatEntity['config']['placement'];
  faceDefault?: 'up' | 'down' | 'keep';
  visibility?: Partial<MatVisibility>;
  privacy?: MatPrivacy;
  ownerId?: string | null;
  image?: string | null;
  color?: string | null;
  size?: { w: number; h: number } | null;
  positioning?: 'absolute' | 'arbitrary';
  locked?: boolean;
  order?: string[];
  groups?: string[];
}

export function makeMat(version: Version, pos: Pos, o: MatOpts): MatEntity {
  return {
    id: o.id ?? newId('mat'),
    kind: 'mat',
    version,
    parent: null,
    pos,
    positioning: o.positioning,
    locked: o.locked ?? false,
    config: {
      label: o.label,
      letter: null,
      ownerId: o.ownerId ?? null,
      placement: o.placement ?? { type: 'stack' },
      faceDefault: o.faceDefault ?? 'keep',
      visibility: {
        ...(o.privacy ? privacyVisibility(o.privacy) : VIS_PUBLIC),
        ...o.visibility,
      },
      privacy: o.privacy,
      image: o.image ?? null,
      color: o.color ?? null,
      size: o.size ?? null,
      groups: o.groups,
    },
    state: { order: o.order ?? [] },
  };
}

/** Canonical configurations (SPEC §10 table). */
export const matPresets = {
  deck: (label = 'Deck'): MatOpts => ({
    label,
    placement: { type: 'stack' },
    faceDefault: 'down',
    visibility: { faces: [] },
  }),
  pile: (label = 'Discard'): MatOpts => ({
    label,
    placement: { type: 'stack' },
    faceDefault: 'up',
    visibility: { faces: 'public' },
  }),
  // a hand is an ORDINARY private mat on the table (SPEC §15): each viewer
  // places it locally (arbitrary positioning); the tray is a pinned view
  hand: (ownerId: string): MatOpts => ({
    id: handIdFor(ownerId),
    label: 'Hand',
    ownerId,
    placement: { type: 'fan' },
    faceDefault: 'down',
    privacy: 'backs',
    positioning: 'arbitrary',
  }),
  zone: (label = 'Zone', faceDefault: 'up' | 'down' | 'keep' = 'keep'): MatOpts => ({
    label,
    placement: { type: 'free' },
    faceDefault,
    size: { w: 300, h: 220 },
  }),
};

/** Deterministic hand id: two peers ensuring the same player's hand
 *  concurrently create the same entity and LWW converges them. */
export function handIdFor(playerId: string): string {
  return `hand_${playerId}`;
}

// ---- the root mat: the table itself (SPEC §15) ----------------------------
// `parent: null` means "in the root mat". The root mat entity carries the
// felt's configuration (color, grid, entry rules) and is right-clickable,
// but renders as the table surface, never as an entity on it.

export const ROOT_MAT_ID = 'mat_table';

export function makeRootMat(version: Version): MatEntity {
  return makeMat(version, { x: 0, y: 0, z: 0, rot: 0 }, {
    id: ROOT_MAT_ID,
    label: 'Table',
    placement: { type: 'free' },
    locked: true,
  });
}

export function rootMat(s: TableState): MatEntity | undefined {
  return getMat(s, ROOT_MAT_ID);
}

export function handOf(s: TableState, playerId: string): MatEntity | undefined {
  return getMat(s, handIdFor(playerId));
}

/** Deterministic keyboard letters: prefer the label's first letter, else the
 *  next free a–z, assigned in id order — same result on every peer, no sync.
 *  The root mat is not a send-to target (that move is "to the table"). */
export function matLetters(s: TableState): Record<string, string> {
  const mats = Object.values(s.entities)
    .filter((e): e is MatEntity => e.kind === 'mat' && e.id !== ROOT_MAT_ID)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const used = new Set<string>();
  const out: Record<string, string> = {};
  const take = (want: string | null): string | null => {
    if (want && !used.has(want)) {
      used.add(want);
      return want;
    }
    for (const c of 'abcdefghijklmnopqrstuvwxyz') {
      if (!used.has(c)) {
        used.add(c);
        return c;
      }
    }
    return null;
  };
  for (const m of mats) {
    const fromLabel = m.config.label.trim().charAt(0).toLowerCase();
    const want = m.config.letter ?? (/[a-z]/.test(fromLabel) ? fromLabel : null);
    const l = take(want);
    if (l) out[m.id] = l;
  }
  return out;
}
