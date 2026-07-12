import { describe, expect, it, beforeEach } from 'vitest';
import type { CardEntity, MatEntity } from './types';
import {
  canSeeFaces,
  faceVisible,
  handIdFor,
  makeMat,
  matCards,
  matItems,
  matPresets,
  privileged,
} from './mats';
import { standardDeck } from './cards52';
import * as ops from './ops';
import { TestPeer } from './testutil';

function makeHand(peer: TestPeer, playerId: string): MatEntity {
  const hand = makeMat(peer.next(), { x: 0, y: 0, z: 0, rot: 0 }, matPresets.hand(playerId));
  peer.apply([{ t: 'put', entity: hand }]);
  return peer.state.entities[hand.id] as MatEntity;
}

describe('mat ops', () => {
  let peer: TestPeer;
  let deck: MatEntity;

  beforeEach(() => {
    peer = new TestPeer('a');
    peer.apply(standardDeck(peer, { x: 0, y: 0, z: 0, rot: 0 }));
    deck = Object.values(peer.state.entities).find((e) => e.kind === 'mat') as MatEntity;
  });

  const fresh = <T>(id: string) => peer.state.entities[id] as T;

  it('standard deck is a hidden-faces stack of 52 distinct cards', () => {
    const cards = matCards(peer.state, deck);
    expect(cards).toHaveLength(52);
    expect(new Set(cards.map((c) => c.config.front.corner)).size).toBe(52);
    expect(deck.config.placement.type).toBe('stack');
    expect(canSeeFaces(deck, 'anyone')).toBe(false);
  });

  it('shuffle permutes without changing the card set', () => {
    const before = matCards(peer.state, deck).map((c) => c.id);
    peer.apply(ops.shuffleMat(peer, deck));
    const after = matCards(peer.state, fresh<MatEntity>(deck.id)).map((c) => c.id);
    expect([...after].sort()).toEqual([...before].sort());
  });

  it('drawTo moves the top cards into the hand', () => {
    const hand = makeHand(peer, 'p1');
    const top3 = matCards(peer.state, deck).slice(0, 3).map((c) => c.id);
    peer.apply(ops.drawTo(peer, deck, hand, 3));
    expect(matItems(peer.state, fresh<MatEntity>(deck.id))).toHaveLength(49);
    expect(matItems(peer.state, fresh<MatEntity>(hand.id)).map((c) => c.id)).toEqual(top3);
    for (const id of top3) expect(peer.state.entities[id].parent).toBe(hand.id);
  });

  it('deal distributes round-robin and stops when empty', () => {
    const h1 = makeHand(peer, 'p1');
    const h2 = makeHand(peer, 'p2');
    peer.apply(ops.deal(peer, deck, [h1, h2], 5));
    expect(matItems(peer.state, fresh<MatEntity>(h1.id))).toHaveLength(5);
    expect(matItems(peer.state, fresh<MatEntity>(h2.id))).toHaveLength(5);
    peer.apply(ops.deal(peer, fresh<MatEntity>(deck.id), [fresh<MatEntity>(h1.id), fresh<MatEntity>(h2.id)], 30));
    const n1 = matItems(peer.state, fresh<MatEntity>(h1.id)).length;
    const n2 = matItems(peer.state, fresh<MatEntity>(h2.id)).length;
    expect(n1 + n2).toBe(52);
    expect(Math.abs(n1 - n2)).toBeLessThanOrEqual(1);
  });

  it('moveToMat applies the entry face rule only on entry', () => {
    const zone = makeMat(peer.next(), { x: 500, y: 0, z: 0, rot: 0 }, matPresets.zone('Z', 'down'));
    peer.apply([{ t: 'put', entity: zone }]);
    peer.apply(ops.drawToTable(peer, deck, { x: 10, y: 10, z: 1, rot: 0 }, true));
    let card = Object.values(peer.state.entities).find(
      (e): e is CardEntity => e.kind === 'card' && e.parent === null,
    )!;
    expect(card.state.faceUp).toBe(true);

    // entering the face-down mat flips it down
    peer.apply(ops.moveToMat(peer, card, zone, { pos: { x: 5, y: 5, z: 1, rot: 0 } }));
    card = fresh<CardEntity>(card.id);
    expect(card.parent).toBe(zone.id);
    expect(card.state.faceUp).toBe(false);

    // flip it up, then move WITHIN the mat: no re-flip
    peer.apply(ops.flipCard(peer, card));
    peer.apply(
      ops.moveToMat(peer, fresh<CardEntity>(card.id), fresh<MatEntity>(zone.id), {
        pos: { x: 50, y: 50, z: 2, rot: 0 },
      }),
    );
    expect(fresh<CardEntity>(card.id).state.faceUp).toBe(true);
  });

  it('grid mats snap entering items', () => {
    const grid = makeMat(peer.next(), { x: 0, y: 0, z: 0, rot: 0 }, {
      ...matPresets.zone('G'),
      placement: { type: 'grid', grid: { size: 40 } },
    });
    peer.apply([{ t: 'put', entity: grid }]);
    peer.apply(ops.drawToTable(peer, deck, { x: 10, y: 10, z: 1, rot: 0 }, false));
    const card = Object.values(peer.state.entities).find(
      (e): e is CardEntity => e.kind === 'card' && e.parent === null,
    )!;
    peer.apply(ops.moveToMat(peer, card, grid, { pos: { x: 33, y: 52, z: 1, rot: 0 } }));
    const c = fresh<CardEntity>(card.id);
    expect([c.pos.x, c.pos.y]).toEqual([40, 40]);
  });

  it('slot mats snap to the nearest slot', () => {
    const board = makeMat(peer.next(), { x: 0, y: 0, z: 0, rot: 0 }, {
      ...matPresets.zone('B'),
      placement: {
        type: 'slots',
        slots: [
          { id: 'a', x: 20, y: 20 },
          { id: 'b', x: 200, y: 20 },
        ],
      },
    });
    peer.apply([{ t: 'put', entity: board }]);
    peer.apply(ops.drawToTable(peer, deck, { x: 10, y: 10, z: 1, rot: 0 }, false));
    const card = Object.values(peer.state.entities).find(
      (e): e is CardEntity => e.kind === 'card' && e.parent === null,
    )!;
    peer.apply(ops.moveToMat(peer, card, board, { pos: { x: 150, y: 25, z: 1, rot: 0 } }));
    // snapping centers the card (w=72) on the nearest slot (x=200)
    expect(fresh<CardEntity>(card.id).pos.x).toBe(200 - 36);
  });

  it('deleting a mat deletes its contents recursively', () => {
    peer.apply(ops.deleteEntity(peer, fresh<MatEntity>(deck.id)));
    expect(Object.values(peer.state.entities).filter((e) => e.kind === 'card')).toHaveLength(0);
    expect(peer.state.entities[deck.id]).toBeUndefined();
  });

  it('concurrent draws by two peers converge with all cards accounted for', () => {
    const b = new TestPeer('b');
    b.clock = peer.clock;
    for (const e of Object.values(peer.state.entities))
      b.apply([{ t: 'put', entity: structuredClone(e) }]);

    const handA = makeHand(peer, 'pa');
    const handB = makeHand(b, 'pb');
    b.apply([{ t: 'put', entity: structuredClone(peer.state.entities[handA.id]) }]);
    peer.apply([{ t: 'put', entity: structuredClone(b.state.entities[handB.id]) }]);

    const mutsA = ops.drawTo(peer, peer.state.entities[deck.id] as MatEntity, handA, 1);
    const mutsB = ops.drawTo(b, b.state.entities[deck.id] as MatEntity, handB, 1);
    peer.apply(mutsA);
    b.apply(mutsB);
    peer.apply(mutsB);
    b.apply(mutsA);

    expect(peer.state.entities).toEqual(b.state.entities);
    const inDeck = matItems(peer.state, peer.state.entities[deck.id] as MatEntity).length;
    const inA = matItems(peer.state, peer.state.entities[handA.id] as MatEntity).length;
    const inB = matItems(peer.state, peer.state.entities[handB.id] as MatEntity).length;
    expect(inDeck + inA + inB).toBe(52);
    expect(inA + inB).toBeGreaterThanOrEqual(1);
  });
});

describe('visibility (SPEC §10–11)', () => {
  const peer = new TestPeer('a');
  peer.apply(standardDeck(peer, { x: 0, y: 0, z: 0, rot: 0 }));
  const deck = Object.values(peer.state.entities).find((e) => e.kind === 'mat') as MatEntity;
  const hand = makeMat(peer.next(), { x: 0, y: 0, z: 0, rot: 0 }, matPresets.hand('alice'));
  peer.apply([{ t: 'put', entity: hand }]);
  peer.apply(ops.drawTo(peer, deck, hand, 2));

  it('hand faces: owner sees, others do not; counts public', () => {
    const h = peer.state.entities[handIdFor('alice')] as MatEntity;
    const card = matCards(peer.state, h)[0];
    expect(faceVisible(peer.state, card, 'alice')).toBe(true);
    expect(faceVisible(peer.state, card, 'bob')).toBe(false);
  });

  it('a face-up card is public wherever it lies', () => {
    const h = peer.state.entities[handIdFor('alice')] as MatEntity;
    const card = matCards(peer.state, h)[0];
    peer.apply(ops.flipCard(peer, card));
    expect(faceVisible(peer.state, peer.state.entities[card.id] as CardEntity, 'bob')).toBe(true);
    peer.apply(ops.flipCard(peer, peer.state.entities[card.id] as CardEntity));
  });

  it('privileged: owner view of a hidden hand is privileged vs others', () => {
    const h = peer.state.entities[handIdFor('alice')] as MatEntity;
    expect(privileged(h, 'alice', ['alice', 'bob'])).toBe(true);
    expect(privileged(h, 'bob', ['alice', 'bob'])).toBe(false);
    // revealing to everyone removes the privilege
    const open = structuredClone(h);
    open.config.visibility.faces = 'public';
    expect(privileged(open, 'alice', ['alice', 'bob'])).toBe(false);
  });

  it('explicit-list visibility admits exactly the listed players', () => {
    const m = makeMat(peer.next(), { x: 0, y: 0, z: 0, rot: 0 }, {
      label: 'Secret',
      visibility: { faces: ['bob', 'carol'] },
    });
    expect(canSeeFaces(m, 'bob')).toBe(true);
    expect(canSeeFaces(m, 'alice')).toBe(false);
  });
});
