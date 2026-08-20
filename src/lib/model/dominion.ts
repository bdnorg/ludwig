// Built-in template: Dominion base set, "First Game" kingdom layout.
// Card text here is concise functional rules only (mechanics are not
// copyrightable); no flavor text or art. The platform enforces none of it —
// players play the cards, exactly as at a real table (SPEC §1).

import type { NoteEntity, Pos } from './types';
import type { Mutation } from './reducers';
import type { OpCtx } from './ops';
import { makeMat, matPresets } from './mats';
import { newId } from './types';
import { buildCardSet, type CardSpec } from './cardsets';
import { CARD_W, CARD_H } from './cards52';

const ACTION = '#4a4f58';
const TREASURE = '#a5741a';
const VICTORY = '#2e7d46';
const CURSE = '#7d3fa0';

const money = (name: string, worth: string, cost: number, count: number): CardSpec => ({
  title: name,
  sub: `$${cost} · Treasure`,
  color: TREASURE,
  count,
  badges: [worth],
  values: { coin: Number(worth.replace('−', '-').replace('$', '')) },
});
const vp = (name: string, points: string, cost: number, count: number, color = VICTORY): CardSpec => ({
  title: name,
  sub: `$${cost} · Victory`,
  color,
  count,
  badges: [points],
  values: { vp: Number(points.replace('−', '-').replace(/ VP$/, '')) },
});
// badges are ALWAYS hand-authored (v5 round 3 decision) — the at-a-glance
// chips are content, never something extracted from the rules text
const action = (
  name: string,
  body: string,
  cost: number,
  badges: string[],
  type = 'Action',
): CardSpec => ({
  title: name,
  body,
  sub: `$${cost} · ${type}`,
  color: ACTION,
  count: 10,
  badges,
});

const KINGDOM: CardSpec[] = [
  action('Cellar', '+1 Action\nDiscard any number of cards, then draw that many.', 2, ['+1 Action']),
  action('Moat', '+2 Cards\nWhen another player plays an Attack, you may reveal this to be unaffected.', 2, ['+2 Cards'], 'Action–Reaction'),
  action('Merchant', '+1 Card, +1 Action\nThe first time you play a Silver this turn, +$1.', 3, ['+1 Card', '+1 Action']),
  action('Village', '+1 Card, +2 Actions', 3, ['+1 Card', '+2 Actions']),
  action('Workshop', 'Gain a card costing up to $4.', 3, ['Gain ≤ $4']),
  action('Militia', '+$2\nEach other player discards down to 3 cards in hand.', 4, ['+$2'], 'Action–Attack'),
  action('Remodel', 'Trash a card from your hand. Gain a card costing up to $2 more than it.', 4, ['Trash → +$2']),
  action('Smithy', '+3 Cards', 4, ['+3 Cards']),
  action('Market', '+1 Card, +1 Action, +1 Buy, +$1', 5, ['+1 Card', '+1 Action', '+1 Buy', '+$1']),
  action('Mine', 'Trash a Treasure from your hand. Gain a Treasure to your hand costing up to $3 more than it.', 5, ['Treasure → +$3']),
];

export function dominionTable(ctx: OpCtx, origin: Pos): Mutation[] {
  const muts: Mutation[] = [];
  const GAP_X = CARD_W + 28;
  const GAP_Y = CARD_H + 34;
  let z = origin.z;
  const at = (col: number, row: number): Pos => ({
    x: origin.x + col * GAP_X,
    y: origin.y + row * GAP_Y,
    z: z++,
    rot: 0,
  });
  const pile = (spec: CardSpec, pos: Pos, count?: number) =>
    muts.push(
      ...buildCardSet(
        ctx,
        {
          name: spec.title!, // dominion piles always carry a title
          facePolicy: 'up',
          shuffle: false,
          cards: [{ ...spec, count: count ?? spec.count ?? 1 }],
        },
        pos,
      ),
    );

  // treasure & victory columns (starters come out of copper/estate, 4 players)
  pile(money('Copper', '$1', 0, 1), at(0, 0), 60 - 28);
  pile(money('Silver', '$2', 3, 1), at(0, 1), 40);
  pile(money('Gold', '$3', 6, 1), at(0, 2), 30);
  pile(vp('Estate', '1 VP', 2, 1), at(1, 0), 12);
  pile(vp('Duchy', '3 VP', 5, 1), at(1, 1), 12);
  pile(vp('Province', '6 VP', 8, 1), at(1, 2), 12);
  pile(vp('Curse', '−1 VP', 0, 1, CURSE), at(2, 2), 30);

  // kingdom: two rows of five, cheap to expensive
  KINGDOM.forEach((spec, i) => pile(spec, at(3 + (i % 5), Math.floor(i / 5)), 10));

  // per-player SEAT KITS (v5 round 3): a Deck + Discard pair per seat,
  // auto-claimed on join (groups 'seat N'). The deck auto-reshuffles its
  // discard in when a draw comes up short; buttons cover manual timing.
  for (let p = 0; p < 4; p++) {
    const discard = makeMat(ctx.next(), at(p * 1.6 + 1.78, 4.3), {
      ...matPresets.pile(`Discard ${p + 1}`),
      groups: [`seat ${p + 1}`],
    });
    muts.push({ t: 'put', entity: discard });
    muts.push(
      ...buildCardSet(
        ctx,
        {
          name: `Deck ${p + 1}`,
          facePolicy: 'down',
          mat: {
            groups: [`seat ${p + 1}`],
            autoReshuffle: `Discard ${p + 1}`,
            buttons: [
              { label: '⟳ reshuffle', action: `reshuffle:Discard ${p + 1}` },
              { action: 'draw:5' },
            ],
          },
          cards: [money('Copper', '$1', 0, 7), vp('Estate', '1 VP', 2, 3)],
        },
        at(p * 1.6 + 1, 4.3),
      ),
    );
  }

  // trash pile (empty face-up deck) and setup note
  pile({ title: 'Trash', color: ACTION }, at(2, 0), 0);

  const zone = makeMat(ctx.next(), at(3, 2.9), {
    ...matPresets.zone('Play area'),
    size: { w: GAP_X * 5 - 28, h: CARD_H + 60 },
    groups: ['play'], // macro target: "gather from play"
    showSum: 'coin', // Σ badge totals the treasure played this turn (v5)
  });
  const note: NoteEntity = {
    id: newId('note'),
    kind: 'note',
    version: ctx.next(),
    parent: null,
    pos: at(8.2, 0),
    locked: false,
    config: { color: '#e7d980' },
    state: {
      text:
        'You are seated automatically: the Deck/Discard pair carrying your color dot is yours. Draw 5 (its button, or type 5 then d) for your opening hand.\n\nPlay cards to the play area — the Σ badge totals your treasure. Buy: ⇧-drag off a supply pile into your Discard. Your Deck auto-reshuffles your Discard back in when a draw runs short (the ⟳ chip marks the link).\n\nHover any card to read it (v pins). Game ends when Provinces (or any 3 piles) run out.',
    },
  };
  muts.push({ t: 'put', entity: zone }, { t: 'put', entity: note });
  return muts;
}
