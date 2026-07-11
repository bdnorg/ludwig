// Built-in template: a standard 52-card deck (SPEC §6).

import type { CardEntity, Pos } from './types';
import type { Mutation } from './reducers';
import type { OpCtx } from './ops';
import { makeMat, matPresets } from './mats';
import { newId } from './types';
import { shuffled } from './rng';

const SUITS = [
  { sym: '♠', color: '#1b1b20' },
  { sym: '♥', color: '#c0303a' },
  { sym: '♦', color: '#c0303a' },
  { sym: '♣', color: '#1b1b20' },
] as const;
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export const CARD_W = 72;
export const CARD_H = 100;

export function standardDeck(ctx: OpCtx, pos: Pos, jokers = false): Mutation[] {
  const deckId = newId('mat');
  const muts: Mutation[] = [];
  const cardIds: string[] = [];

  const addCard = (corner: string, center: string, color: string) => {
    const card: CardEntity = {
      id: newId('card'),
      kind: 'card',
      version: ctx.next(),
      parent: deckId,
      pos: { x: 0, y: 0, z: 0, rot: 0 },
      locked: false,
      config: {
        front: { corner, center, color },
        back: {},
        w: CARD_W,
        h: CARD_H,
      },
      state: { faceUp: false },
    };
    cardIds.push(card.id);
    muts.push({ t: 'put', entity: card });
  };

  for (const suit of SUITS)
    for (const rank of RANKS) addCard(`${rank}${suit.sym}`, suit.sym, suit.color);
  if (jokers) {
    addCard('JOKER', '★', '#1b1b20');
    addCard('JOKER', '★', '#c0303a');
  }

  const deck = makeMat(ctx.next(), pos, {
    ...matPresets.deck('Deck'),
    id: deckId,
    order: shuffled(cardIds),
  });
  muts.push({ t: 'put', entity: deck });
  return muts;
}
