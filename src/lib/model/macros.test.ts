import { describe, expect, it } from 'vitest';
import type { CardEntity, MatEntity } from './types';
import { makeMat, matItems, matPresets } from './mats';
import { standardDeck } from './cards52';
import * as ops from './ops';
import { cardTableMacros, matsInGroup, runMacro } from './macros';
import { TestPeer } from './testutil';

function setup() {
  const peer = new TestPeer('a');
  peer.apply(standardDeck(peer, { x: 0, y: 0, z: 0, rot: 0 }));
  const deck = Object.values(peer.state.entities).find((e) => e.kind === 'mat') as MatEntity;
  const hands = ['p1', 'p2', 'p3'].map((pid) => {
    const h = makeMat(peer.next(), { x: 0, y: 0, z: 0, rot: 0 }, matPresets.hand(pid));
    peer.apply([{ t: 'put', entity: h }]);
    return peer.state.entities[h.id] as MatEntity;
  });
  return { peer, deck, hands };
}

const snapshot = (peer: TestPeer) => structuredClone(peer.state);

describe('macros (SPEC §15: repeatable motions are configuration)', () => {
  it('matsInGroup: built-in hands plus config groups', () => {
    const { peer, hands } = setup();
    const zone = makeMat(peer.next(), { x: 0, y: 0, z: 0, rot: 0 }, {
      ...matPresets.zone('Play area'),
      groups: ['play'],
    });
    peer.apply([{ t: 'put', entity: zone }]);
    expect(matsInGroup(peer.state, 'hands', hands)).toHaveLength(3);
    expect(matsInGroup(peer.state, 'play', hands).map((m) => m.id)).toEqual([zone.id]);
    expect(matsInGroup(peer.state, 'nope', hands)).toHaveLength(0);
  });

  it('deal-5-to-hands deals five to every connected hand', () => {
    const { peer, deck, hands } = setup();
    const [deal5] = cardTableMacros('Deck');
    peer.apply(runMacro(peer, snapshot(peer), deal5, hands));
    for (const h of hands)
      expect(matItems(peer.state, peer.state.entities[h.id] as MatEntity)).toHaveLength(5);
    expect(matItems(peer.state, peer.state.entities[deck.id] as MatEntity)).toHaveLength(52 - 15);
  });

  it('gather & shuffle brings every card home in one atomic batch', () => {
    const { peer, deck, hands } = setup();
    const zone = makeMat(peer.next(), { x: 400, y: 0, z: 0, rot: 0 }, {
      ...matPresets.zone('Play area'),
      groups: ['play'],
    });
    peer.apply([{ t: 'put', entity: zone }]);
    const [deal5, reset] = cardTableMacros('Deck');

    // scatter: deal 15, one card to the zone, one loose face up on the table
    peer.apply(runMacro(peer, snapshot(peer), deal5, hands));
    let d = peer.state.entities[deck.id] as MatEntity;
    const toZone = matItems(peer.state, d)[0];
    peer.apply(ops.moveToMat(peer, toZone, peer.state.entities[zone.id] as MatEntity, {
      pos: { x: 5, y: 5, z: 1, rot: 0 },
    }));
    d = peer.state.entities[deck.id] as MatEntity;
    peer.apply(ops.drawToTable(peer, d, { x: 900, y: 0, z: 1, rot: 0 }, true));

    const muts = runMacro(peer, snapshot(peer), reset, hands);
    peer.apply(muts);
    const deckAfter = peer.state.entities[deck.id] as MatEntity;
    expect(matItems(peer.state, deckAfter)).toHaveLength(52);
    for (const h of hands)
      expect(matItems(peer.state, peer.state.entities[h.id] as MatEntity)).toHaveLength(0);
    expect(matItems(peer.state, peer.state.entities[zone.id] as MatEntity)).toHaveLength(0);
    // gathered face down (the deck hides faces) in one atomic batch
    const cards = matItems(peer.state, deckAfter) as CardEntity[];
    expect(cards.every((c) => !c.state.faceUp)).toBe(true);
    expect(muts.length).toBeGreaterThan(0);
  });

  it('the same batch converges on a second peer', () => {
    const { peer, deck, hands } = setup();
    const b = new TestPeer('b');
    for (const e of Object.values(peer.state.entities))
      b.apply([{ t: 'put', entity: structuredClone(e) }]);
    b.clock = peer.clock;

    const [deal5] = cardTableMacros('Deck');
    const muts = runMacro(peer, snapshot(peer), deal5, hands);
    peer.apply(muts);
    b.apply(muts);
    expect(b.state.entities).toEqual(peer.state.entities);
    expect(matItems(b.state, b.state.entities[deck.id] as MatEntity)).toHaveLength(37);
  });

  it('missing sources or targets are a no-op, never a crash', () => {
    const { peer, hands } = setup();
    expect(
      runMacro(peer, snapshot(peer), {
        id: 'x',
        label: 'x',
        steps: [
          { op: 'deal', from: 'No such deck', to: 'hands', n: 5 },
          { op: 'gather', from: 'play', to: 'Nowhere' },
          { op: 'shuffle', from: 'Nothing' },
        ],
      }, hands),
    ).toHaveLength(0);
  });
});
