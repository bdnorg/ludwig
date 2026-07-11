import { describe, expect, it } from 'vitest';
import type { DeckEntity } from './types';
import { emptyTable, applyMutations, invertMutations, type Mutation } from './reducers';
import { containerCards } from './containers';
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
    const deck = Object.values(peer.state.entities).find((e) => e.kind === 'deck') as DeckEntity;
    const cards = containerCards(peer.state, deck);
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
      (e): e is DeckEntity => e.kind === 'deck',
    );
    const byLabel = Object.fromEntries(
      decks.map((d) => [d.config.label, containerCards(peer.state, d).length]),
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
      expect(containerCards(peer.state, s)).toHaveLength(10);
      expect(s.config.facePolicy).toBe('down');
    }
    // kingdom/supply piles are face up
    expect(decks.find((d) => d.config.label === 'Village')?.config.facePolicy).toBe('up');
    // setup note and play-area zone exist
    expect(Object.values(peer.state.entities).some((e) => e.kind === 'note')).toBe(true);
    expect(Object.values(peer.state.entities).some((e) => e.kind === 'zone')).toBe(true);
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
      inverse.map((m) =>
        m.t === 'put'
          ? { t: 'put' as const, entity: { ...m.entity, version: { clock: ++clock, actor: 'a' } } }
          : { t: 'del' as const, id: m.id, version: { clock: ++clock, actor: 'a' } },
      ),
    );
    expect(s.entities['t2']).toBeUndefined();
    expect(s.entities['t1'].pos.x).toBe(before['t1'].pos.x);
  });
});
