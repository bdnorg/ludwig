import { describe, expect, it } from 'vitest';
import type { DiceEntity, MatEntity, TokenEntity } from './types';
import * as ops from './ops';
import { matItems, sumValue } from './mats';
import { TestPeer, token } from './testutil';

function dice(peer: TestPeer, sides: number, count = 1): DiceEntity {
  const d: DiceEntity = {
    id: 'dice1',
    kind: 'dice',
    version: peer.next(),
    parent: null,
    pos: { x: 0, y: 0, z: 0, rot: 0 },
    locked: false,
    config: { sides },
    // one die per entity since v4; multi-value arrays are the pre-v4
    // compatibility path and must keep rolling every value
    state: { values: Array(count).fill(1), rolledBy: null, rolledAt: 0 },
  };
  peer.apply([{ t: 'put', entity: d }]);
  return peer.state.entities[d.id] as DiceEntity;
}

describe('dice', () => {
  it('rolls values in range and records the roller (legacy multi-value)', () => {
    const peer = new TestPeer('a');
    const d = dice(peer, 6, 4);
    for (let i = 0; i < 50; i++) {
      peer.apply(ops.rollDice(peer, peer.state.entities[d.id] as DiceEntity, 'p1'));
      const s = (peer.state.entities[d.id] as DiceEntity).state;
      expect(s.values).toHaveLength(4);
      for (const v of s.values) {
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(6);
      }
      expect(s.rolledBy).toBe('p1');
    }
  });
});

describe('implicit stacks (M17)', () => {
  const findPile = (peer: TestPeer) =>
    Object.values(peer.state.entities).find(
      (e): e is MatEntity => e.kind === 'mat' && !!e.config.implicit,
    );

  it('tokenPile builds an implicit stack mat of single pieces', () => {
    const peer = new TestPeer('a');
    peer.apply(
      ops.tokenPile(peer, null, { x: 10, y: 20, z: 1, rot: 0 }, {
        shape: 'disc',
        color: '#c00',
        label: '$5',
        size: 34,
        values: { value: 5 },
      }, 20),
    );
    const pile = findPile(peer)!;
    expect(pile.config.placement.type).toBe('stack');
    expect(pile.config.showSum).toBe('value');
    const items = matItems(peer.state, pile);
    expect(items).toHaveLength(20);
    expect(items.every((t) => t.kind === 'token' && t.state.count === 1)).toBe(true);
    expect(sumValue(peer.state, pile, 'value')).toBe(100);
  });

  it('tokenPile of 1 is a bare token, no mat wrapper', () => {
    const peer = new TestPeer('a');
    peer.apply(ops.tokenPile(peer, null, { x: 0, y: 0, z: 1, rot: 0 }, {
      shape: 'disc', color: '#c00', label: '', size: 28,
    }, 1));
    expect(findPile(peer)).toBeUndefined();
    expect(Object.values(peer.state.entities).filter((e) => e.kind === 'token')).toHaveLength(1);
  });

  it('stackOnto bundles two DIFFERENT items into an implicit stack', () => {
    const peer = new TestPeer('a');
    const a = token('ta', 'a', 1);
    const b = token('tb', 'a', 1);
    b.config.label = '$5'; // heterogeneous on purpose
    peer.apply([{ t: 'put', entity: a }, { t: 'put', entity: b }]);
    peer.apply(ops.stackOnto(peer, a, b));
    const pile = findPile(peer)!;
    const items = matItems(peer.state, pile);
    expect(items.map((i) => i.id)).toEqual(['ta', 'tb']); // dropped item on top
    expect(pile.pos.x).toBe(b.pos.x);
  });

  it('pulling the second-to-last item dissolves the pile', () => {
    const peer = new TestPeer('a');
    const a = token('ta', 'a', 1);
    const b = token('tb', 'a', 1);
    peer.apply([{ t: 'put', entity: a }, { t: 'put', entity: b }]);
    peer.apply(ops.stackOnto(peer, a, b));
    const pile = findPile(peer)!;
    peer.apply(
      ops.moveToTable(peer, peer.state.entities['ta'], { x: 200, y: 0, z: 9, rot: 0 }),
    );
    expect(peer.state.entities[pile.id]).toBeUndefined(); // mat gone
    const tb = peer.state.entities['tb'] as TokenEntity;
    expect(tb.parent).toBe(null); // survivor stepped out
    expect(tb.pos.x).toBe(pile.pos.x);
  });

  it('splitPile takes n items into a new pile; source dissolves below 2', () => {
    const peer = new TestPeer('a');
    peer.apply(ops.tokenPile(peer, null, { x: 0, y: 0, z: 1, rot: 0 }, {
      shape: 'disc', color: '#c00', label: '', size: 28,
    }, 3));
    const pile = findPile(peer)!;
    peer.apply(ops.splitPile(peer, pile, 2, { x: 100, y: 0, z: 5, rot: 0 }));
    const piles = Object.values(peer.state.entities).filter(
      (e): e is MatEntity => e.kind === 'mat' && !!e.config.implicit,
    );
    // source (1 left) dissolved; the split-off pair is the only pile
    expect(piles).toHaveLength(1);
    expect(matItems(peer.state, piles[0])).toHaveLength(2);
    const loose = Object.values(peer.state.entities).filter(
      (e) => e.kind === 'token' && e.parent === null,
    );
    expect(loose).toHaveLength(1);
  });

  it('mergeStacks pours one pile into another and removes an implicit source', () => {
    const peer = new TestPeer('a');
    const cfg = { shape: 'disc' as const, color: '#c00', label: '', size: 28 };
    peer.apply(ops.tokenPile(peer, null, { x: 0, y: 0, z: 1, rot: 0 }, cfg, 2));
    peer.apply(ops.tokenPile(peer, null, { x: 100, y: 0, z: 2, rot: 0 }, cfg, 3));
    const [a, b] = Object.values(peer.state.entities).filter(
      (e): e is MatEntity => e.kind === 'mat' && !!e.config.implicit,
    );
    peer.apply(ops.mergeStacks(peer, a, b));
    expect(peer.state.entities[a.id]).toBeUndefined();
    expect(matItems(peer.state, peer.state.entities[b.id] as MatEntity)).toHaveLength(5);
  });
});
