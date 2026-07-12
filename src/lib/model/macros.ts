// Macro runner (SPEC §15: repeatable motions are configuration). A macro is
// a template-defined sequence of core ops — "deal 5 to hands", "gather from
// play areas", "reset to start" — carried on the root mat's config and run
// as ONE atomic mutation batch (so undo reverses the whole motion).
//
// Steps run against a scratch copy of the table so each sees the previous
// step's result ("gather then shuffle" shuffles the gathered deck); versions
// keep increasing across steps, so the final batch converges like any edit.

import type { Entity, MacroDef, MacroStep, MacroWhere, MatEntity, Version } from './types';
import type { Mutation, TableState } from './reducers';
import { applyMutations } from './reducers';
import type { OpCtx } from './ops';
import * as ops from './ops';
import { matItems } from './mats';

class ScratchCtx implements OpCtx {
  constructor(
    public state: TableState,
    private outer: OpCtx,
  ) {}
  next(): Version {
    return this.outer.next();
  }
  clone<T extends Entity>(e: T): T {
    return structuredClone(e);
  }
}

function matByLabel(s: TableState, label: string): MatEntity | undefined {
  const want = label.trim().toLowerCase();
  return Object.values(s.entities).find(
    (e): e is MatEntity => e.kind === 'mat' && e.config.label.trim().toLowerCase() === want,
  );
}

/** Mats in a named group. 'hands' is built in: the given hands (connected
 *  players'); other groups come from mat config. */
export function matsInGroup(s: TableState, group: string, hands: MatEntity[]): MatEntity[] {
  if (group === 'hands') return hands.map((h) => s.entities[h.id] as MatEntity).filter(Boolean);
  return Object.values(s.entities).filter(
    (e): e is MatEntity => e.kind === 'mat' && (e.config.groups ?? []).includes(group),
  );
}

/** Item filter (v4 §8): every given field must match. */
export function matchesWhere(e: Entity, w?: MacroWhere): boolean {
  if (!w) return true;
  if (w.kind && e.kind !== w.kind) return false;
  if (w.title && !(e.kind === 'card' && e.config.front.title === w.title)) return false;
  if (w.tag && !(e.kind === 'token' && (e.config.tags ?? []).includes(w.tag))) return false;
  return true;
}

/** Items a step's `from` names: loose on the felt ('table'), everything in
 *  a group's mats, or one mat's contents — filtered by `where`. */
function sourceItems(
  s: TableState,
  from: string,
  hands: MatEntity[],
  where?: MacroWhere,
): Entity[] {
  let items: Entity[];
  if (from === 'table') {
    items = Object.values(s.entities).filter((e) => e.parent === null && e.kind !== 'mat');
  } else {
    const mats = matsInGroup(s, from, hands);
    const sources = mats.length > 0 ? mats : [matByLabel(s, from)].filter((m): m is MatEntity => !!m);
    items = sources.flatMap((m) => matItems(s, m));
  }
  return items.filter((e) => matchesWhere(e, where));
}

function runStep(ctx: ScratchCtx, step: MacroStep, hands: MatEntity[]): Mutation[] {
  if (step.op === 'deal') {
    const from = step.from ? matByLabel(ctx.state, step.from) : undefined;
    const to = matsInGroup(ctx.state, step.to ?? 'hands', hands);
    if (!from || to.length === 0) return [];
    return ops.deal(ctx, from, to, step.n ?? 1);
  }
  if (step.op === 'gather' || step.op === 'move') {
    // gather = the classic card sweep; move = any matching items
    const target = step.to ? matByLabel(ctx.state, step.to) : undefined;
    if (!target) return [];
    const items = sourceItems(ctx.state, step.from ?? '', hands, step.where).filter(
      (e) => step.op === 'move' || e.kind === 'card',
    );
    return ops.moveItemsInto(ctx, items, target);
  }
  if (step.op === 'flip') {
    const items = sourceItems(ctx.state, step.from ?? 'table', hands, step.where);
    const muts: Mutation[] = [];
    for (const e of items) {
      if (e.kind !== 'card') continue;
      const c = ctx.clone(e);
      c.state.faceUp = step.face ? step.face === 'up' : !c.state.faceUp;
      c.version = ctx.next();
      muts.push({ t: 'put', entity: c });
    }
    return muts;
  }
  if (step.op === 'deal-to-slots') {
    const from = step.from ? matByLabel(ctx.state, step.from) : undefined;
    const board = step.to ? matByLabel(ctx.state, step.to) : undefined;
    if (!from || board?.config.placement.type !== 'slots') return [];
    return ops.dealToSlots(ctx, from, board);
  }
  // shuffle
  const mat = matByLabel(ctx.state, step.from ?? step.to ?? '');
  return mat ? ops.shuffleMat(ctx, mat) : [];
}

/** All steps against a scratch snapshot; returns one atomic batch. */
export function runMacro(
  outer: OpCtx,
  snapshot: TableState,
  macro: MacroDef,
  hands: MatEntity[],
): Mutation[] {
  const ctx = new ScratchCtx(snapshot, outer);
  const all: Mutation[] = [];
  for (const step of macro.steps) {
    const muts = runStep(ctx, step, hands);
    applyMutations(ctx.state, muts);
    all.push(...muts);
  }
  return all;
}

/** The classic card-table motions, for the built-in templates. */
export function cardTableMacros(deckLabel = 'Deck'): MacroDef[] {
  return [
    {
      id: 'deal5',
      label: `Deal 5 to hands`,
      steps: [{ op: 'deal', from: deckLabel, to: 'hands', n: 5 }],
    },
    {
      id: 'reset',
      label: 'Gather & shuffle',
      steps: [
        { op: 'gather', from: 'hands', to: deckLabel },
        { op: 'gather', from: 'play', to: deckLabel },
        { op: 'gather', from: 'table', to: deckLabel },
        { op: 'shuffle', from: deckLabel },
      ],
    },
  ];
}
