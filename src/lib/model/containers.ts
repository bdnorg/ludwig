// Container membership. Two sources of truth exist by design:
// card.parent is the membership authority (per-entity LWW converges it),
// container.state.cards is the order authority. Concurrent edits can leave a
// container list mentioning a card that has since moved, or missing one that
// points at it — these helpers reconcile, so every reader self-heals.

import type { CardEntity, DeckEntity, HandEntity } from './types';
import type { TableState } from './reducers';

type Container = DeckEntity | HandEntity;

/** Cards actually in `container`, in list order; strays appended (stable). */
export function containerCards(s: TableState, container: Container): CardEntity[] {
  const inIt = (id: string): CardEntity | null => {
    const e = s.entities[id];
    return e && e.kind === 'card' && e.parent === container.id ? e : null;
  };
  const seen = new Set<string>();
  const out: CardEntity[] = [];
  for (const id of container.state.cards) {
    const c = inIt(id);
    if (c && !seen.has(id)) {
      out.push(c);
      seen.add(id);
    }
  }
  for (const e of Object.values(s.entities)) {
    if (e.kind === 'card' && e.parent === container.id && !seen.has(e.id)) out.push(e);
  }
  return out;
}

export function topCard(s: TableState, deck: DeckEntity): CardEntity | undefined {
  return containerCards(s, deck)[0];
}

export function handOf(s: TableState, playerId: string): HandEntity | undefined {
  const e = s.entities[handIdFor(playerId)];
  return e?.kind === 'hand' ? e : undefined;
}

/** Deterministic hand id: two peers ensuring the same player's hand
 *  concurrently create the same entity and LWW converges them. */
export function handIdFor(playerId: string): string {
  return `hand_${playerId}`;
}
