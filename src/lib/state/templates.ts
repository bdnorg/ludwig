// Built-in table templates, applied to a fresh room chosen from the lobby
// gallery. The pending choice travels via sessionStorage so it survives the
// hash navigation into the table route.

import { standardDeck } from '../model/cards52';
import { dominionTable } from '../model/dominion';
import type { TableStore } from './store.svelte';

const KEY = 'ludwig:pending-template';

export const TEMPLATES = [
  { id: 'sandbox', name: 'Empty sandbox', blurb: 'A bare table — add anything from the palette.' },
  { id: 'cards52', name: '52-card deck', blurb: 'Poker, hearts, euchre, rummy…' },
  { id: 'dominion', name: 'Dominion (base, first game)', blurb: 'Full supply, kingdom, and starter decks.' },
] as const;

export type TemplateId = (typeof TEMPLATES)[number]['id'];

export function requestTemplate(id: TemplateId): void {
  sessionStorage.setItem(KEY, id);
}

export function applyPendingTemplate(store: TableStore): void {
  const id = sessionStorage.getItem(KEY);
  if (!id) return;
  sessionStorage.removeItem(KEY);
  // never stamp a template over a table that already has content (hands are
  // docked owner-mats created automatically, so they don't count)
  const hasContent = Object.values(store.state.entities).some(
    (e) => !(e.kind === 'mat' && e.config.docked && e.config.ownerId !== null),
  );
  if (hasContent) return;
  if (id === 'cards52')
    store.emit(standardDeck(store, { x: 620, y: 300, z: 1, rot: 0 }));
  else if (id === 'dominion') store.emit(dominionTable(store, { x: 70, y: 70, z: 1, rot: 0 }));
}
