import type { TableState } from '../model/reducers';
import { emptyTable } from '../model/reducers';

const key = (room: string) => `ludwig:table:${room}`;

export function loadTable(room: string): TableState {
  try {
    const raw = localStorage.getItem(key(room));
    if (raw) {
      const s = JSON.parse(raw) as TableState;
      if (s && s.entities && s.tombstones) {
        s.log ??= {};
        return s;
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
  for (const k of [`ludwig:table:${room}`, `ludwig:meta:${room}`, `ludwig:views:${room}`, `ludwig:pos:${room}`])
    localStorage.removeItem(k);
}

function download(name: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function exportTable(room: string, s: TableState): void {
  download(`ludwig-${room}.json`, s);
}

/** Export as a reusable template: hands are dropped (their owners won't
 *  exist at the next table) and any cards they held are laid out face down;
 *  tombstones are cleared and versions reset so imports merge cleanly. */
export function exportTemplate(room: string, s: TableState): void {
  const t: TableState = JSON.parse(JSON.stringify(s));
  t.tombstones = {};
  t.log = {};
  const handIds = new Set(
    Object.values(t.entities)
      .filter((e) => e.kind === 'mat' && e.config.ownerId !== null && e.config.docked)
      .map((e) => e.id),
  );
  for (const id of handIds) delete t.entities[id];
  let i = 0;
  for (const e of Object.values(t.entities)) {
    e.version = { clock: 1, actor: 'template' };
    if (e.kind === 'card' && e.parent !== null && handIds.has(e.parent)) {
      e.parent = null;
      e.state.faceUp = false;
      e.pos = { x: 40 + (i % 8) * 80, y: -140, z: i, rot: 0 };
      i++;
    }
  }
  download(`ludwig-template-${room}.json`, t);
}
