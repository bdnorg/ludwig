// Gamebox loader (M18): validation, building, and the exemplar contract —
// the pure-config cards52 package must reproduce today's code-built table.
import { describe, expect, it } from 'vitest';
import cards52box from '../../../public/gameboxes/cards52/manifest.json';
import euchrebox from '../../../public/gameboxes/euchre/manifest.json';
import dominionbox from '../../../public/gameboxes/dominion/manifest.json';
import catanbox from '../../../public/gameboxes/catan/manifest.json';
import type { CardEntity, MatEntity, TokenEntity } from './types';
import { buildGamebox, rootGameboxMutation, validateGamebox } from './gamebox';
import { standardDeck } from './cards52';
import { dominionTable } from './dominion';
import { catanTable, catanMacros } from './catan';
import { cardTableMacros } from './macros';
import { makeRootMat, matItems, ROOT_MAT_ID } from './mats';
import { TestPeer } from './testutil';

const loadBox = (raw: unknown) => validateGamebox(JSON.parse(JSON.stringify(raw)));

describe('gamebox validation', () => {
  it('rejects garbage with readable messages', () => {
    expect(() => validateGamebox(null)).toThrow(/not an object/);
    expect(() => validateGamebox({ gamebox: 2, name: 'x', layout: [{}] })).toThrow(/format version/);
    expect(() => validateGamebox({ gamebox: 1, layout: [] })).toThrow(/name/);
    expect(() => validateGamebox({ gamebox: 1, name: 'x', layout: [] })).toThrow(/layout/);
    expect(() =>
      validateGamebox({ gamebox: 1, name: 'x', layout: [{ type: 'wat', at: [0, 0] }] }),
    ).toThrow(/unknown type/);
    expect(() =>
      validateGamebox({
        gamebox: 1,
        name: 'x',
        layout: [{ type: 'token', at: [0, 0], in: 'nope', config: { shape: 'disc', color: '#000', label: '', size: 20 } }],
      }),
    ).toThrow(/unknown mat label/);
  });

  it('rejects oversized piles and layouts', () => {
    expect(() =>
      validateGamebox({
        gamebox: 1,
        name: 'x',
        layout: [{ type: 'pile', at: [0, 0], token: { shape: 'disc', color: '#000', label: '', size: 20 }, count: 9999 }],
      }),
    ).toThrow(/1–500/);
  });
});

describe('gamebox building', () => {
  it('resolves asset ids and places items inside labeled mats', () => {
    const peer = new TestPeer('a');
    const { muts } = buildGamebox(peer, validateGamebox({
      gamebox: 1,
      name: 'Assets',
      assets: { felt: 'https://example.test/felt.png' },
      layout: [
        {
          type: 'mat',
          at: [10, 10],
          opts: { label: 'Board', placement: { type: 'free' }, size: { w: 200, h: 200 }, image: 'asset:felt' },
        },
        {
          type: 'token',
          at: [40, 40],
          in: 'Board',
          config: { shape: 'disc', color: '#c00', label: '', size: 20 },
        },
      ],
    }));
    peer.apply(muts);
    const board = Object.values(peer.state.entities).find(
      (e): e is MatEntity => e.kind === 'mat',
    )!;
    expect(board.config.image).toBe('https://example.test/felt.png');
    const tok = Object.values(peer.state.entities).find((e) => e.kind === 'token')!;
    expect(tok.parent).toBe(board.id);
    expect(tok.pos.x).toBe(40); // mat-relative, no origin offset
  });

  it('unknown asset ids fail loudly', () => {
    const peer = new TestPeer('a');
    expect(() =>
      buildGamebox(peer, validateGamebox({
        gamebox: 1,
        name: 'x',
        layout: [
          { type: 'mat', at: [0, 0], opts: { label: 'M', placement: { type: 'free' }, image: 'asset:missing' } },
        ],
      })),
    ).toThrow(/unknown asset/);
  });

  it('piles become implicit stack mats via tokenPile', () => {
    const peer = new TestPeer('a');
    const { muts } = buildGamebox(peer, validateGamebox({
      gamebox: 1,
      name: 'x',
      layout: [
        { type: 'pile', at: [0, 0], token: { shape: 'disc', color: '#c00', label: '', size: 20 }, count: 7 },
      ],
    }));
    peer.apply(muts);
    const pile = Object.values(peer.state.entities).find(
      (e): e is MatEntity => e.kind === 'mat' && !!e.config.implicit,
    )!;
    expect(matItems(peer.state, pile)).toHaveLength(7);
  });

  it('reference pages land on the root mat config (the read-only viewer’s source, SPEC §13)', () => {
    const peer = new TestPeer('a');
    peer.apply([{ t: 'put', entity: makeRootMat(peer.next()) }]); // table setup, as the app does
    const manifest = validateGamebox({
      gamebox: 1,
      name: 'x',
      layout: [{ type: 'note', at: [0, 0], text: 'hi' }],
      reference: [
        { title: 'Quick rules', md: '# Setup\nShuffle and deal.' },
        { title: 'Scoring', md: 'First to 10 wins.' },
      ],
    });
    const { muts, macros, reference } = buildGamebox(peer, manifest);
    peer.apply(muts);
    expect(reference).toEqual(manifest.reference);

    // nothing lands until it's stamped onto the root, same as macros
    expect((peer.state.entities[ROOT_MAT_ID] as MatEntity).config.reference).toBeUndefined();
    peer.apply(rootGameboxMutation(peer, { macros, reference }));
    const root = peer.state.entities[ROOT_MAT_ID] as MatEntity;
    expect(root.config.reference).toEqual(manifest.reference);
    expect(root.config.macros ?? []).toEqual([]); // this manifest declared none

    // an empty reference array (no root mat present) is a safe no-op
    const bare = new TestPeer('b');
    expect(rootGameboxMutation(bare, { reference: [] })).toEqual([]);
  });
});

describe('built-in packages match today’s tables', () => {
  it('cards52 box reproduces standardDeck (faces, mat config, macros)', () => {
    // code-built reference
    const ref = new TestPeer('a');
    ref.apply(standardDeck(ref, { x: 0, y: 0, z: 1, rot: 0 }));
    const refDeck = Object.values(ref.state.entities).find(
      (e): e is MatEntity => e.kind === 'mat',
    )!;
    const refFaces = matItems(ref.state, refDeck)
      .map((c) => (c as CardEntity).config.front.corner)
      .sort();

    // config-built
    const peer = new TestPeer('b');
    const box = loadBox(cards52box);
    const { muts, macros } = buildGamebox(peer, box);
    peer.apply(muts);
    const deck = Object.values(peer.state.entities).find(
      (e): e is MatEntity => e.kind === 'mat',
    )!;
    const cards = matItems(peer.state, deck) as CardEntity[];

    expect(deck.config.label).toBe('Deck');
    expect(deck.config.faceDefault).toBe(refDeck.config.faceDefault); // down
    expect(deck.config.visibility.faces).toEqual(refDeck.config.visibility.faces); // nobody
    expect(cards).toHaveLength(52);
    expect(cards.map((c) => c.config.front.corner).sort()).toEqual(refFaces);
    expect(cards.every((c) => !c.state.faceUp)).toBe(true);
    const refCard = matItems(ref.state, refDeck)[0] as CardEntity;
    expect(cards.every((c) => c.config.w === refCard.config.w && c.config.h === refCard.config.h)).toBe(true);
    // macros match the built-in card-table set
    expect(macros).toEqual(cardTableMacros('Deck'));
  });

  it('euchre box holds the 24-card deck (9–A) plus table furniture', () => {
    const peer = new TestPeer('a');
    peer.apply([{ t: 'put', entity: makeRootMat(peer.next()) }]);
    const box = loadBox(euchrebox);
    const { muts, macros, reference } = buildGamebox(peer, box);
    peer.apply(muts);
    const deck = Object.values(peer.state.entities).find(
      (e): e is MatEntity => e.kind === 'mat' && e.config.label === 'Deck',
    )!;
    const corners = (matItems(peer.state, deck) as CardEntity[]).map(
      (c) => c.config.front.corner!,
    );
    expect(corners).toHaveLength(24);
    expect(new Set(corners.map((c) => c.replace(/[♠♥♦♣]/, '')))).toEqual(
      new Set(['9', '10', 'J', 'Q', 'K', 'A']),
    );
    expect(
      Object.values(peer.state.entities).filter((e) => e.kind === 'counter'),
    ).toHaveLength(2);
    // real shipped data: euchre's manifest carries a rules-summary reference
    // page — this is the box that exercises the reference-panel feature
    expect(reference).toEqual([expect.objectContaining({ title: 'Quick rules' })]);
    peer.apply(rootGameboxMutation(peer, { macros, reference }));
    expect((peer.state.entities[ROOT_MAT_ID] as MatEntity).config.reference).toEqual(reference);
  });

  it('dominion box reproduces dominionTable (supply piles, kingdom, starters)', () => {
    // code-built reference
    const ref = new TestPeer('a');
    ref.apply(dominionTable(ref, { x: 0, y: 0, z: 1, rot: 0 }));
    const refDecks = Object.values(ref.state.entities).filter(
      (e): e is MatEntity => e.kind === 'mat' && e.config.placement.type === 'stack',
    );
    const refByLabel = Object.fromEntries(
      refDecks.map((d) => [d.config.label, matItems(ref.state, d).length]),
    );

    // config-built
    const peer = new TestPeer('b');
    const { muts, macros } = buildGamebox(peer, loadBox(dominionbox));
    peer.apply(muts);
    const decks = Object.values(peer.state.entities).filter(
      (e): e is MatEntity => e.kind === 'mat' && e.config.placement.type === 'stack',
    );
    const byLabel = Object.fromEntries(decks.map((d) => [d.config.label, matItems(peer.state, d).length]));

    expect(byLabel).toEqual(refByLabel);
    // 10 kingdom piles of 10, face up
    for (const k of ['Cellar', 'Moat', 'Merchant', 'Village', 'Workshop', 'Militia', 'Remodel', 'Smithy', 'Market', 'Mine']) {
      expect(byLabel[k], k).toBe(10);
      expect(decks.find((d) => d.config.label === k)?.config.faceDefault).toBe('up');
    }
    // 4 starter decks of 10, face down
    const starters = decks.filter((d) => d.config.label.startsWith('Starter'));
    expect(starters).toHaveLength(4);
    for (const s of starters) {
      expect(matItems(peer.state, s)).toHaveLength(10);
      expect(s.config.faceDefault).toBe('down');
    }
    // trash: an empty face-up stack mat
    const trash = decks.find((d) => d.config.label === 'Trash')!;
    expect(matItems(peer.state, trash)).toHaveLength(0);
    expect(trash.config.faceDefault).toBe('up');
    // setup note and play-area mat exist (region mats default to a grid, v4 §3)
    expect(Object.values(peer.state.entities).some((e) => e.kind === 'note')).toBe(true);
    const play = Object.values(peer.state.entities).find(
      (e) => e.kind === 'mat' && e.config.label === 'Play area',
    );
    expect(play?.kind === 'mat' && play.config.placement.type).toBe('grid');
    expect(play?.kind === 'mat' && play.config.groups).toEqual(['play']);
    // dominion carries no default macros (unchanged from today's template)
    expect(macros).toEqual([]);
  });

  it('catan box reproduces catanTable (island slots, tiles, reserves, macros)', () => {
    // code-built reference
    const ref = new TestPeer('a');
    ref.apply(catanTable(ref, { x: 0, y: 0, z: 1, rot: 0 }));
    const refBoard = Object.values(ref.state.entities).find(
      (e): e is MatEntity => e.kind === 'mat' && e.config.placement.type === 'slots',
    )!;

    // config-built
    const peer = new TestPeer('b');
    const { muts, macros } = buildGamebox(peer, loadBox(catanbox));
    peer.apply(muts);
    const all = () => Object.values(peer.state.entities);
    const board = all().find((e): e is MatEntity => e.kind === 'mat' && e.config.placement.type === 'slots')!;

    // board carries the same-shaped slot graph as the code reference (a
    // `generate` slots mat: makeMat expands it identically at build time)
    expect(board.config.placement.slots).toHaveLength(refBoard.config.placement.slots!.length);
    expect(board.config.placement.slots).toHaveLength(19 + 54 + 72);
    expect(board.config.size).toEqual(refBoard.config.size);

    const tiles = all().filter((e): e is TokenEntity => e.kind === 'token' && (e.config.tags ?? []).includes('tile'));
    expect(tiles).toHaveLength(19);
    expect(tiles.every((t) => t.parent === board.id)).toBe(true);
    const chits = all().filter((e): e is TokenEntity => e.kind === 'token' && (e.config.tags ?? []).includes('chit'));
    expect(chits).toHaveLength(18);
    const robber = all().find((e): e is TokenEntity => e.kind === 'token' && (e.config.tags ?? []).includes('robber'))!;
    expect(robber.config.label).toBe('☠');

    // per-color reserves: 5 settlements, 4 cities, 15 roads per color
    const reserves = all().filter((e): e is MatEntity => e.kind === 'mat' && e.config.label.endsWith('pieces'));
    expect(reserves).toHaveLength(4);
    for (const r of reserves) {
      const piles = matItems(peer.state, r).filter((e): e is MatEntity => e.kind === 'mat' && !!e.config.implicit);
      expect(piles.map((p) => matItems(peer.state, p).length).sort((a, b) => a - b)).toEqual([4, 5, 15]);
    }

    // 19 of each resource, 25-card development deck
    const stacks = all().filter((e): e is MatEntity => e.kind === 'mat' && e.config.placement.type === 'stack');
    for (const name of ['Wood', 'Brick', 'Wool', 'Grain', 'Ore'])
      expect(matItems(peer.state, stacks.find((s) => s.config.label === name)!)).toHaveLength(19);
    expect(matItems(peer.state, stacks.find((s) => s.config.label === 'Development')!)).toHaveLength(25);

    // dice, scoreboard, note
    const dice = all().filter((e) => e.kind === 'dice');
    expect(dice).toHaveLength(2);
    expect(Object.values(peer.state.entities).some((e) => e.kind === 'scoreboard')).toBe(true);
    expect(Object.values(peer.state.entities).some((e) => e.kind === 'note')).toBe(true);

    // "Random island" macro matches the code reference exactly
    expect(macros).toEqual(catanMacros());
  });
});
