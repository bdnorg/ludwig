// Test helpers: a minimal OpCtx over a plain TableState, simulating one peer.

import type { Entity, TokenEntity, Version } from './types';
import type { TableState } from './reducers';
import { emptyTable, applyMutations, type Mutation } from './reducers';
import type { OpCtx } from './ops';

export class TestPeer implements OpCtx {
  state: TableState = emptyTable();
  clock = 0;
  constructor(public actor: string) {}

  next(): Version {
    return { clock: ++this.clock, actor: this.actor };
  }
  clone<T extends Entity>(e: T): T {
    return structuredClone(e);
  }
  observe(muts: Mutation[]): void {
    for (const m of muts) {
      if (m.t === 'log') continue;
      this.clock = Math.max(this.clock, m.t === 'put' ? m.entity.version.clock : m.version.clock);
    }
  }
  apply(muts: Mutation[]): void {
    this.observe(muts);
    applyMutations(this.state, muts);
  }
}

export function token(id: string, actor: string, clock: number, x = 0): TokenEntity {
  return {
    id,
    kind: 'token',
    version: { clock, actor },
    parent: null,
    pos: { x, y: 0, z: 0, rot: 0 },
    locked: false,
    config: { shape: 'disc', color: '#fff', label: '', size: 20 },
    state: { count: 1 },
  };
}
