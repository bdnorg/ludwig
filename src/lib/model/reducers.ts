// Pure state transitions. Every change to a table — local or remote — goes
// through applyMutations, so peers that see the same set of mutations
// converge regardless of arrival order (per-entity last-writer-wins).

import type { Entity, Version } from './types';
import { newerThan } from './version';

/** One message-log entry. The log is a union-by-id CRDT set: entries are
 *  immutable once written, merge is set union, render sorts by `at`. */
export interface LogEntry {
  at: number; // epoch ms (render order; ties broken by id)
  actor: string; // player id
  text: string;
}

export interface TableState {
  entities: Record<string, Entity>;
  /** ids of deleted entities with the deleting version, so late updates
   *  can't resurrect them */
  tombstones: Record<string, Version>;
  log: Record<string, LogEntry>;
}

export function emptyTable(): TableState {
  return { entities: {}, tombstones: {}, log: {} };
}

const LOG_CAP = 300;

export type Mutation =
  | { t: 'put'; entity: Entity }
  | { t: 'del'; id: string; version: Version }
  | { t: 'log'; id: string; entry: LogEntry };

/** Applies one mutation iff its version beats what we have. Returns whether
 *  it changed anything. Mutates `s` in place (callers hold reactive state). */
export function applyMutation(s: TableState, m: Mutation): boolean {
  if (m.t === 'log') {
    if (s.log[m.id]) return false;
    s.log[m.id] = m.entry;
    trimLog(s);
    return true;
  }
  if (m.t === 'put') {
    const e = m.entity;
    if (!newerThan(e.version, s.tombstones[e.id])) return false;
    const cur = s.entities[e.id];
    if (cur && !newerThan(e.version, cur.version)) return false;
    s.entities[e.id] = e;
    return true;
  }
  // del
  if (!newerThan(m.version, s.tombstones[m.id])) return false;
  const cur = s.entities[m.id];
  if (cur && !newerThan(m.version, cur.version)) return false;
  delete s.entities[m.id];
  s.tombstones[m.id] = m.version;
  return true;
}

/** A batch is applied as a unit — multi-entity ops (draw, deal) ship as one
 *  batch so no peer observes a card in two places. */
export function applyMutations(s: TableState, muts: Mutation[]): boolean {
  let changed = false;
  for (const m of muts) changed = applyMutation(s, m) || changed;
  return changed;
}

/** Merging a snapshot is just applying every entry LWW — idempotent and
 *  commutative, so a joiner can merge snapshots from several peers. */
export function mergeSnapshot(s: TableState, snap: TableState): boolean {
  let changed = false;
  for (const e of Object.values(snap.entities))
    changed = applyMutation(s, { t: 'put', entity: e }) || changed;
  for (const [id, version] of Object.entries(snap.tombstones))
    changed = applyMutation(s, { t: 'del', id, version }) || changed;
  for (const [id, entry] of Object.entries(snap.log ?? {}))
    changed = applyMutation(s, { t: 'log', id, entry }) || changed;
  return changed;
}

function trimLog(s: TableState): void {
  const ids = Object.keys(s.log);
  if (ids.length <= LOG_CAP) return;
  ids
    .sort((a, b) => s.log[a].at - s.log[b].at || (a < b ? -1 : 1))
    .slice(0, ids.length - LOG_CAP)
    .forEach((id) => delete s.log[id]);
}

/** Mutations that would restore the state the ids in `muts` currently have —
 *  compute BEFORE applying `muts`, replay later to undo. Versions are
 *  placeholders; the caller re-stamps them with fresh clocks when undoing
 *  (undo is just another LWW write, so peers converge on it like any edit). */
export function invertMutations(s: TableState, muts: Mutation[]): Mutation[] {
  const seen = new Set<string>();
  const out: Mutation[] = [];
  for (const m of muts) {
    if (m.t === 'log') continue; // log entries are permanent, not undoable
    const id = m.t === 'put' ? m.entity.id : m.id;
    if (seen.has(id)) continue;
    seen.add(id);
    const prior = s.entities[id];
    out.push(
      prior
        ? { t: 'put', entity: JSON.parse(JSON.stringify(prior)) as Entity }
        : { t: 'del', id, version: { clock: 0, actor: '' } },
    );
  }
  return out;
}

/** Highest clock present in a state — used to seed the local Lamport clock. */
export function maxClock(s: TableState): number {
  let c = 0;
  for (const e of Object.values(s.entities)) c = Math.max(c, e.version.clock);
  for (const v of Object.values(s.tombstones)) c = Math.max(c, v.clock);
  return c;
}
