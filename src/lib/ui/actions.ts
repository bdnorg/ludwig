// The action registry (SPEC §12): every interaction verb defined once, then
// surfaced four ways — hover buttons, context menu, command palette, keys.
// `key` is a single-key chord; `needsMat: true` makes it a stateful sequence
// (press the key, then a mat's letter chooses the target).
//
// Actions that declare a pure `muts` builder compose over a SELECTION
// (PROPOSAL v4 §1): commitAll runs the builder per entity against a scratch
// state (so shared targets like one hand accumulate) and commits ONE batch —
// one undo reverses the whole motion.

import type { CardEntity, DiceEntity, Entity, MatEntity, Pos } from '../model/types';
import { newId } from '../model/types';
import type { Mutation } from '../model/reducers';
import { applyMutations } from '../model/reducers';
import * as ops from '../model/ops';
import type { OpCtx } from '../model/ops';
import { canSeeFaces, getMat, handIdFor, matItems, rootMat } from '../model/mats';
import { runMacro } from '../model/macros';
import { table } from '../state/store.svelte';

export interface RunArgs {
  mat?: MatEntity; // target for needsMat actions
  pos?: Pos;
}

export type MutsFn = (ctx: OpCtx, e: Entity, args?: RunArgs) => Mutation[];

export interface UiAction {
  id: string;
  label: string;
  icon?: string; // glyph for hover buttons
  key?: string; // keyboard chord (shown everywhere)
  needsMat?: boolean; // waits for a mat letter after the key
  /** in the hover strip? (otherwise menu/palette/key only) */
  hover?: boolean;
  /** pure mutation builder — presence makes the action selection-capable */
  muts?: MutsFn;
  appliesTo(sel: Entity): boolean;
  run(sel: Entity, args?: RunArgs): void;
}

const isStackish = (e: Entity): e is MatEntity =>
  e.kind === 'mat' && (e.config.placement.type === 'stack' || e.config.placement.type === 'fan');
const isMat = (e: Entity): e is MatEntity => e.kind === 'mat';
const nonEmpty = (m: MatEntity) => matItems(table.state, m).length > 0;

/** UI callbacks that live in the Table component (modals, prompts). */
export const uiHooks: {
  openSearch: (matId: string) => void;
  spotBeside: (e: Entity) => Pos;
} = {
  openSearch: () => {},
  spotBeside: () => ({ x: 0, y: 0, z: 0, rot: 0 }),
};

/** Run a muts builder over entities against a scratch snapshot, so steps
 *  compose (five cards into one hand = one coherent order), then commit the
 *  whole thing atomically. */
export function commitAll(mutsFn: MutsFn, ents: Entity[], args?: RunArgs): void {
  const scratch: OpCtx = {
    state: table.snapshot(),
    next: () => table.next(),
    clone: (x) => structuredClone(x),
  };
  const all: Mutation[] = [];
  for (const e0 of ents) {
    const e = scratch.state.entities[e0.id];
    if (!e) continue;
    const muts = mutsFn(scratch, e, args);
    applyMutations(scratch.state, muts);
    all.push(...muts);
  }
  table.commit(all);
}

// ---- muts builders (shared by single-run and selection-run) --------------

const flipMuts: MutsFn = (ctx, e) =>
  e.kind === 'card' ? ops.flipCard(ctx, e as CardEntity) : ops.flipTop(ctx, e as MatEntity);

const rollMuts: MutsFn = (ctx, e) =>
  e.kind === 'dice' ? ops.rollDice(ctx, e as DiceEntity, table.me.id) : [];

const toHandMuts: MutsFn = (ctx, e) => {
  const hand = ctx.state.entities[handIdFor(table.me.id)];
  return hand?.kind === 'mat' ? ops.moveToMat(ctx, e, hand) : [];
};

const sendMuts: MutsFn = (ctx, e, args) => {
  const m = args?.mat ? ctx.state.entities[args.mat.id] : undefined;
  if (m?.kind !== 'mat' || m.id === e.id) return [];
  if (isMat(e)) {
    // sending a stack sends its top item
    const top = matItems(ctx.state, e)[0];
    return top ? ops.moveToMat(ctx, top, m) : [];
  }
  return ops.moveToMat(ctx, e, m);
};

const shuffleMuts: MutsFn = (ctx, e) => (isMat(e) ? ops.shuffleMat(ctx, e) : []);

const deleteMuts: MutsFn = (ctx, e) => ops.deleteEntity(ctx, e);

const lockMuts: MutsFn = (ctx, e) => {
  const d = ctx.clone(e);
  d.locked = !d.locked;
  d.version = ctx.next();
  return [{ t: 'put', entity: d }];
};

const dupMuts: MutsFn = (ctx, e) => {
  const d = ctx.clone(e);
  d.id = newId(e.kind === 'token' ? 'tok' : e.kind);
  let z = 0;
  for (const x of Object.values(ctx.state.entities)) z = Math.max(z, x.pos.z);
  d.pos = { ...d.pos, x: d.pos.x + 24, y: d.pos.y + 24, z: z + 1 };
  d.version = ctx.next();
  const muts: Mutation[] = [{ t: 'put', entity: d }];
  const parent = getMat(ctx.state, e.parent);
  if (parent) {
    const m = ctx.clone(parent);
    m.state.order = [d.id, ...m.state.order];
    m.version = ctx.next();
    muts.push({ t: 'put', entity: m });
  }
  return muts;
};

export const ACTIONS: UiAction[] = [
  {
    id: 'draw',
    label: 'Draw to hand',
    icon: '🂠',
    key: 'd',
    hover: true,
    appliesTo: (e) => isStackish(e) && nonEmpty(e),
    run: (e) => table.commit(ops.drawTo(table, e as MatEntity, table.myHand())),
  },
  {
    id: 'flip',
    label: 'Flip',
    icon: '⇋',
    key: 'f',
    hover: true,
    muts: flipMuts,
    appliesTo: (e) =>
      e.kind === 'card' || (isStackish(e) && matItems(table.state, e)[0]?.kind === 'card'),
    run: (e) => commitAll(flipMuts, [e]),
  },
  {
    id: 'shuffle',
    label: 'Shuffle',
    icon: '🔀',
    key: 'r',
    hover: true,
    muts: shuffleMuts,
    appliesTo: (e) => isStackish(e) && nonEmpty(e),
    run: (e) => commitAll(shuffleMuts, [e]),
  },
  {
    id: 'roll',
    label: 'Roll',
    icon: '⚄',
    key: 'r',
    hover: true,
    muts: rollMuts,
    appliesTo: (e) => e.kind === 'dice',
    run: (e) => commitAll(rollMuts, [e]),
  },
  {
    id: 'to-hand',
    label: 'Take to hand',
    icon: '✋',
    key: 'h',
    hover: true,
    muts: toHandMuts,
    appliesTo: (e) => e.kind === 'card',
    run: (e) => {
      table.myHand(); // ensure it exists before the snapshot
      commitAll(toHandMuts, [e]);
    },
  },
  {
    id: 'send',
    label: 'Send to mat…',
    icon: '➤',
    key: 's',
    needsMat: true,
    muts: sendMuts,
    appliesTo: (e) => !e.locked && (e.kind === 'card' || e.kind === 'token' || isStackish(e)),
    run: (e, args) => commitAll(sendMuts, [e], args),
  },
  {
    id: 'draw-up',
    label: 'Draw face up',
    appliesTo: (e) => isStackish(e) && nonEmpty(e),
    run: (e) => table.commit(ops.drawToTable(table, e as MatEntity, uiHooks.spotBeside(e), true)),
  },
  {
    id: 'draw-down',
    label: 'Draw face down',
    appliesTo: (e) => isStackish(e) && nonEmpty(e),
    run: (e) => table.commit(ops.drawToTable(table, e as MatEntity, uiHooks.spotBeside(e), false)),
  },
  {
    id: 'deal',
    label: 'Deal to each player…',
    key: 'D',
    appliesTo: (e) => isStackish(e) && nonEmpty(e),
    run: (e) => {
      const n = Number(prompt('How many cards to each player?', '5'));
      if (Number.isInteger(n) && n > 0)
        table.commit(ops.deal(table, e as MatEntity, table.connectedHands(), n));
    },
  },
  {
    id: 'search',
    label: 'Search / spread…',
    appliesTo: (e) => isStackish(e) && nonEmpty(e) && canSeeFaces(e, table.me.id),
    run: (e) => uiHooks.openSearch(e.id),
  },
  {
    id: 'gather',
    label: 'Gather cards from table',
    appliesTo: (e) => isStackish(e),
    run: (e) => table.commit(ops.gatherTableCards(table, e as MatEntity)),
  },
  {
    id: 'front',
    label: 'Bring to front',
    key: ']',
    appliesTo: (e) => !e.locked,
    run: (e) =>
      table.update(e, (d) => {
        d.pos.z = table.maxZ() + 1;
      }),
  },
  {
    id: 'back',
    label: 'Send to back',
    key: '[',
    appliesTo: (e) => !e.locked,
    run: (e) =>
      table.update(e, (d) => {
        d.pos.z = table.minZ() - 1;
      }),
  },
  {
    id: 'lock',
    label: 'Lock / unlock',
    key: 'l',
    muts: lockMuts,
    appliesTo: () => true,
    run: (e) => commitAll(lockMuts, [e]),
  },
  {
    id: 'duplicate',
    label: 'Duplicate',
    muts: dupMuts,
    appliesTo: (e) => !e.locked && e.kind !== 'mat',
    run: (e) => commitAll(dupMuts, [e]),
  },
  {
    id: 'delete',
    label: 'Delete',
    key: 'x',
    muts: deleteMuts,
    appliesTo: (e) => !e.locked,
    run: (e) => commitAll(deleteMuts, [e]),
  },
];

export function actionsFor(sel: Entity | null): UiAction[] {
  if (!sel) return [];
  return ACTIONS.filter((a) => a.appliesTo(sel));
}

// ---- selection surface (PROPOSAL v4 §1) -----------------------------------

export function selectionEntities(): Entity[] {
  return table.selected.map((id) => table.get(id)).filter((e): e is Entity => !!e);
}

/** Actions valid for a whole selection: selection-capable (muts) and
 *  applicable to every member. */
export function actionsForSelection(ents: Entity[]): UiAction[] {
  if (ents.length === 0) return [];
  if (ents.length === 1) return actionsFor(ents[0]);
  return ACTIONS.filter((a) => a.muts && ents.every((e) => a.appliesTo(e)));
}

/** One-click act-on-all compounds for a mat's menu ("Flip all 5 cards"),
 *  derived from the registry — a selection shortcut, not per-kind code. */
export function matCompoundItems(mat: MatEntity): Array<{ label: string; run: () => void }> {
  const items = matItems(table.state, mat);
  const out: Array<{ label: string; run: () => void }> = [];
  const cards = items.filter((e) => e.kind === 'card');
  if (cards.length > 1 && mat.config.placement.type !== 'stack')
    out.push({ label: `Flip all ${cards.length} cards here`, run: () => commitAll(flipMuts, cards) });
  const dice = items.filter((e) => e.kind === 'dice');
  if (dice.length > 1)
    out.push({ label: `Roll all ${dice.length} dice here`, run: () => commitAll(rollMuts, dice) });
  return out;
}

/** Run a mat button / quick-action id (v4 §5, §9): a registry action on the
 *  mat, a compound (roll-all-dice, flip-all-cards), or macro:<id>. */
export function runMatButton(actionId: string, mat: MatEntity): void {
  if (actionId.startsWith('macro:')) {
    macroActions()
      .find((a) => a.id === actionId)
      ?.run(mat);
    return;
  }
  if (actionId === 'roll-all-dice') {
    const dice = matItems(table.state, mat).filter((e) => e.kind === 'dice');
    if (dice.length > 0) commitAll(rollMuts, dice);
    return;
  }
  if (actionId === 'flip-all-cards') {
    const cards = matItems(table.state, mat).filter((e) => e.kind === 'card');
    if (cards.length > 0) commitAll(flipMuts, cards);
    return;
  }
  const a = ACTIONS.find((x) => x.id === actionId);
  if (a && a.appliesTo(mat)) a.run(mat);
}

export function matButtonLabel(actionId: string): string {
  if (actionId === 'roll-all-dice') return 'Roll';
  if (actionId === 'flip-all-cards') return 'Flip all';
  if (actionId.startsWith('macro:'))
    return macroActions().find((a) => a.id === actionId)?.label ?? actionId;
  return ACTIONS.find((x) => x.id === actionId)?.label ?? actionId;
}

/** Template-defined macros from the root mat, as registry actions (SPEC §15).
 *  They need no selection — the whole table is their subject. Surfaced in
 *  the quick-action strip and the command palette. */
export function macroActions(): UiAction[] {
  const root = rootMat(table.state);
  return (root?.config.macros ?? []).map((m) => ({
    id: `macro:${m.id}`,
    label: m.label,
    icon: '▶',
    appliesTo: () => true,
    run: () => {
      const muts = runMacro(table, table.snapshot(), m, table.connectedHands());
      if (muts.length === 0) return;
      table.commit(muts);
      table.logMsg(`${table.playerName(table.me.id)} ran “${m.label}”`);
    },
  }));
}

/** Resolve a pressed key against the selection (same key may serve several
 *  actions — the selection disambiguates, e.g. `r` = roll dice / shuffle mat). */
export function actionForKey(key: string, sel: Entity | null): UiAction | undefined {
  if (!sel) return undefined;
  return ACTIONS.find((a) => a.key === key && a.appliesTo(sel));
}

/** Same, for a multi-selection: only selection-capable actions qualify. */
export function actionForKeyMulti(key: string, ents: Entity[]): UiAction | undefined {
  return ACTIONS.find((a) => a.key === key && a.muts && ents.every((e) => a.appliesTo(e)));
}
