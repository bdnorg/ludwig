// Gamebox packages (M18): a whole game as PURE CONFIGURATION — no code.
//
// A gamebox is a directory with a manifest.json. The manifest carries an
// asset registry (ids → urls, so entities never repeat urls), a LAYOUT of
// declarations interpreted by the existing factories (makeMat, buildCardSet,
// tokenPile — kinds stay rendering primitives, behavior stays configuration),
// root-mat macros, and optional reference pages (SPEC §13). The loader
// validates, resolves asset ids, and instantiates into a fresh room via the
// same pending path templates use.
//
// Layout items refer to mats BY LABEL (like macros do): an item with
// `in: "Island"` lands inside the mat declared with that label earlier in
// the layout. Positions are relative to the gamebox origin.

import type { Entity, EntityKind, MacroDef, MatEntity, Pos, TokenEntity } from './types';
import { newId } from './types';
import type { Mutation } from './reducers';
import type { OpCtx } from './ops';
import { tokenPile } from './ops';
import { buildCardSet, validateCardSet, type CardSetSpec } from './cardsets';
import { makeMat, type MatOpts } from './mats';

// ---- manifest shape -------------------------------------------------------

export interface GameboxReferencePage {
  title: string;
  md: string; // markdown-ish text, rendered read-only
}

/** JSON-safe subset of MatOpts a gamebox may declare. */
export type GameboxMatOpts = Omit<MatOpts, 'id' | 'order' | 'positioning'>;

export type LayoutItem =
  | { type: 'cardset'; at: [number, number]; in?: string; spec: CardSetSpec }
  | { type: 'mat'; at: [number, number]; in?: string; opts: GameboxMatOpts }
  | {
      type: 'pile';
      at: [number, number];
      in?: string;
      token: TokenEntity['config'];
      count: number;
    }
  | { type: 'token'; at: [number, number]; in?: string; config: TokenEntity['config']; rot?: number; locked?: boolean }
  | { type: 'dice'; at: [number, number]; in?: string; sides?: number; value?: number }
  | { type: 'counter'; at: [number, number]; label?: string }
  | { type: 'scoreboard'; at: [number, number]; label?: string }
  | { type: 'timer'; at: [number, number] }
  | { type: 'note'; at: [number, number]; text: string; color?: string };

export interface GameboxManifest {
  gamebox: 1; // format version
  name: string;
  blurb?: string;
  version?: string;
  /** asset registry: id → url. Entities reference "asset:<id>" in any image
   *  field; the builder resolves them so urls live in exactly one place. */
  assets?: Record<string, string>;
  macros?: MacroDef[];
  reference?: GameboxReferencePage[];
  layout: LayoutItem[];
}

// ---- validation ------------------------------------------------------------

const LAYOUT_TYPES = new Set([
  'cardset', 'mat', 'pile', 'token', 'dice', 'counter', 'scoreboard', 'timer', 'note',
]);

function bad(msg: string): never {
  throw new Error(`gamebox: ${msg}`);
}

/** Validate an untrusted manifest (upload / fetch). Throws with a readable
 *  message; returns the typed manifest. */
export function validateGamebox(raw: unknown): GameboxManifest {
  const m = raw as GameboxManifest;
  if (!m || typeof m !== 'object') bad('not an object');
  if (m.gamebox !== 1) bad('missing/unsupported "gamebox" format version (expected 1)');
  if (typeof m.name !== 'string' || m.name.length === 0) bad('needs a "name"');
  if (!Array.isArray(m.layout) || m.layout.length === 0) bad('needs a non-empty "layout"');
  if (m.layout.length > 500) bad('layout too large (max 500 items)');
  if (m.assets && typeof m.assets !== 'object') bad('"assets" must be an id → url map');
  for (const [k, v] of Object.entries(m.assets ?? {}))
    if (typeof v !== 'string') bad(`asset "${k}" must be a url string`);

  const matLabels = new Set<string>();
  let entities = 0;
  for (const [i, item] of m.layout.entries()) {
    const where = `layout[${i}]`;
    if (!item || typeof item !== 'object' || !LAYOUT_TYPES.has((item as LayoutItem).type))
      bad(`${where}: unknown type "${(item as LayoutItem)?.type}"`);
    const it = item as LayoutItem;
    if (!Array.isArray(it.at) || it.at.length !== 2 || !it.at.every((n) => Number.isFinite(n)))
      bad(`${where}: "at" must be [x, y]`);
    if ('in' in it && it.in !== undefined && !matLabels.has(it.in))
      bad(`${where}: "in" refers to unknown mat label "${it.in}" (declare the mat first)`);
    switch (it.type) {
      case 'cardset':
        validateCardSet(it.spec);
        entities += it.spec.cards.reduce((n, c) => n + (c.count ?? 1), 0) + 1;
        matLabels.add(it.spec.name);
        break;
      case 'mat':
        if (!it.opts || typeof it.opts.label !== 'string') bad(`${where}: mat needs opts.label`);
        matLabels.add(it.opts.label);
        entities += 1;
        break;
      case 'pile':
        if (!it.token || typeof it.token !== 'object') bad(`${where}: pile needs a token config`);
        if (!Number.isInteger(it.count) || it.count < 1 || it.count > 500)
          bad(`${where}: pile count must be 1–500`);
        entities += it.count + 1;
        break;
      case 'token':
        if (!it.config || typeof it.config !== 'object') bad(`${where}: token needs a config`);
        entities += 1;
        break;
      case 'note':
        if (typeof it.text !== 'string') bad(`${where}: note needs text`);
        entities += 1;
        break;
      default:
        entities += 1;
    }
  }
  if (entities > 5000) bad(`too many entities (${entities} > 5000)`);
  for (const p of m.reference ?? [])
    if (typeof p?.title !== 'string' || typeof p?.md !== 'string')
      bad('every reference page needs "title" and "md"');
  return m;
}

// ---- building --------------------------------------------------------------

/** Resolve "asset:<id>" references against the manifest's registry. */
function resolveAsset(assets: Record<string, string>, v: string | null | undefined): string | null {
  if (!v) return null;
  if (!v.startsWith('asset:')) return v;
  const url = assets[v.slice('asset:'.length)];
  if (!url) bad(`unknown asset id "${v}"`);
  return url;
}

/** Instantiate a validated manifest into mutations for a fresh table.
 *  Layout coordinates are offset by `origin`. Macros come back separately —
 *  they belong on the root mat (behavior is configuration, SPEC §15). */
export function buildGamebox(
  ctx: OpCtx,
  m: GameboxManifest,
  origin: Pos = { x: 60, y: 60, z: 1, rot: 0 },
): { muts: Mutation[]; macros: MacroDef[] } {
  const assets = m.assets ?? {};
  const muts: Mutation[] = [];
  const matByLabel = new Map<string, MatEntity>();
  let z = origin.z;

  const place = (item: { at: [number, number]; in?: string }): { pos: Pos; parent: string | null } => {
    const parent = item.in ? (matByLabel.get(item.in) ?? null) : null;
    // inside a mat, coordinates are mat-relative already
    const base = parent ? { x: 0, y: 0 } : { x: origin.x, y: origin.y };
    return {
      pos: { x: base.x + item.at[0], y: base.y + item.at[1], z: z++, rot: 0 },
      parent: parent?.id ?? null,
    };
  };
  const spawn = (
    kind: EntityKind,
    pos: Pos,
    parent: string | null,
    config: unknown,
    state: unknown,
  ) => {
    muts.push({
      t: 'put',
      entity: {
        id: newId(kind === 'token' ? 'tok' : kind),
        kind,
        version: ctx.next(),
        parent,
        pos,
        locked: false,
        config,
        state,
      } as Entity,
    });
  };

  for (const item of m.layout) {
    const { pos, parent } = place(item);
    switch (item.type) {
      case 'cardset': {
        const spec: CardSetSpec = {
          ...item.spec,
          cards: item.spec.cards.map((c) => ({
            ...c,
            image: resolveAsset(assets, c.image) ?? undefined,
          })),
        };
        const setMuts = buildCardSet(ctx, spec, pos);
        // the deck mat is the last mutation; remember it and fix containment
        const deckPut = setMuts[setMuts.length - 1];
        if (deckPut.t === 'put' && deckPut.entity.kind === 'mat') {
          deckPut.entity.parent = parent;
          matByLabel.set(item.spec.name, deckPut.entity);
        }
        muts.push(...setMuts);
        break;
      }
      case 'mat': {
        const opts: MatOpts = {
          ...item.opts,
          image: resolveAsset(assets, item.opts.image),
        };
        const mat = makeMat(ctx.next(), pos, opts);
        mat.parent = parent;
        matByLabel.set(opts.label, mat);
        muts.push({ t: 'put', entity: mat });
        break;
      }
      case 'pile':
        muts.push(...tokenPile(ctx, parent, pos, item.token, item.count));
        break;
      case 'token':
        spawn('token', { ...pos, rot: item.rot ?? 0 }, parent, item.config, { count: 1 });
        if (item.locked) {
          const put = muts[muts.length - 1];
          if (put.t === 'put') put.entity.locked = true;
        }
        break;
      case 'dice':
        spawn('dice', pos, parent, { sides: item.sides ?? 6 }, {
          values: [item.value ?? 1],
          rolledBy: null,
          rolledAt: 0,
        });
        break;
      case 'counter':
        spawn('counter', pos, parent, { label: item.label ?? 'Counter' }, { value: 0 });
        break;
      case 'scoreboard':
        spawn('scoreboard', pos, parent, { label: item.label ?? 'Score' }, { values: {} });
        break;
      case 'timer':
        spawn('timer', pos, parent, {}, {
          mode: 'stopwatch',
          running: false,
          startedAt: 0,
          elapsedMs: 0,
          durationMs: 0,
        });
        break;
      case 'note':
        spawn('note', pos, parent, { color: item.color ?? '#e7d980' }, { text: item.text });
        break;
    }
  }
  return { muts, macros: m.macros ?? [] };
}
