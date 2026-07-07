// Op builders: each computes the concrete mutations for a physical action
// (shuffle, draw, deal, play…). The acting peer resolves all randomness and
// choice locally and broadcasts only the resulting mutations, applied
// atomically everywhere (SPEC §5).

import type { CardEntity, DeckEntity, Entity, HandEntity, Pos, Version } from './types';
import type { Mutation, TableState } from './reducers';
import { containerCards } from './containers';
import { shuffled } from './rng';

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

/** Remove a card id from whatever container list mentions it. */
function pluckFromContainer(ctx: OpCtx, card: CardEntity): Mutation[] {
  if (card.parent === null) return [];
  const holder = ctx.state.entities[card.parent];
  if (!holder || (holder.kind !== 'deck' && holder.kind !== 'hand')) return [];
  const h = ctx.clone(holder);
  h.state.cards = h.state.cards.filter((id) => id !== card.id);
  return [put(ctx, h)];
}

export function shuffleDeck(ctx: OpCtx, deck: DeckEntity): Mutation[] {
  const d = ctx.clone(deck);
  d.state.cards = shuffled(containerCards(ctx.state, deck).map((c) => c.id));
  return [put(ctx, d)];
}

export function drawToHand(ctx: OpCtx, deck: DeckEntity, hand: HandEntity, n = 1): Mutation[] {
  const cards = containerCards(ctx.state, deck).slice(0, n);
  if (cards.length === 0) return [];
  const d = ctx.clone(deck);
  const h = ctx.clone(hand);
  const taken = new Set(cards.map((c) => c.id));
  d.state.cards = d.state.cards.filter((id) => !taken.has(id));
  h.state.cards = [...h.state.cards, ...cards.map((c) => c.id)];
  const muts = [put(ctx, d), put(ctx, h)];
  for (const card of cards) {
    const c = ctx.clone(card);
    c.parent = hand.id;
    muts.push(put(ctx, c));
  }
  return muts;
}

export function drawToTable(ctx: OpCtx, deck: DeckEntity, pos: Pos, faceUp: boolean): Mutation[] {
  const card = containerCards(ctx.state, deck)[0];
  if (!card) return [];
  const d = ctx.clone(deck);
  d.state.cards = d.state.cards.filter((id) => id !== card.id);
  const c = ctx.clone(card);
  c.parent = null;
  c.pos = pos;
  c.state.faceUp = faceUp;
  return [put(ctx, d), put(ctx, c)];
}

/** Deal n cards to each hand, round-robin from the top, like a real deal. */
export function deal(ctx: OpCtx, deck: DeckEntity, hands: HandEntity[], n: number): Mutation[] {
  if (hands.length === 0) return [];
  const available = containerCards(ctx.state, deck);
  const d = ctx.clone(deck);
  const hs = hands.map((h) => ctx.clone(h));
  const cardMuts: Mutation[] = [];
  let i = 0;
  for (let round = 0; round < n; round++) {
    for (const h of hs) {
      const card = available[i++];
      if (!card) break;
      h.state.cards = [...h.state.cards, card.id];
      const c = ctx.clone(card);
      c.parent = h.id;
      cardMuts.push(put(ctx, c));
    }
  }
  const dealt = new Set(available.slice(0, i).map((c) => c.id));
  d.state.cards = d.state.cards.filter((id) => !dealt.has(id));
  return [put(ctx, d), ...hs.map((h) => put(ctx, h)), ...cardMuts];
}

/** Move a card (from table, a hand, or another deck) onto a deck. */
export function returnToDeck(
  ctx: OpCtx,
  card: CardEntity,
  deck: DeckEntity,
  where: 'top' | 'bottom' | 'shuffle',
): Mutation[] {
  const muts = pluckFromContainer(ctx, card);
  const d = ctx.clone(deck);
  const rest = containerCards(ctx.state, deck)
    .map((c) => c.id)
    .filter((id) => id !== card.id);
  d.state.cards =
    where === 'top'
      ? [card.id, ...rest]
      : where === 'bottom'
        ? [...rest, card.id]
        : shuffled([card.id, ...rest]);
  const c = ctx.clone(card);
  c.parent = deck.id;
  return [...muts, put(ctx, d), put(ctx, c)];
}

/** Play a card to the table at pos (from a hand, a deck, or elsewhere on the table). */
export function playToTable(ctx: OpCtx, card: CardEntity, pos: Pos, faceUp: boolean): Mutation[] {
  const muts = pluckFromContainer(ctx, card);
  const c = ctx.clone(card);
  c.parent = null;
  c.pos = pos;
  c.state.faceUp = faceUp;
  return [...muts, put(ctx, c)];
}

export function takeToHand(ctx: OpCtx, card: CardEntity, hand: HandEntity): Mutation[] {
  const muts = pluckFromContainer(ctx, card);
  const h = ctx.clone(hand);
  h.state.cards = [...h.state.cards.filter((id) => id !== card.id), card.id];
  const c = ctx.clone(card);
  c.parent = hand.id;
  return [...muts, put(ctx, h), put(ctx, c)];
}

export function flipCard(ctx: OpCtx, card: CardEntity): Mutation[] {
  const c = ctx.clone(card);
  c.state.faceUp = !c.state.faceUp;
  return [put(ctx, c)];
}

/** Flip the deck's top card in place (visible per the deck's facePolicy). */
export function flipTop(ctx: OpCtx, deck: DeckEntity): Mutation[] {
  const card = containerCards(ctx.state, deck)[0];
  if (!card) return [];
  return flipCard(ctx, card);
}

/** Gather every card loose on the table back into a deck (face down). */
export function gatherTableCards(ctx: OpCtx, deck: DeckEntity): Mutation[] {
  const loose = Object.values(ctx.state.entities).filter(
    (e): e is CardEntity => e.kind === 'card' && e.parent === null,
  );
  if (loose.length === 0) return [];
  const d = ctx.clone(deck);
  d.state.cards = [...loose.map((c) => c.id), ...containerCards(ctx.state, deck).map((c) => c.id)];
  const muts: Mutation[] = [];
  for (const card of loose) {
    const c = ctx.clone(card);
    c.parent = deck.id;
    c.state.faceUp = false;
    muts.push(put(ctx, c));
  }
  return [...muts, put(ctx, d)];
}

/** Delete an entity; deleting a container deletes the cards inside it. */
export function deleteEntity(ctx: OpCtx, e: Entity): Mutation[] {
  const muts: Mutation[] = [];
  if (e.kind === 'deck' || e.kind === 'hand') {
    for (const c of containerCards(ctx.state, e))
      muts.push({ t: 'del', id: c.id, version: ctx.next() });
  }
  muts.push({ t: 'del', id: e.id, version: ctx.next() });
  return muts;
}
