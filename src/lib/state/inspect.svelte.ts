// Card inspector state (v5): purely local UI state — which card the pointer
// is over (any face rendering: table, stack top, fan, hand tray) and whether
// the inspector is pinned open. Never synced.

export const inspect = $state({
  /** card entity id the pointer is currently over (null = none) */
  hoverId: null as string | null,
  /** pinned card id — set by the `v` key; survives pointer leaving */
  pinnedId: null as string | null,
});

export function setInspectHover(id: string | null): void {
  inspect.hoverId = id;
}

/** Toggle the pin: pin the given (usually hovered) card, or unpin. */
export function toggleInspectPin(id: string | null): void {
  inspect.pinnedId = inspect.pinnedId ? null : id;
}
