// Macro runner (SPEC §15: repeatable motions are configuration). A macro is
// a template-defined sequence of core ops — "deal 5 to hands", "gather from
// play areas", "reset to start" — carried on the root mat's config and run
// as ONE atomic mutation batch (so undo reverses the whole motion).
//
// Steps run against a scratch copy of the table so each sees the previous
// step's result ("gather then shuffle" shuffles the gathered deck); versions
// keep increasing across steps, so the final batch converges like any edit.

import type { Entity, MacroDef, MacroStep, MatEntity, Version } from './types';
import type { Mutation, TableState } from './reducers';
import { applyMutations } from './reducers';
import type { OpCtx } from './ops';
import * as ops from './ops';
import { matCards, matItems } from './mats';

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

/** Move every card in each source mat into `target` (top, entry face rule —
 *  'keep' gathers face down, like sweeping cards into a deck). */
export function gatherFrom(ctx: OpCtx, sources: MatEntity[], target: MatEntity): Mutation[] {
  const muts: Mutation[] = [];
  const gathered: string[] = [];
  for (const src of sources) {
    if (src.id === target.id) continue;
    const cards = matCards(ctx.state, src);
    if (cards.length === 0) continue;
    const taken = new Set(cards.map((c) => c.id));
    const m = ctx.clone(src);
    m.state.order = m.state.order.filter((id) => !taken.has(id));
    m.version = ctx.next();
    muts.push({ t: 'put', entity: m });
    for (const card of cards) {
      const c = ctx.clone(card);
      c.parent = target.id;
      c.state.faceUp = target.config.faceDefault === 'keep' ? false : target.config.faceDefault === 'up';
      c.version = ctx.next();
      muts.push({ t: 'put', entity: c });
      gathered.push(c.id);
    }
  }
  if (gathered.length === 0) return [];
  const t = ctx.clone(target);
  t.state.order = [...gathered, ...matItems(ctx.state, target).map((e) => e.id)];
  t.version = ctx.next();
  muts.push({ t: 'put', entity: t });
  return muts;
}

function runStep(ctx: ScratchCtx, step: MacroStep, hands: MatEntity[]): Mutation[] {
  if (step.op === 'deal') {
    const from = step.from ? matByLabel(ctx.state, step.from) : undefined;
    const to = matsInGroup(ctx.state, step.to ?? 'hands', hands);
    if (!from || to.length === 0) return [];
    return ops.deal(ctx, from, to, step.n ?? 1);
  }
  if (step.op === 'gather') {
    const target = step.to ? matByLabel(ctx.state, step.to) : undefined;
    if (!target) return [];
    if (step.from === 'table') return ops.gatherTableCards(ctx, target);
    return gatherFrom(ctx, matsInGroup(ctx.state, step.from ?? '', hands), target);
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
