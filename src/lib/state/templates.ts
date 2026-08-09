// Built-in table templates, applied to a fresh room chosen from the lobby
// gallery. The pending choice (or a whole imported table file) travels via
// sessionStorage so it survives the hash navigation into the table route.

import type { MacroDef } from '../model/types';
import type { TableState } from '../model/reducers';
import { standardDeck } from '../model/cards52';
import { dominionTable } from '../model/dominion';
import { catanMacros, catanTable } from '../model/catan';
import { cardTableMacros } from '../model/macros';
import { buildGamebox, rootGameboxMutation, validateGamebox, type GameboxManifest } from '../model/gamebox';
import { ROOT_MAT_ID } from '../model/mats';
import type { TableStore } from './store.svelte';

const KEY = 'ludwig:pending-template';
const IMPORT_KEY = 'ludwig:pending-import';
const GAMEBOX_KEY = 'ludwig:pending-gamebox';

export const TEMPLATES = [
  { id: 'sandbox', name: 'Empty sandbox', blurb: 'A bare table — add anything from the palette.' },
  { id: 'cards52', name: '52-card deck', blurb: 'Poker, hearts, euchre, rummy…' },
  { id: 'dominion', name: 'Dominion (base, first game)', blurb: 'Full supply, kingdom, and starter decks.' },
  { id: 'catan', name: 'Settlers of Catan (beginner board)', blurb: 'Snap-slot island, finite pieces, resources.' },
] as const;

export type TemplateId = (typeof TEMPLATES)[number]['id'];

export function requestTemplate(id: TemplateId): void {
  sessionStorage.setItem(KEY, id);
}

/** Stash an imported table file to seed the next room (lobby import). */
export function requestImport(snap: TableState): void {
  sessionStorage.setItem(IMPORT_KEY, JSON.stringify(snap));
}

/** Stash a gamebox manifest (M18: a fetched built-in or an uploaded
 *  package) to instantiate into the next room. Callers validate first. */
export function requestGamebox(manifest: GameboxManifest): void {
  sessionStorage.setItem(GAMEBOX_KEY, JSON.stringify(manifest));
}

/** Macros live on the root mat: behavior is configuration (SPEC §15). */
function setRootMacros(store: TableStore, macros: MacroDef[]): void {
  store.emit(rootGameboxMutation(store, { macros }));
}

export function applyPendingTemplate(store: TableStore): void {
  // never stamp anything over a table that already has content (the root
  // mat and hands are created automatically, so they don't count)
  const hasContent = Object.values(store.state.entities).some(
    (e) => !(e.kind === 'mat' && (e.config.ownerId !== null || e.id === ROOT_MAT_ID)),
  );

  const rawImport = sessionStorage.getItem(IMPORT_KEY);
  if (rawImport) {
    sessionStorage.removeItem(IMPORT_KEY);
    sessionStorage.removeItem(KEY);
    if (hasContent) return;
    try {
      const snap = JSON.parse(rawImport) as TableState;
      snap.tombstones ??= {};
      snap.log ??= {};
      store.receiveSnapshot(snap);
    } catch {
      /* corrupt stash — leave the fresh table */
    }
    return;
  }

  // gamebox packages: pure config, instantiated by the loader (M18)
  const rawBox = sessionStorage.getItem(GAMEBOX_KEY);
  if (rawBox) {
    sessionStorage.removeItem(GAMEBOX_KEY);
    sessionStorage.removeItem(KEY);
    if (hasContent) return;
    try {
      const manifest = validateGamebox(JSON.parse(rawBox));
      const { muts, macros, reference } = buildGamebox(store, manifest);
      store.emit(muts);
      if (macros.length > 0 || reference.length > 0)
        store.emit(rootGameboxMutation(store, { macros, reference }));
    } catch {
      /* corrupt stash — leave the fresh table */
    }
    return;
  }

  const id = sessionStorage.getItem(KEY);
  if (!id) return;
  sessionStorage.removeItem(KEY);
  if (hasContent) return;
  if (id === 'cards52') {
    store.emit(standardDeck(store, { x: 620, y: 300, z: 1, rot: 0 }));
    setRootMacros(store, cardTableMacros('Deck'));
  } else if (id === 'dominion') store.emit(dominionTable(store, { x: 70, y: 70, z: 1, rot: 0 }));
  else if (id === 'catan') {
    store.emit(catanTable(store, { x: 280, y: 60, z: 1, rot: 0 }));
    setRootMacros(store, catanMacros());
  }
}
