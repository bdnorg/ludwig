import { describe, expect, it } from 'vitest';
import type { DiceEntity, TokenEntity } from './types';
import * as ops from './ops';
import { TestPeer, token } from './testutil';

function dice(peer: TestPeer, sides: number, count: number): DiceEntity {
  const d: DiceEntity = {
    id: 'dice1',
    kind: 'dice',
    version: peer.next(),
    parent: null,
    pos: { x: 0, y: 0, z: 0, rot: 0 },
    locked: false,
    config: { sides, count },
    state: { values: Array(count).fill(1), rolledBy: null, rolledAt: 0 },
  };
  peer.apply([{ t: 'put', entity: d }]);
  return peer.state.entities[d.id] as DiceEntity;
}

describe('dice', () => {
  it('rolls values in range and records the roller', () => {
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

describe('token stacks', () => {
  it('merges matching stacks and deletes the source', () => {
    const peer = new TestPeer('a');
    const a = token('ta', 'a', 1);
    a.state.count = 5;
    const b = token('tb', 'a', 1);
    b.state.count = 3;
    peer.apply([{ t: 'put', entity: a }, { t: 'put', entity: b }]);
    expect(ops.tokensMatch(a, b)).toBe(true);
    peer.apply(ops.mergeTokens(peer, a, b));
    expect(peer.state.entities['ta']).toBeUndefined();
    expect((peer.state.entities['tb'] as TokenEntity).state.count).toBe(8);
  });

  it('does not match stacks with different labels', () => {
    const a = token('ta', 'a', 1);
    const b = token('tb', 'a', 1);
    b.config.label = '$5';
    expect(ops.tokensMatch(a, b)).toBe(false);
  });

  it('splits n pieces into a new stack', () => {
    const peer = new TestPeer('a');
    const a = token('ta', 'a', 1);
    a.state.count = 10;
    peer.apply([{ t: 'put', entity: a }]);
    peer.apply(ops.splitToken(peer, a, 4, { x: 50, y: 0, z: 1, rot: 0 }));
    const stacks = Object.values(peer.state.entities).filter(
      (e): e is TokenEntity => e.kind === 'token',
    );
    expect(stacks.map((s) => s.state.count).sort()).toEqual([4, 6]);
  });

  it('refuses degenerate splits', () => {
    const peer = new TestPeer('a');
    const a = token('ta', 'a', 1);
    a.state.count = 3;
    peer.apply([{ t: 'put', entity: a }]);
    expect(ops.splitToken(peer, a, 0, a.pos)).toEqual([]);
    expect(ops.splitToken(peer, a, 3, a.pos)).toEqual([]);
    expect(ops.splitToken(peer, a, 9, a.pos)).toEqual([]);
  });
});
