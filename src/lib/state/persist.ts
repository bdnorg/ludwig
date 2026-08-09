import type { TableState } from '../model/reducers';
import { emptyTable } from '../model/reducers';
import type { MatEntity } from '../model/types';

const key = (room: string) => `ludwig:table:${room}`;

/** Pre-M11 saves had hands as hidden `docked` mats pinned to chrome; they
 *  are ordinary on-table private mats now (SPEC §15). Pre-M14 dice packed
 *  `config.count` dice into one entity; one entity is one die now (v4 §4).
 *  Pre-M17 tokens packed identical pieces into `state.count`; piles are
 *  implicit stack MATS of single pieces now, so any mix can share a stack —
 *  all splits use deterministic ids so every peer migrates identically. */
export function migrate(s: TableState): TableState {
  for (const e of Object.values(s.entities)) {
    if (e.kind === 'mat') {
      const cfg = e.config as { docked?: boolean } & typeof e.config;
      if (!cfg.docked) continue;
      delete cfg.docked;
      if (cfg.ownerId) {
        e.positioning = 'arbitrary';
        e.locked = false;
        cfg.privacy ??= 'backs';
        if (e.pos.x === 0 && e.pos.y === 0) e.pos = { x: 220, y: 480, z: e.pos.z, rot: 0 };
      }
    } else if (e.kind === 'dice') {
      const cfg = e.config as { sides: number; count?: number };
      const count = cfg.count ?? Math.max(1, e.state.values.length);
      delete cfg.count;
      if (count <= 1) continue;
      const vals = e.state.values;
      for (let i = 1; i < count; i++) {
        const id = `${e.id}_d${i}`;
        if (s.entities[id]) continue;
        const twin = JSON.parse(JSON.stringify(e)) as typeof e;
        twin.id = id;
        twin.pos = { ...e.pos, x: e.pos.x + i * 46 };
        twin.state.values = [vals[i] ?? 1];
        s.entities[id] = twin;
      }
      e.state.values = [vals[0] ?? 1];
    } else if (e.kind === 'token') {
      const count = e.state.count ?? 1;
      if (count <= 1) continue;
      const matId = `${e.id}_stk`;
      if (s.entities[matId]) continue;
      const mat: MatEntity = {
        id: matId,
        kind: 'mat',
        version: { ...e.version },
        parent: e.parent,
        pos: { ...e.pos },
        locked: false,
        config: {
          label: '',
          letter: null,
          ownerId: null,
          placement: { type: 'stack' },
          faceDefault: 'keep',
          visibility: { faces: 'public', count: 'public', existence: 'public' },
          image: null,
          size: null,
          implicit: true,
          showSum: e.config.values ? 'value' : undefined,
        },
        state: { order: [e.id] },
      };
      for (let i = 1; i < count; i++) {
        const id = `${e.id}_p${i}`;
        const twin = JSON.parse(JSON.stringify(e)) as typeof e;
        twin.id = id;
        twin.parent = matId;
        twin.pos = { x: 0, y: 0, z: i, rot: 0 };
        twin.state.count = 1;
        s.entities[id] = twin;
        mat.state.order.push(id);
      }
      e.parent = matId;
      e.pos = { x: 0, y: 0, z: 0, rot: 0 };
      e.state.count = 1;
      s.entities[matId] = mat;
    }
  }
  return s;
}

export function loadTable(room: string): TableState {
  try {
    const raw = localStorage.getItem(key(room));
    if (raw) {
      const s = JSON.parse(raw) as TableState;
      if (s && s.entities && s.tombstones) {
        s.log ??= {};
        return migrate(s);
      }
    }
  } catch {
    /* corrupt save — start fresh */
  }
  return emptyTable();
}

export function saveTable(room: string, s: TableState): void {
  try {
    localStorage.setItem(key(room), JSON.stringify(s));
    const meta = loadMeta(room);
    meta.savedAt = Date.now();
    localStorage.setItem(`ludwig:meta:${room}`, JSON.stringify(meta));
  } catch {
    /* quota exceeded — autosave is best-effort */
  }
}

// ---- game instances: every saved room in this browser (SPEC §13) ----

export interface TableMeta {
  name?: string;
  savedAt?: number;
}

export function loadMeta(room: string): TableMeta {
  try {
    return JSON.parse(localStorage.getItem(`ludwig:meta:${room}`) ?? '{}') as TableMeta;
  } catch {
    return {};
  }
}

export function renameTable(room: string, name: string): void {
  const meta = loadMeta(room);
  meta.name = name;
  localStorage.setItem(`ludwig:meta:${room}`, JSON.stringify(meta));
}

export interface TableListing {
  room: string;
  name: string;
  savedAt: number;
  pieces: number;
}

export function listTables(): TableListing[] {
  const out: TableListing[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k?.startsWith('ludwig:table:')) continue;
    const room = k.slice('ludwig:table:'.length);
    const meta = loadMeta(room);
    let pieces = 0;
    try {
      pieces = Object.keys((JSON.parse(localStorage.getItem(k) ?? '{}') as TableState).entities ?? {}).length;
    } catch {
      /* corrupt entry — show it anyway so it can be deleted */
    }
    out.push({ room, name: meta.name ?? room, savedAt: meta.savedAt ?? 0, pieces });
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

export function deleteTable(room: string): void {
  for (const k of [`ludwig:table:${room}`, `ludwig:meta:${room}`, `ludwig:views:${room}`, `ludwig:pins:${room}`, `ludwig:pos:${room}`])
    localStorage.removeItem(k);
}

/** Generic browser-download-a-file helper (also used for gamebox export). */
export function download(name: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Templates are ordinary saves (SPEC §15): export the table as-is — save
 *  before dealing and you have a template. The log rides along (an export
 *  is a resumable game; use "clear log" first for a pristine start);
 *  tombstones are dead weight in a fresh room and are dropped (v4 §11). */
export function exportTable(room: string, s: TableState): void {
  download(`ludwig-${room}.json`, { ...s, tombstones: {} });
}
