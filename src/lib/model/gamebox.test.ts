// Gamebox loader (M18): validation, building, and the exemplar contract —
// the pure-config cards52 package must reproduce today's code-built table.
import { describe, expect, it } from 'vitest';
import cards52box from '../../../public/gameboxes/cards52/manifest.json';
import euchrebox from '../../../public/gameboxes/euchre/manifest.json';
import type { CardEntity, MatEntity } from './types';
import { buildGamebox, validateGamebox } from './gamebox';
import { standardDeck } from './cards52';
import { cardTableMacros } from './macros';
import { matItems } from './mats';
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
    const { muts } = buildGamebox(peer, loadBox(euchrebox));
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
  });
});
