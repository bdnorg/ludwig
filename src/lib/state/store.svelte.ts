// The reactive table store: single source of truth for one table session.
// All mutations — local UI actions and remote messages — funnel through
// commit()/receive() into the pure reducers.

import type { Entity, MatEntity, PlayerInfo, Version, ViewMode } from '../model/types';
import type { Mutation, TableState } from '../model/reducers';
import {
  applyMutations,
  emptyTable,
  invertMutations,
  maxClock,
  mergeSnapshot,
} from '../model/reducers';
import type { OpCtx } from '../model/ops';
import { handIdFor, makeMat, matPresets } from '../model/mats';
import { newId } from '../model/types';
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
  /** LOCAL view preferences per mat — never synced (SPEC §11) */
  views = $state<Record<string, ViewMode>>({});
  /** LOCAL placements for positioning:'arbitrary' entities — never synced;
   *  the shared pos is just the default starting point */
  posOverrides = $state<Record<string, { x: number; y: number; z: number }>>({});
  /** current table zoom, published by the Table component for pointer math */
  uiScale = $state(1);
  /** a needsMat action is waiting for a mat letter (shows letter badges) */
  pendingSend = $state<{ actionId: string; selId: string } | null>(null);

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
    try {
      this.views = JSON.parse(localStorage.getItem(`ludwig:views:${room}`) ?? '{}');
    } catch {
      this.views = {};
    }
    try {
      this.posOverrides = JSON.parse(localStorage.getItem(`ludwig:pos:${room}`) ?? '{}');
    } catch {
      this.posOverrides = {};
    }
    this.ensureHand();
  }

  setView(matId: string, mode: ViewMode): void {
    if (mode === 'auto') delete this.views[matId];
    else this.views[matId] = mode;
    localStorage.setItem(`ludwig:views:${this.room}`, JSON.stringify(this.views));
  }

  setPosOverride(id: string, pos: { x: number; y: number; z: number } | null): void {
    if (pos) this.posOverrides[id] = pos;
    else delete this.posOverrides[id];
    localStorage.setItem(`ludwig:pos:${this.room}`, JSON.stringify(this.posOverrides));
  }

  /** Where the entity is FOR ME: local override for arbitrary items, shared
   *  pos otherwise. */
  effectivePos(e: Entity): Entity['pos'] {
    const o = e.positioning === 'arbitrary' ? this.posOverrides[e.id] : undefined;
    return o ? { ...e.pos, ...o } : e.pos;
  }

  /** Like matOrigin, but through my local placements. */
  effectiveOrigin(parentId: string | null): { x: number; y: number } {
    let x = 0;
    let y = 0;
    let cur = parentId;
    let hops = 0;
    while (cur && hops++ < 20) {
      const m = this.state.entities[cur];
      if (!m) break;
      const p = this.effectivePos(m);
      x += p.x;
      y += p.y;
      cur = m.parent;
    }
    return { x, y };
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
    for (const m of muts)
      if (m.t !== 'log') this.observe(m.t === 'put' ? m.entity.version : m.version);
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

  myHand(): MatEntity {
    this.ensureHand();
    return this.state.entities[handIdFor(this.me.id)] as MatEntity;
  }

  ensureHand(): void {
    const id = handIdFor(this.me.id);
    if (this.state.entities[id]) return;
    const hand = makeMat(this.next(), { x: 0, y: 0, z: 0, rot: 0 }, matPresets.hand(this.me.id));
    this.emit([{ t: 'put', entity: hand }]); // setup, not undoable
  }

  /** Hands of currently-connected players, in stable (player id) order —
   *  the deal order. Includes me. */
  connectedHands(): MatEntity[] {
    const ids = new Set<string>([this.me.id, ...Object.values(this.peers)]);
    return [...ids]
      .sort()
      .map((pid) => this.state.entities[handIdFor(pid)])
      .filter((e): e is MatEntity => e?.kind === 'mat');
  }

  /** Append to the shared message log (visibility changes, notices). */
  logMsg(text: string): void {
    this.emit([
      { t: 'log', id: newId('log'), entry: { at: Date.now(), actor: this.me.id, text } },
    ]);
  }

  playerName(playerId: string): string {
    return this.players[playerId]?.name || 'Player';
  }
}

export const table = new TableStore();
