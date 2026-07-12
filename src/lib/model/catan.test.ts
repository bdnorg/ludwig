import { describe, expect, it } from 'vitest';
import type { MatEntity, TokenEntity } from './types';
import { matItems } from './mats';
import * as ops from './ops';
import { boardGeometry, catanTable } from './catan';
import { TestPeer, token } from './testutil';

describe('board geometry', () => {
  it('has 19 hexes, 54 vertices, 72 edges', () => {
    const g = boardGeometry(500, 400);
    expect(g.hexes).toHaveLength(19);
    expect(g.vertices).toHaveLength(54);
    expect(g.edges).toHaveLength(72);
  });
});

describe('catan template', () => {
  const peer = new TestPeer('a');
  peer.apply(catanTable(peer, { x: 0, y: 0, z: 1, rot: 0 }));
  const all = () => Object.values(peer.state.entities);
  const board = all().find(
    (e): e is MatEntity => e.kind === 'mat' && e.config.placement.type === 'slots',
  )!;

  it('board carries the full slot graph', () => {
    expect(board.config.placement.slots).toHaveLength(19 + 54 + 72);
  });

  it('lays 19 locked tiles, 18 chits, and the robber on the desert', () => {
    const tiles = all().filter(
      (e): e is TokenEntity => e.kind === 'token' && (e.config.tags ?? []).includes('tile'),
    );
    expect(tiles).toHaveLength(19);
    expect(tiles.every((t) => t.locked && t.parent === board.id)).toBe(true);
    const chits = all().filter(
      (e): e is TokenEntity => e.kind === 'token' && (e.config.tags ?? []).includes('chit'),
    );
    expect(chits).toHaveLength(19); // 18 numbers + robber
    const robber = chits.find((c) => !c.locked)!;
    expect(robber.config.label).toBe('☠');
  });

  it('finite reserves: 5 settlements, 4 cities, 15 roads per color', () => {
    const reserves = all().filter(
      (e): e is MatEntity => e.kind === 'mat' && e.config.label.endsWith('pieces'),
    );
    expect(reserves).toHaveLength(4);
    for (const r of reserves) {
      const stacks = matItems(peer.state, r).filter((e): e is TokenEntity => e.kind === 'token');
      expect(stacks.map((s) => s.state.count).sort((a, b) => a - b)).toEqual([4, 5, 15]);
    }
  });

  it('19 of each resource and a 25-card dev deck', () => {
    const stacks = all().filter(
      (e): e is MatEntity => e.kind === 'mat' && e.config.placement.type === 'stack',
    );
    for (const name of ['Wood', 'Brick', 'Wool', 'Grain', 'Ore'])
      expect(matItems(peer.state, stacks.find((s) => s.config.label === name)!)).toHaveLength(19);
    expect(
      matItems(peer.state, stacks.find((s) => s.config.label === 'Development')!),
    ).toHaveLength(25);
  });

  it('a road pulled from a reserve snaps to an edge slot with rotation', () => {
    const reserve = all().find(
      (e): e is MatEntity => e.kind === 'mat' && e.config.label === 'Red pieces',
    )!;
    const roads = matItems(peer.state, reserve).find(
      (e): e is TokenEntity => e.kind === 'token' && (e.config.tags ?? []).includes('road'),
    )!;
    // drop roughly at the first edge slot, offset a bit
    const edge = board.config.placement.slots!.find((s) => s.accepts?.includes('road'))!;
    peer.apply(
      ops.takeOneTo(peer, roads, board, {
        x: edge.x - 10,
        y: edge.y - 25,
        z: 5,
        rot: 0,
      }),
    );
    const placed = Object.values(peer.state.entities).find(
      (e): e is TokenEntity =>
        e.kind === 'token' &&
        e.parent === board.id &&
        (e.config.tags ?? []).includes('road') &&
        e.state.count === 1,
    )!;
    const half = placed.config.size / 2;
    const snapped = board.config.placement.slots!.some(
      (s) =>
        s.accepts?.includes('road') &&
        Math.abs(s.x - (placed.pos.x + half)) < 0.6 &&
        Math.abs(s.y - (placed.pos.y + half)) < 0.6 &&
        (s.rot ?? 0) === placed.pos.rot,
    );
    expect(snapped).toBe(true);
    // ...and never to a vertex/hex slot: rot comes from an edge
    const rest = matItems(peer.state, peer.state.entities[reserve.id] as MatEntity).find(
      (e): e is TokenEntity => e.kind === 'token' && (e.config.tags ?? []).includes('road'),
    )!;
    expect(rest.state.count).toBe(14);
  });

  it('takeOneTo deletes the stack when the last piece is taken', () => {
    const peer2 = new TestPeer('b');
    const t = token('t1', 'b', 1);
    t.state.count = 1;
    peer2.apply([{ t: 'put', entity: t }]);
    peer2.apply(ops.takeOneTo(peer2, t, null, { x: 9, y: 9, z: 1, rot: 0 }));
    const toks = Object.values(peer2.state.entities).filter((e) => e.kind === 'token');
    expect(toks).toHaveLength(1);
    expect((toks[0] as TokenEntity).state.count).toBe(1);
    expect(peer2.state.entities['t1']).toBeUndefined();
  });

  it('transferToken moves one piece between matching stacks', () => {
    const peer2 = new TestPeer('b');
    const a = token('ta', 'b', 1);
    a.state.count = 3;
    const b = token('tb', 'b', 1);
    b.state.count = 2;
    peer2.apply([{ t: 'put', entity: a }, { t: 'put', entity: b }]);
    peer2.apply(ops.transferToken(peer2, a, b));
    expect((peer2.state.entities['ta'] as TokenEntity).state.count).toBe(2);
    expect((peer2.state.entities['tb'] as TokenEntity).state.count).toBe(3);
    // draining the source deletes it
    peer2.apply(ops.transferToken(peer2, peer2.state.entities['ta'] as TokenEntity, peer2.state.entities['tb'] as TokenEntity));
    peer2.apply(ops.transferToken(peer2, peer2.state.entities['ta'] as TokenEntity, peer2.state.entities['tb'] as TokenEntity));
    expect(peer2.state.entities['ta']).toBeUndefined();
    expect((peer2.state.entities['tb'] as TokenEntity).state.count).toBe(5);
  });
});
