import { describe, expect, it, beforeEach } from 'vitest';
import type { CardEntity, MatEntity } from './types';
import {
  canSeeFaces,
  canSeePositions,
  faceVisible,
  handIdFor,
  isOwnerOf,
  isPrivate,
  isStackedKind,
  makeMat,
  makeRootMat,
  matCards,
  matItems,
  matLetters,
  matPresets,
  privacyVisibility,
  privileged,
  ROOT_MAT_ID,
  sumValue,
  topStacked,
} from './mats';
import { standardDeck } from './cards52';
import * as ops from './ops';
import { TestPeer, token } from './testutil';

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

  it('reorderInMat moves an item to the requested index', () => {
    const hand = makeHand(peer, 'p1');
    peer.apply(ops.drawTo(peer, deck, hand, 4));
    const h = fresh<MatEntity>(hand.id);
    const ids = matItems(peer.state, h).map((e) => e.id);
    peer.apply(ops.reorderInMat(peer, h, peer.state.entities[ids[3]], 0));
    expect(matItems(peer.state, fresh<MatEntity>(hand.id)).map((e) => e.id)).toEqual([
      ids[3], ids[0], ids[1], ids[2],
    ]);
    // out-of-range indexes clamp
    peer.apply(ops.reorderInMat(peer, fresh<MatEntity>(hand.id), peer.state.entities[ids[3]], 99));
    expect(matItems(peer.state, fresh<MatEntity>(hand.id)).map((e) => e.id)).toEqual([
      ids[0], ids[1], ids[2], ids[3],
    ]);
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

  it('owner LISTS: every listed player passes owner rules (v4 §10)', () => {
    const m = makeMat(peer.next(), { x: 0, y: 0, z: 0, rot: 0 }, {
      label: 'Team hand',
      ownerId: 'alice',
      privacy: 'backs',
    });
    m.config.owners = ['bob'];
    expect(canSeeFaces(m, 'alice')).toBe(true);
    expect(canSeeFaces(m, 'bob')).toBe(true);
    expect(canSeeFaces(m, 'carol')).toBe(false);
    expect(isOwnerOf(m, 'bob')).toBe(true);
    expect(isPrivate(m)).toBe(true);
    // positions default to hidden on private presets
    expect(canSeePositions(m, 'carol')).toBe(false);
    expect(canSeePositions(m, 'bob')).toBe(true);
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

describe('everything is a mat (SPEC §15)', () => {
  it('privacy presets map onto the visibility spectrum', () => {
    expect(privacyVisibility('public')).toEqual({ faces: 'public', count: 'public', existence: 'public', positions: 'public' });
    expect(privacyVisibility('backs')).toEqual({ faces: 'owner', count: 'public', existence: 'public', positions: 'owner' });
    expect(privacyVisibility('count')).toEqual({ faces: 'owner', count: 'public', existence: 'public', positions: 'owner' });
    expect(privacyVisibility('nothing')).toEqual({ faces: 'owner', count: 'owner', existence: 'owner', positions: 'owner' });
  });

  it('hands are ordinary on-table private mats, placed per-viewer', () => {
    const peer = new TestPeer('a');
    const hand = makeMat(peer.next(), { x: 10, y: 10, z: 0, rot: 0 }, matPresets.hand('alice'));
    expect(hand.positioning).toBe('arbitrary');
    expect(hand.config.privacy).toBe('backs');
    expect(hand.config.visibility.faces).toBe('owner');
    expect(hand.locked).toBe(false);
    expect('docked' in hand.config).toBe(false);
  });

  it('the root mat is not a send-to target', () => {
    const peer = new TestPeer('a');
    peer.apply([{ t: 'put', entity: makeRootMat(peer.next()) }]);
    const deck = makeMat(peer.next(), { x: 0, y: 0, z: 0, rot: 0 }, matPresets.deck());
    peer.apply([{ t: 'put', entity: deck }]);
    const letters = matLetters(peer.state);
    expect(letters[ROOT_MAT_ID]).toBeUndefined();
    expect(letters[deck.id]).toBe('d');
  });

  it('named values sum over a mat, token stacks × their count (v4 §4)', () => {
    const peer = new TestPeer('a');
    const pot = makeMat(peer.next(), { x: 0, y: 0, z: 0, rot: 0 }, { label: 'Pot', showSum: 'value' });
    peer.apply([{ t: 'put', entity: pot }]);
    const chip = token('c1', 'a', 2);
    chip.parent = pot.id;
    chip.config.values = { value: 5 };
    chip.state.count = 4;
    const chip2 = token('c2', 'a', 3);
    chip2.parent = pot.id;
    chip2.config.values = { value: 25 };
    peer.apply([{ t: 'put', entity: chip }, { t: 'put', entity: chip2 }]);
    expect(sumValue(peer.state, peer.state.entities[pot.id] as MatEntity, 'value')).toBe(45);
    expect(sumValue(peer.state, peer.state.entities[pot.id] as MatEntity, 'nope')).toBe(0);
  });

  it('stackKinds: only listed kinds stack; the body-pull skips loose ones', () => {
    const peer = new TestPeer('a');
    peer.apply(standardDeck(peer, { x: 0, y: 0, z: 0, rot: 0 }));
    const deck = Object.values(peer.state.entities).find((e) => e.kind === 'mat') as MatEntity;
    peer.apply([
      {
        t: 'put',
        entity: (() => {
          const d = structuredClone(deck);
          d.config.stackKinds = ['card'];
          d.version = peer.next();
          return d;
        })(),
      },
    ]);
    const tok = token('t1', 'a', peer.clock + 1);
    peer.apply(ops.moveToMat(peer, tok, peer.state.entities[deck.id] as MatEntity, { where: 'top' }));
    const mat = peer.state.entities[deck.id] as MatEntity;
    expect(mat.state.order[0]).toBe('t1'); // physically on top of the pile…
    expect(isStackedKind(mat, peer.state.entities['t1'])).toBe(false);
    expect(topStacked(peer.state, mat)?.kind).toBe('card'); // …but the pull takes a card
  });

  it('moveToMat with snap:false skips the grid (⌥-drag, v4 §3)', () => {
    const peer = new TestPeer('a');
    peer.apply(standardDeck(peer, { x: 0, y: 0, z: 0, rot: 0 }));
    const deck = Object.values(peer.state.entities).find((e) => e.kind === 'mat') as MatEntity;
    const grid = makeMat(peer.next(), { x: 0, y: 0, z: 0, rot: 0 }, matPresets.zone('G'));
    peer.apply([{ t: 'put', entity: grid }]);
    peer.apply(ops.drawToTable(peer, deck, { x: 5, y: 5, z: 1, rot: 0 }, false));
    const card = Object.values(peer.state.entities).find(
      (e) => e.kind === 'card' && e.parent === null,
    )!;
    peer.apply(
      ops.moveToMat(peer, card, peer.state.entities[grid.id] as MatEntity, {
        pos: { x: 33, y: 52, z: 1, rot: 0 },
        snap: false,
      }),
    );
    expect([peer.state.entities[card.id].pos.x, peer.state.entities[card.id].pos.y]).toEqual([33, 52]);
  });

  it('infinite supplies clone on pull and destroy on return (v4 §6)', () => {
    const peer = new TestPeer('a');
    peer.apply(standardDeck(peer, { x: 0, y: 0, z: 0, rot: 0 }));
    const deck0 = Object.values(peer.state.entities).find((e) => e.kind === 'mat') as MatEntity;
    const supply = structuredClone(deck0);
    supply.config.supply = 'infinite';
    supply.version = peer.next();
    peer.apply([{ t: 'put', entity: supply }]);
    const deck = () => peer.state.entities[deck0.id] as MatEntity;

    // pull to the table: a clone lands, the pile is untouched
    const top = matItems(peer.state, deck())[0];
    peer.apply(ops.moveToTable(peer, top, { x: 400, y: 0, z: 9, rot: 0 }, true));
    expect(matItems(peer.state, deck())).toHaveLength(52);
    const loose = Object.values(peer.state.entities).filter(
      (e) => e.kind === 'card' && e.parent === null,
    );
    expect(loose).toHaveLength(1);
    expect(loose[0].id).not.toBe(top.id);

    // drawing mints clones too
    const hand = makeMat(peer.next(), { x: 0, y: 0, z: 0, rot: 0 }, matPresets.hand('p1'));
    peer.apply([{ t: 'put', entity: hand }]);
    peer.apply(ops.drawTo(peer, deck(), peer.state.entities[hand.id] as MatEntity, 3));
    expect(matItems(peer.state, deck())).toHaveLength(52);
    expect(matItems(peer.state, peer.state.entities[hand.id] as MatEntity)).toHaveLength(3);

    // returning destroys: the bank absorbs it
    peer.apply(ops.moveToMat(peer, peer.state.entities[loose[0].id], deck(), { where: 'top' }));
    expect(peer.state.entities[loose[0].id]).toBeUndefined();
    expect(matItems(peer.state, deck())).toHaveLength(52);
  });

  it('deal-to-slots fills empty matching slots; like items block, unlike stack (v4 §7)', () => {
    const peer = new TestPeer('a');
    const board = makeMat(peer.next(), { x: 0, y: 0, z: 0, rot: 0 }, {
      label: 'B',
      placement: {
        type: 'slots',
        slots: [
          { id: 'a', x: 50, y: 50, accepts: ['tile', 'chit'] },
          { id: 'b', x: 150, y: 50, accepts: ['tile', 'chit'] },
        ],
      },
    });
    const pile = makeMat(peer.next(), { x: 400, y: 0, z: 0, rot: 0 }, { label: 'P' });
    peer.apply([{ t: 'put', entity: board }, { t: 'put', entity: pile }]);
    const mk = (id: string, tag: string, size: number) => {
      const t = token(id, 'a', peer.clock + 1);
      t.parent = pile.id;
      t.config.tags = [tag];
      t.config.size = size;
      peer.apply([{ t: 'put', entity: t }]);
    };
    mk('t1', 'tile', 40);
    mk('t2', 'tile', 40);
    mk('t3', 'tile', 40); // one more tile than cells
    peer.apply(
      ops.dealToSlots(
        peer,
        peer.state.entities[pile.id] as MatEntity,
        peer.state.entities[board.id] as MatEntity,
      ),
    );
    const onBoard = Object.values(peer.state.entities).filter((e) => e.parent === board.id);
    expect(onBoard).toHaveLength(2); // both cells filled, once each
    expect(onBoard.every((e) => [30, 130].includes(e.pos.x))).toBe(true); // centered
    expect(matItems(peer.state, peer.state.entities[pile.id] as MatEntity)).toHaveLength(1);

    // chits still deal onto TILED cells (occupancy is per like-kind)
    mk('c1', 'chit', 20);
    mk('c2', 'chit', 20);
    peer.apply(
      ops.dealToSlots(
        peer,
        peer.state.entities[pile.id] as MatEntity,
        peer.state.entities[board.id] as MatEntity,
      ),
    );
    const chitsOn = Object.values(peer.state.entities).filter(
      (e) =>
        e.parent === board.id && e.kind === 'token' && (e.config.tags ?? []).includes('chit'),
    );
    expect(chitsOn).toHaveLength(2);
  });

  it('hex grids snap to the staggered lattice', () => {
    const peer = new TestPeer('a');
    const m = makeMat(peer.next(), { x: 0, y: 0, z: 0, rot: 0 }, {
      label: 'Hex',
      placement: { type: 'grid', grid: { size: 40, hex: true } },
    });
    // dy = 35; y=30 rounds to row 1 (offset row): x snaps to 20 + n·40
    const s = ops.snapPos(m, { x: 57, y: 30, z: 0, rot: 0 });
    expect([s.x, s.y]).toEqual([60, 35]);
    // even rows sit on the unshifted lattice
    const s2 = ops.snapPos(m, { x: 57, y: 5, z: 0, rot: 0 });
    expect([s2.x, s2.y]).toEqual([40, 0]);
  });
});
