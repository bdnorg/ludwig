// The reactive table store: single source of truth for one table session.
// All mutations — local UI actions and remote messages — funnel through
// commit()/receive() into the pure reducers.

import type { Entity, HandEntity, PlayerInfo, Version } from '../model/types';
import type { Mutation, TableState } from '../model/reducers';
import {
  applyMutations,
  emptyTable,
  invertMutations,
  maxClock,
  mergeSnapshot,
} from '../model/reducers';
import type { OpCtx } from '../model/ops';
import { handIdFor } from '../model/containers';
import { loadPlayer } from './player';
import { loadTable, saveTable } from './persist';

export interface NetLink {
  sendMuts(muts: Mutation[]): void;
  sendDrag(id: string, x: number, y: number): void;
  sendPointer(x: number, y: number): void;
  /** re-announce profile (e.g. after a rename) */
  sendProfile(): void;
  /** push full state to everyone (e.g. after importing a table file) */
  broadcastSnapshot(): void;
  leave(): void;
}

export interface PointerState {
  x: number;
  y: number;
  playerId: string;
}

export class TableStore implements OpCtx {
  room = $state('');
  state = $state<TableState>(emptyTable());
  /** everyone ever seen at this table; presence tracked via peers */
  players = $state<Record<string, PlayerInfo>>({});
  /** trystero peerId -> playerId, for currently connected peers */
  peers = $state<Record<string, string>>({});
  /** ephemeral in-flight drag positions (remote and local), id -> pos */
  dragPos = $state<Record<string, { x: number; y: number }>>({});
  /** remote cursors, peerId -> pointer */
  pointers = $state<Record<string, PointerState>>({});

  me: PlayerInfo = $state(loadPlayer());
  net: NetLink | null = null;

  private clock = 0;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private undoStack: Mutation[][] = [];
  undoDepth = $state(0);

  init(room: string): void {
    this.me = loadPlayer(); // pick up lobby edits (name) made after module load
    this.room = room;
    this.state = loadTable(room);
    this.clock = maxClock(this.state);
    this.players = { [this.me.id]: this.me };
    this.peers = {};
    this.dragPos = {};
    this.pointers = {};
    this.undoStack = [];
    this.undoDepth = 0;
    this.ensureHand();
  }

  // ---- OpCtx ----
  next(): Version {
    return { clock: ++this.clock, actor: this.me.id };
  }
  clone<T extends Entity>(e: T): T {
    return $state.snapshot(e) as T;
  }
  observe(v: Version): void {
    this.clock = Math.max(this.clock, v.clock);
  }

  /** Apply and broadcast locally-authored mutations (one atomic batch). */
  commit(muts: Mutation[]): void {
    if (muts.length === 0) return;
    this.undoStack.push(invertMutations(this.state, muts));
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.undoDepth = this.undoStack.length;
    this.emit(muts);
  }

  /** Undo my most recent action: replay its inverse as a fresh LWW write. */
  undo(): void {
    const inverse = this.undoStack.pop();
    this.undoDepth = this.undoStack.length;
    if (!inverse) return;
    this.emit(
      inverse.map((m) =>
        m.t === 'put'
          ? { t: 'put', entity: { ...m.entity, version: this.next() } }
          : { t: 'del', id: m.id, version: this.next() },
      ),
    );
  }

  /** Apply + broadcast without touching the undo stack (undo itself, setup). */
  emit(muts: Mutation[]): void {
    if (muts.length === 0) return;
    applyMutations(this.state, muts);
    for (const m of muts) delete this.dragPos[m.t === 'put' ? m.entity.id : m.id];
    this.net?.sendMuts(muts);
    this.saveSoon();
  }

  /** Apply remotely-authored mutations. */
  receive(muts: Mutation[]): void {
    for (const m of muts) this.observe(m.t === 'put' ? m.entity.version : m.version);
    applyMutations(this.state, muts);
    for (const m of muts) delete this.dragPos[m.t === 'put' ? m.entity.id : m.id];
    this.saveSoon();
  }

  receiveSnapshot(snap: TableState): void {
    mergeSnapshot(this.state, snap);
    this.clock = Math.max(this.clock, maxClock(snap));
    this.saveSoon();
  }

  snapshot(): TableState {
    return $state.snapshot(this.state) as TableState;
  }

  profile(): PlayerInfo {
    return $state.snapshot(this.me) as PlayerInfo;
  }

  saveSoon(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => saveTable(this.room, this.snapshot()), 400);
  }

  /** Immediate save — call on pagehide so a closing tab loses nothing. */
  flush(): void {
    clearTimeout(this.saveTimer);
    if (this.room) saveTable(this.room, this.snapshot());
  }

  // ---- conveniences ----
  get(id: string): Entity | undefined {
    return this.state.entities[id];
  }

  /** Shallow-edit an entity: clone, apply fn, version-bump, commit. */
  update<T extends Entity>(e: T, fn: (draft: T) => void): void {
    const draft = this.clone(e);
    fn(draft);
    draft.version = this.next();
    this.commit([{ t: 'put', entity: draft }]);
  }

  create(e: Entity): void {
    e.version = this.next();
    this.commit([{ t: 'put', entity: e }]);
  }

  maxZ(): number {
    let z = 0;
    for (const e of Object.values(this.state.entities)) z = Math.max(z, e.pos.z);
    return z;
  }

  myHand(): HandEntity {
    this.ensureHand();
    return this.state.entities[handIdFor(this.me.id)] as HandEntity;
  }

  ensureHand(): void {
    const id = handIdFor(this.me.id);
    if (this.state.entities[id]) return;
    const hand: HandEntity = {
      id,
      kind: 'hand',
      version: this.next(),
      parent: null,
      pos: { x: 0, y: 0, z: 0, rot: 0 },
      locked: true,
      config: { ownerId: this.me.id },
      state: { cards: [], revealedTo: [] },
    };
    this.emit([{ t: 'put', entity: hand }]); // setup, not undoable
  }

  /** Hands of currently-connected players, in stable (player id) order —
   *  the deal order. Includes me. */
  connectedHands(): HandEntity[] {
    const ids = new Set<string>([this.me.id, ...Object.values(this.peers)]);
    return [...ids]
      .sort()
      .map((pid) => this.state.entities[handIdFor(pid)])
      .filter((e): e is HandEntity => e?.kind === 'hand');
  }

  playerName(playerId: string): string {
    return this.players[playerId]?.name || 'Player';
  }
}

export const table = new TableStore();
