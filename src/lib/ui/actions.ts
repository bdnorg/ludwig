// The action registry (SPEC §12): every interaction verb defined once, then
// surfaced four ways — hover buttons, context menu, command palette, keys.
// `key` is a single-key chord; `needsMat: true` makes it a stateful sequence
// (press the key, then a mat's letter chooses the target).

import type { Entity, MatEntity, Pos } from '../model/types';
import * as ops from '../model/ops';
import { canSeeFaces, matItems } from '../model/mats';
import { table } from '../state/store.svelte';

export interface RunArgs {
  mat?: MatEntity; // target for needsMat actions
  pos?: Pos;
}

export interface UiAction {
  id: string;
  label: string;
  icon?: string; // glyph for hover buttons
  key?: string; // keyboard chord (shown everywhere)
  needsMat?: boolean; // waits for a mat letter after the key
  /** in the hover strip? (otherwise menu/palette/key only) */
  hover?: boolean;
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
    appliesTo: (e) =>
      e.kind === 'card' || (isStackish(e) && matItems(table.state, e)[0]?.kind === 'card'),
    run: (e) =>
      table.commit(
        e.kind === 'card' ? ops.flipCard(table, e) : ops.flipTop(table, e as MatEntity),
      ),
  },
  {
    id: 'shuffle',
    label: 'Shuffle',
    icon: '🔀',
    key: 'r',
    hover: true,
    appliesTo: (e) => isStackish(e) && nonEmpty(e),
    run: (e) => table.commit(ops.shuffleMat(table, e as MatEntity)),
  },
  {
    id: 'roll',
    label: 'Roll',
    icon: '⚄',
    key: 'r',
    hover: true,
    appliesTo: (e) => e.kind === 'dice',
    run: (e) => table.commit(ops.rollDice(table, e as never, table.me.id)),
  },
  {
    id: 'to-hand',
    label: 'Take to hand',
    icon: '✋',
    key: 'h',
    hover: true,
    appliesTo: (e) => e.kind === 'card',
    run: (e) => table.commit(ops.moveToMat(table, e, table.myHand())),
  },
  {
    id: 'send',
    label: 'Send to mat…',
    icon: '➤',
    key: 's',
    needsMat: true,
    appliesTo: (e) => !e.locked && (e.kind === 'card' || e.kind === 'token' || isStackish(e)),
    run: (e, args) => {
      if (!args?.mat || args.mat.id === e.id) return;
      if (isMat(e)) {
        // sending a stack sends its top item
        const top = matItems(table.state, e)[0];
        if (top) table.commit(ops.moveToMat(table, top, args.mat));
        return;
      }
      table.commit(ops.moveToMat(table, e, args.mat));
    },
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
    id: 'lock',
    label: 'Lock / unlock',
    key: 'l',
    appliesTo: () => true,
    run: (e) =>
      table.update(e, (d) => {
        d.locked = !d.locked;
      }),
  },
  {
    id: 'delete',
    label: 'Delete',
    key: 'x',
    appliesTo: (e) => !e.locked,
    run: (e) => table.commit(ops.deleteEntity(table, e)),
  },
];

export function actionsFor(sel: Entity | null): UiAction[] {
  if (!sel) return [];
  return ACTIONS.filter((a) => a.appliesTo(sel));
}

/** Resolve a pressed key against the selection (same key may serve several
 *  actions — the selection disambiguates, e.g. `r` = roll dice / shuffle mat). */
export function actionForKey(key: string, sel: Entity | null): UiAction | undefined {
  if (!sel) return undefined;
  return ACTIONS.find((a) => a.key === key && a.appliesTo(sel));
}
