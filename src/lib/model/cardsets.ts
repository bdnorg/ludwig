// Generic card-set builder: turns a JSON spec into a deck of text cards.
// Used by the "Import card set…" feature and by built-in sets (Dominion).
// Format documented in TEMPLATES.md; an example lives in examples/.

import type { CardEntity, CardFace, Pos } from './types';
import type { Mutation } from './reducers';
import type { OpCtx } from './ops';
import { makeMat, matPresets } from './mats';
import { newId } from './types';
import { shuffled } from './rng';
import { CARD_W, CARD_H } from './cards52';

export interface CardSpec {
  title: string;
  body?: string;
  sub?: string; // bottom line, e.g. "$5 · Action"
  color?: string; // title/accent color
  image?: string; // optional art URL (used instead of text)
  count?: number; // copies in the deck (default 1)
}

export interface CardSetSpec {
  name: string; // deck label
  facePolicy?: 'down' | 'up'; // default 'down'
  shuffle?: boolean; // default true
  cards: CardSpec[];
}

export function validateCardSet(raw: unknown): CardSetSpec {
  const spec = raw as CardSetSpec;
  if (!spec || typeof spec.name !== 'string' || !Array.isArray(spec.cards) || spec.cards.length === 0)
    throw new Error('card set needs a "name" and a non-empty "cards" array');
  for (const c of spec.cards) {
    if (typeof c.title !== 'string' || c.title.length === 0)
      throw new Error('every card needs a "title"');
    if (c.count !== undefined && (!Number.isInteger(c.count) || c.count < 1 || c.count > 200))
      throw new Error(`bad count on "${c.title}" (1–200)`);
  }
  if ((spec.cards.reduce((n, c) => n + (c.count ?? 1), 0)) > 1000)
    throw new Error('card set too large (max 1000 cards)');
  return spec;
}

export function buildCardSet(ctx: OpCtx, spec: CardSetSpec, pos: Pos): Mutation[] {
  const deckId = newId('mat');
  const muts: Mutation[] = [];
  const ids: string[] = [];
  for (const c of spec.cards) {
    for (let i = 0; i < (c.count ?? 1); i++) {
      const front: CardFace = {
        title: c.title,
        body: c.body,
        sub: c.sub,
        color: c.color,
        image: c.image,
      };
      const card: CardEntity = {
        id: newId('card'),
        kind: 'card',
        version: ctx.next(),
        parent: deckId,
        pos: { x: 0, y: 0, z: 0, rot: 0 },
        locked: false,
        config: { front, back: {}, w: CARD_W, h: CARD_H },
        state: { faceUp: false },
      };
      ids.push(card.id);
      muts.push({ t: 'put', entity: card });
    }
  }
  const preset =
    (spec.facePolicy ?? 'down') === 'up' ? matPresets.pile(spec.name) : matPresets.deck(spec.name);
  const deck = makeMat(ctx.next(), pos, {
    ...preset,
    id: deckId,
    order: spec.shuffle === false ? ids : shuffled(ids),
  });
  muts.push({ t: 'put', entity: deck });
  return muts;
}
