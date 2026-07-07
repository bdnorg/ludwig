import type { TableState } from '../model/reducers';
import { emptyTable } from '../model/reducers';

const key = (room: string) => `ludwig:table:${room}`;

export function loadTable(room: string): TableState {
  try {
    const raw = localStorage.getItem(key(room));
    if (raw) {
      const s = JSON.parse(raw) as TableState;
      if (s && s.entities && s.tombstones) return s;
    }
  } catch {
    /* corrupt save — start fresh */
  }
  return emptyTable();
}

export function saveTable(room: string, s: TableState): void {
  try {
    localStorage.setItem(key(room), JSON.stringify(s));
  } catch {
    /* quota exceeded — autosave is best-effort */
  }
}

export function exportTable(room: string, s: TableState): void {
  const blob = new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ludwig-${room}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
