import { describe, expect, it } from 'vitest';
import { compareVersions, newerThan } from './version';
import { applyMutation, applyMutations, emptyTable, mergeSnapshot, type Mutation } from './reducers';
import { TestPeer, token } from './testutil';

describe('versions', () => {
  it('orders by clock then actor', () => {
    expect(compareVersions({ clock: 1, actor: 'b' }, { clock: 2, actor: 'a' })).toBeLessThan(0);
    expect(compareVersions({ clock: 2, actor: 'a' }, { clock: 2, actor: 'b' })).toBeLessThan(0);
    expect(compareVersions({ clock: 2, actor: 'a' }, { clock: 2, actor: 'a' })).toBe(0);
  });
  it('newerThan treats missing as older', () => {
    expect(newerThan({ clock: 1, actor: 'a' }, undefined)).toBe(true);
  });
});

describe('LWW reducer', () => {
  it('applies newer, rejects older and equal', () => {
    const s = emptyTable();
    expect(applyMutation(s, { t: 'put', entity: token('t1', 'a', 2, 10) })).toBe(true);
    expect(applyMutation(s, { t: 'put', entity: token('t1', 'a', 1, 99) })).toBe(false);
    expect(applyMutation(s, { t: 'put', entity: token('t1', 'a', 2, 99) })).toBe(false);
    expect(s.entities['t1'].pos.x).toBe(10);
  });

  it('converges regardless of arrival order', () => {
    const a = token('t1', 'a', 3, 1);
    const b = token('t1', 'b', 3, 2); // same clock, actor b wins tiebreak
    const s1 = emptyTable();
    const s2 = emptyTable();
    applyMutations(s1, [{ t: 'put', entity: a }, { t: 'put', entity: b }]);
    applyMutations(s2, [{ t: 'put', entity: b }, { t: 'put', entity: a }]);
    expect(s1.entities['t1'].pos.x).toBe(2);
    expect(s2.entities['t1'].pos.x).toBe(2);
  });

  it('tombstones block resurrection by late updates', () => {
    const s = emptyTable();
    applyMutation(s, { t: 'put', entity: token('t1', 'a', 1) });
    applyMutation(s, { t: 'del', id: 't1', version: { clock: 5, actor: 'a' } });
    expect(applyMutation(s, { t: 'put', entity: token('t1', 'b', 4) })).toBe(false);
    expect(s.entities['t1']).toBeUndefined();
    // but a genuinely newer put (deliberate re-create) wins
    expect(applyMutation(s, { t: 'put', entity: token('t1', 'b', 6) })).toBe(true);
  });
});

describe('snapshot merge', () => {
  it('is idempotent and commutative', () => {
    const peerA = new TestPeer('a');
    const peerB = new TestPeer('b');
    peerA.apply([{ t: 'put', entity: token('t1', 'a', 1, 5) }]);
    peerB.apply([{ t: 'put', entity: token('t2', 'b', 1, 7) }]);
    peerB.apply([{ t: 'del', id: 't3', version: { clock: 2, actor: 'b' } }]);

    const joiner = emptyTable();
    mergeSnapshot(joiner, peerA.state);
    mergeSnapshot(joiner, peerB.state);
    mergeSnapshot(joiner, peerA.state); // repeat
    expect(Object.keys(joiner.entities).sort()).toEqual(['t1', 't2']);
    expect(joiner.tombstones['t3']).toBeDefined();

    const other = emptyTable();
    mergeSnapshot(other, peerB.state);
    mergeSnapshot(other, peerA.state);
    expect(other).toEqual(joiner);
  });
});

describe('concurrent edits across peers', () => {
  it('two peers editing the same entity converge to one winner', () => {
    const a = new TestPeer('a');
    const b = new TestPeer('b');
    const base: Mutation[] = [{ t: 'put', entity: token('t1', 'a', 1, 0) }];
    a.apply(base);
    b.apply(base);

    // concurrent: each edits locally, then they exchange
    const ea = structuredClone(a.state.entities['t1']);
    ea.pos.x = 100;
    ea.version = a.next();
    const mutsA: Mutation[] = [{ t: 'put', entity: ea }];
    a.apply(mutsA);

    const eb = structuredClone(b.state.entities['t1']);
    eb.pos.x = 200;
    eb.version = b.next();
    const mutsB: Mutation[] = [{ t: 'put', entity: eb }];
    b.apply(mutsB);

    a.apply(mutsB);
    b.apply(mutsA);
    expect(a.state.entities['t1']).toEqual(b.state.entities['t1']);
  });
});
