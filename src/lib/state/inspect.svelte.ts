// Card inspector state (v5): purely local UI state — which card the pointer
// is over (any face rendering: table, stack top, fan, hand tray) and whether
// the inspector is pinned open. Never synced. The panel is screen chrome
// (like the tray or log), NOT a table entity — where it sits and how big it
// is are viewer preferences, persisted per browser.

const PANEL_KEY = 'ludwig:inspector';

export interface InspectorPanel {
  /** fixed-position offsets; null = the default top-right berth */
  x: number | null;
  y: number | null;
  /** panel width in px; height follows the card's aspect */
  w: number;
}

function loadPanel(): InspectorPanel {
  try {
    const raw = localStorage.getItem(PANEL_KEY);
    if (raw) return JSON.parse(raw) as InspectorPanel;
  } catch {
    /* fall through to default */
  }
  return { x: null, y: null, w: 210 };
}

export const inspect = $state({
  /** card entity id the pointer is currently over (null = none) */
  hoverId: null as string | null,
  /** pinned card id — set by the `v` key; survives pointer leaving */
  pinnedId: null as string | null,
  panel: loadPanel(),
});

export function setInspectHover(id: string | null): void {
  inspect.hoverId = id;
}

/** Toggle the pin: pin the given (usually hovered) card, or unpin. */
export function toggleInspectPin(id: string | null): void {
  inspect.pinnedId = inspect.pinnedId ? null : id;
}

export function savePanel(p: Partial<InspectorPanel>): void {
  Object.assign(inspect.panel, p);
  localStorage.setItem(PANEL_KEY, JSON.stringify(inspect.panel));
}
