import { describe, expect, it, beforeEach } from 'vitest';
import type { CardEntity, DeckEntity, HandEntity } from './types';
import { containerCards, handIdFor } from './containers';
import { standardDeck } from './cards52';
import * as ops from './ops';
import { TestPeer } from './testutil';

function makeHand(peer: TestPeer, playerId: string): HandEntity {
  const hand: HandEntity = {
    id: handIdFor(playerId),
    kind: 'hand',
    version: peer.next(),
    parent: null,
    pos: { x: 0, y: 0, z: 0, rot: 0 },
    locked: true,
    config: { ownerId: playerId },
    state: { cards: [], revealedTo: [] },
  };
  peer.apply([{ t: 'put', entity: hand }]);
  return peer.state.entities[hand.id] as HandEntity;
}

describe('deck ops', () => {
  let peer: TestPeer;
  let deck: DeckEntity;

  beforeEach(() => {
    peer = new TestPeer('a');
    peer.apply(standardDeck(peer, { x: 0, y: 0, z: 0, rot: 0 }));
    deck = Object.values(peer.state.entities).find((e) => e.kind === 'deck') as DeckEntity;
  });

  it('standard deck holds 52 distinct cards', () => {
    const cards = containerCards(peer.state, deck);
    expect(cards).toHaveLength(52);
    expect(new Set(cards.map((c) => c.config.front.corner)).size).toBe(52);
  });

  it('shuffle permutes without changing the card set', () => {
    const before = containerCards(peer.state, deck).map((c) => c.id);
    peer.apply(ops.shuffleDeck(peer, deck));
    const after = containerCards(peer.state, deck).map((c) => c.id);
    expect([...after].sort()).toEqual([...before].sort());
  });

  it('draw moves the top cards into the hand', () => {
    const hand = makeHand(peer, 'p1');
    const top3 = containerCards(peer.state, deck).slice(0, 3).map((c) => c.id);
    peer.apply(ops.drawToHand(peer, deck, hand, 3));
    const d = peer.state.entities[deck.id] as DeckEntity;
    const h = peer.state.entities[hand.id] as HandEntity;
    expect(containerCards(peer.state, d)).toHaveLength(49);
    expect(containerCards(peer.state, h).map((c) => c.id)).toEqual(top3);
    for (const id of top3) expect(peer.state.entities[id].parent).toBe(hand.id);
  });

  it('deal distributes round-robin to every hand', () => {
    const h1 = makeHand(peer, 'p1');
    const h2 = makeHand(peer, 'p2');
    const h3 = makeHand(peer, 'p3');
    peer.apply(ops.deal(peer, deck, [h1, h2, h3], 5));
    for (const h of [h1, h2, h3])
      expect(containerCards(peer.state, peer.state.entities[h.id] as HandEntity)).toHaveLength(5);
    expect(containerCards(peer.state, peer.state.entities[deck.id] as DeckEntity)).toHaveLength(37);
  });

  it('deal stops when the deck runs out', () => {
    const h1 = makeHand(peer, 'p1');
    const h2 = makeHand(peer, 'p2');
    peer.apply(ops.deal(peer, deck, [h1, h2], 30));
    const n1 = containerCards(peer.state, peer.state.entities[h1.id] as HandEntity).length;
    const n2 = containerCards(peer.state, peer.state.entities[h2.id] as HandEntity).length;
    expect(n1 + n2).toBe(52);
    expect(Math.abs(n1 - n2)).toBeLessThanOrEqual(1);
  });

  it('play from hand, then return to deck top', () => {
    const hand = makeHand(peer, 'p1');
    peer.apply(ops.drawToHand(peer, deck, hand, 1));
    const card = containerCards(peer.state, peer.state.entities[hand.id] as HandEntity)[0];

    peer.apply(ops.playToTable(peer, card, { x: 9, y: 9, z: 1, rot: 0 }, true));
    let c = peer.state.entities[card.id] as CardEntity;
    expect(c.parent).toBeNull();
    expect(c.state.faceUp).toBe(true);
    expect((peer.state.entities[hand.id] as HandEntity).state.cards).not.toContain(card.id);

    peer.apply(ops.returnToDeck(peer, c, peer.state.entities[deck.id] as DeckEntity, 'top'));
    c = peer.state.entities[card.id] as CardEntity;
    expect(c.parent).toBe(deck.id);
    expect(containerCards(peer.state, peer.state.entities[deck.id] as DeckEntity)[0].id).toBe(card.id);
  });

  it('gather pulls loose table cards back face down', () => {
    peer.apply(ops.drawToTable(peer, deck, { x: 1, y: 1, z: 1, rot: 0 }, true));
    peer.apply(ops.gatherTableCards(peer, peer.state.entities[deck.id] as DeckEntity));
    expect(containerCards(peer.state, peer.state.entities[deck.id] as DeckEntity)).toHaveLength(52);
    const anyFaceUp = Object.values(peer.state.entities).some(
      (e) => e.kind === 'card' && e.state.faceUp,
    );
    expect(anyFaceUp).toBe(false);
  });

  it('deleting a deck deletes its cards', () => {
    peer.apply(ops.deleteEntity(peer, peer.state.entities[deck.id] as DeckEntity));
    expect(Object.values(peer.state.entities).filter((e) => e.kind === 'card')).toHaveLength(0);
    expect(peer.state.entities[deck.id]).toBeUndefined();
  });

  it('concurrent draws by two peers converge with both cards accounted for', () => {
    const b = new TestPeer('b');
    b.clock = peer.clock;
    for (const e of Object.values(peer.state.entities))
      b.apply([{ t: 'put', entity: structuredClone(e) }]);

    const handA = makeHand(peer, 'pa');
    const handB = makeHand(b, 'pb');
    b.apply([{ t: 'put', entity: structuredClone(peer.state.entities[handA.id]) }]);
    peer.apply([{ t: 'put', entity: structuredClone(b.state.entities[handB.id]) }]);

    // both draw "the top card" concurrently
    const mutsA = ops.drawToHand(peer, peer.state.entities[deck.id] as DeckEntity, handA, 1);
    const mutsB = ops.drawToHand(b, b.state.entities[deck.id] as DeckEntity, handB, 1);
    peer.apply(mutsA);
    b.apply(mutsB);
    // exchange
    peer.apply(mutsB);
    b.apply(mutsA);

    expect(peer.state.entities).toEqual(b.state.entities);
    // membership authority is card.parent, so counts derived via containerCards
    // must total 52 with no card in two places
    const d = peer.state.entities[deck.id] as DeckEntity;
    const inDeck = containerCards(peer.state, d).length;
    const inA = containerCards(peer.state, peer.state.entities[handA.id] as HandEntity).length;
    const inB = containerCards(peer.state, peer.state.entities[handB.id] as HandEntity).length;
    expect(inDeck + inA + inB).toBe(52);
    expect(inA + inB).toBeGreaterThanOrEqual(1);
  });
});
