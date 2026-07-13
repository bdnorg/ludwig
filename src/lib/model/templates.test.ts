import { describe, expect, it } from 'vitest';
import type { MatEntity } from './types';
import { emptyTable, applyMutations, invertMutations, mergeSnapshot, type Mutation } from './reducers';
import { matCards } from './mats';
import { buildCardSet, validateCardSet } from './cardsets';
import { dominionTable } from './dominion';
import { TestPeer, token } from './testutil';

describe('card set builder', () => {
  it('builds the requested copies with text faces', () => {
    const peer = new TestPeer('a');
    peer.apply(
      buildCardSet(
        peer,
        { name: 'Set', cards: [{ title: 'A', count: 3 }, { title: 'B', body: 'text', sub: '$1' }] },
        { x: 0, y: 0, z: 0, rot: 0 },
      ),
    );
    const deck = Object.values(peer.state.entities).find((e) => e.kind === 'mat') as MatEntity;
    const cards = matCards(peer.state, deck);
    expect(cards).toHaveLength(4);
    expect(cards.filter((c) => c.config.front.title === 'A')).toHaveLength(3);
    expect(cards.find((c) => c.config.front.title === 'B')?.config.front.body).toBe('text');
  });

  it('validates specs', () => {
    expect(() => validateCardSet({})).toThrow();
    expect(() => validateCardSet({ name: 'x', cards: [] })).toThrow();
    expect(() => validateCardSet({ name: 'x', cards: [{ title: '' }] })).toThrow();
    expect(() => validateCardSet({ name: 'x', cards: [{ title: 'a', count: 0 }] })).toThrow();
    expect(() => validateCardSet({ name: 'x', cards: [{ title: 'a', count: 9999 }] })).toThrow();
    expect(validateCardSet({ name: 'x', cards: [{ title: 'a', count: 10 }] }).name).toBe('x');
  });
});

describe('dominion template', () => {
  it('lays out the full first-game table', () => {
    const peer = new TestPeer('a');
    peer.apply(dominionTable(peer, { x: 0, y: 0, z: 1, rot: 0 }));
    const decks = Object.values(peer.state.entities).filter(
      (e): e is MatEntity => e.kind === 'mat' && e.config.placement.type === 'stack',
    );
    const byLabel = Object.fromEntries(
      decks.map((d) => [d.config.label, matCards(peer.state, d).length]),
    );
    // supply: 7 base piles + trash
    expect(byLabel['Copper']).toBe(32); // 60 minus 4×7 starter coppers
    expect(byLabel['Silver']).toBe(40);
    expect(byLabel['Gold']).toBe(30);
    expect(byLabel['Estate']).toBe(12);
    expect(byLabel['Duchy']).toBe(12);
    expect(byLabel['Province']).toBe(12);
    expect(byLabel['Curse']).toBe(30);
    expect(byLabel['Trash']).toBe(0);
    // 10 kingdom piles of 10
    for (const k of ['Cellar', 'Moat', 'Merchant', 'Village', 'Workshop', 'Militia', 'Remodel', 'Smithy', 'Market', 'Mine'])
      expect(byLabel[k], k).toBe(10);
    // 4 starter decks of 10, face down
    const starters = decks.filter((d) => d.config.label.startsWith('Starter'));
    expect(starters).toHaveLength(4);
    for (const s of starters) {
      expect(matCards(peer.state, s)).toHaveLength(10);
      expect(s.config.faceDefault).toBe('down');
    }
    // kingdom/supply piles are face up
    expect(decks.find((d) => d.config.label === 'Village')?.config.faceDefault).toBe('up');
    // setup note and play-area mat exist (region mats default to a grid, v4 §3)
    expect(Object.values(peer.state.entities).some((e) => e.kind === 'note')).toBe(true);
    const play = Object.values(peer.state.entities).find(
      (e) => e.kind === 'mat' && e.config.label === 'Play area',
    );
    expect(play?.kind === 'mat' && play.config.placement.type).toBe('grid');
    expect(play?.kind === 'mat' && play.config.groups).toEqual(['play']);
  });
});

describe('message log', () => {
  it('merges as a union and converges regardless of order', () => {
    const a = emptyTable();
    const b = emptyTable();
    applyMutations(a, [{ t: 'log', id: 'l1', entry: { at: 1, actor: 'a', text: 'one' } }]);
    applyMutations(b, [{ t: 'log', id: 'l2', entry: { at: 2, actor: 'b', text: 'two' } }]);
    // duplicate delivery is a no-op
    expect(applyMutations(a, [{ t: 'log', id: 'l1', entry: { at: 1, actor: 'a', text: 'one' } }])).toBe(false);
    mergeSnapshot(a, b);
    mergeSnapshot(b, a);
    expect(a.log).toEqual(b.log);
    expect(Object.keys(a.log).sort()).toEqual(['l1', 'l2']);
  });

  it('clear-log is a watermark: old entries drop and cannot resurrect (v4 §11)', () => {
    const a = emptyTable();
    const b = emptyTable();
    applyMutations(a, [{ t: 'log', id: 'l1', entry: { at: 10, actor: 'a', text: 'old' } }]);
    applyMutations(b, [{ t: 'log', id: 'l1', entry: { at: 10, actor: 'a', text: 'old' } }]);
    // a clears; a NEW entry after the watermark still lands
    applyMutations(a, [{ t: 'clear-log', at: 50, version: { clock: 9, actor: 'a' } }]);
    expect(Object.keys(a.log)).toHaveLength(0);
    applyMutations(a, [{ t: 'log', id: 'l2', entry: { at: 60, actor: 'a', text: 'new' } }]);
    expect(Object.keys(a.log)).toEqual(['l2']);
    // b still holds the old entry; merging BOTH ways converges with it gone
    mergeSnapshot(b, a);
    mergeSnapshot(a, b);
    expect(Object.keys(a.log).sort()).toEqual(['l2']);
    expect(Object.keys(b.log).sort()).toEqual(['l2']);
    // a stale clear (older version) loses LWW
    expect(
      applyMutations(a, [{ t: 'clear-log', at: 5, version: { clock: 3, actor: 'z' } }]),
    ).toBe(false);
  });
});

describe('undo (invertMutations)', () => {
  it('round-trips edits, creates, and deletes', () => {
    const s = emptyTable();
    applyMutations(s, [{ t: 'put', entity: token('t1', 'a', 1, 10) }]);
    const before = JSON.parse(JSON.stringify(s.entities));

    // a batch that edits t1, creates t2, deletes nothing
    const muts: Mutation[] = [
      { t: 'put', entity: token('t1', 'a', 5, 99) },
      { t: 'put', entity: token('t2', 'a', 6, 7) },
    ];
    const inverse = invertMutations(s, muts);
    applyMutations(s, muts);
    expect(s.entities['t1'].pos.x).toBe(99);

    // re-stamp inverse with newer versions (what the store does) and apply
    let clock = 10;
    applyMutations(
      s,
      inverse.map((m) => {
        if (m.t === 'put')
          return { t: 'put' as const, entity: { ...m.entity, version: { clock: ++clock, actor: 'a' } } };
        if (m.t !== 'del') throw new Error('unexpected inverse mutation');
        return { t: 'del' as const, id: m.id, version: { clock: ++clock, actor: 'a' } };
      }),
    );
    expect(s.entities['t2']).toBeUndefined();
    expect(s.entities['t1'].pos.x).toBe(before['t1'].pos.x);
  });
});
