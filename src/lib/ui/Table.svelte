<script lang="ts">
  import { onMount } from 'svelte';
  import type { Entity, MatEntity, Pos } from '../model/types';
  import { newId } from '../model/types';
  import * as ops from '../model/ops';
  import { standardDeck } from '../model/cards52';
  import {
    canSeeFaces,
    getMat,
    isOwnerOf,
    isPrivate,
    isStackedKind,
    makeMat,
    matItems,
    matLetters,
    matPresets,
    ROOT_MAT_ID,
    rootMat,
    topStacked,
  } from '../model/mats';
  import { buildCardSet, validateCardSet } from '../model/cardsets';
  import { dominionTable } from '../model/dominion';
  import { catanTable } from '../model/catan';
  import { table } from '../state/store.svelte';
  import { connect } from '../net/room';
  import { exportTable, loadMeta } from '../state/persist';
  import { applyPendingTemplate } from '../state/templates';
  import type { Mutation } from '../model/reducers';
  import {
    ACTIONS,
    actionsFor,
    actionForKey,
    actionForKeyMulti,
    commitAll,
    macroActions,
    matCompoundItems,
    runMatButton,
    selectionEntities,
    uiHooks,
    type UiAction,
  } from './actions';
  import QuickActions from './QuickActions.svelte';
  import ItemSettings from './ItemSettings.svelte';
  import type { MenuItem } from './menu';
  import EntityView from './EntityView.svelte';
  import MatSettings from './MatSettings.svelte';
  import HandTray from './HandTray.svelte';
  import Roster from './Roster.svelte';
  import Toolbar from './Toolbar.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import DeckSearch from './DeckSearch.svelte';
  import Cursors from './Cursors.svelte';
  import CardFaceView from './CardFaceView.svelte';
  import Palette from './Palette.svelte';
  import LogPanel from './LogPanel.svelte';

  let { room }: { room: string } = $props();

  // App keys this component by room, so `room` is fixed for our lifetime.
  // svelte-ignore state_referenced_locally
  table.init(room);
  applyPendingTemplate(table);

  onMount(() => {
    const link = connect(table, room);
    document.title = `ludwig – ${loadMeta(room).name ?? room}`;
    return () => {
      document.title = 'ludwig';
      link.leave();
      table.net = null;
    };
  });

  // ---- viewport pan/zoom ----
  let viewportEl: HTMLDivElement;
  let view = $state({ x: 0, y: 0, scale: 1 });
  $effect(() => {
    table.uiScale = view.scale;
  });

  function screenToTable(cx: number, cy: number): { x: number; y: number } {
    const r = viewportEl.getBoundingClientRect();
    return { x: (cx - r.left - view.x) / view.scale, y: (cy - r.top - view.y) / view.scale };
  }
  function tableToScreen(tx: number, ty: number): { x: number; y: number } {
    const r = viewportEl.getBoundingClientRect();
    return { x: tx * view.scale + view.x + r.left, y: ty * view.scale + view.y + r.top };
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const pt = screenToTable(e.clientX, e.clientY);
    const scale = Math.min(3, Math.max(0.3, view.scale * Math.exp(-e.deltaY * 0.0012)));
    const r = viewportEl.getBoundingClientRect();
    view = {
      scale,
      x: e.clientX - r.left - pt.x * scale,
      y: e.clientY - r.top - pt.y * scale,
    };
  }

  // plain drag on the felt rubber-band selects; ⇧-drag or middle-drag pans
  // (PROPOSAL v4 §1 — mats move only by their handles, so the plain gesture
  // is free for selection)
  let pan: { sx: number; sy: number; vx: number; vy: number } | null = null;
  let band = $state<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  function onBackgroundDown(e: PointerEvent) {
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      pan = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
      window.addEventListener('pointermove', onPanMove);
      window.addEventListener('pointerup', onPanUp);
      return;
    }
    if (e.button !== 0) return;
    band = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY };
    window.addEventListener('pointermove', onBandMove);
    window.addEventListener('pointerup', onBandUp);
  }
  function onPanMove(e: PointerEvent) {
    if (!pan) return;
    view.x = pan.vx + (e.clientX - pan.sx);
    view.y = pan.vy + (e.clientY - pan.sy);
  }
  function onPanUp() {
    pan = null;
    window.removeEventListener('pointermove', onPanMove);
    window.removeEventListener('pointerup', onPanUp);
  }
  function onBandMove(e: PointerEvent) {
    if (!band) return;
    band.x1 = e.clientX;
    band.y1 = e.clientY;
  }
  function onBandUp() {
    window.removeEventListener('pointermove', onBandMove);
    window.removeEventListener('pointerup', onBandUp);
    const b = band;
    band = null;
    if (!b) return;
    const rect = {
      left: Math.min(b.x0, b.x1),
      right: Math.max(b.x0, b.x1),
      top: Math.min(b.y0, b.y1),
      bottom: Math.max(b.y0, b.y1),
    };
    // a tiny band is a felt click: clear the selection
    if (rect.right - rect.left < 5 && rect.bottom - rect.top < 5) {
      table.select([]);
      return;
    }
    table.select(selectableIdsInRect(rect));
  }

  /** Entities whose on-screen center is inside the rect (or all rendered
   *  ones, if no rect) — skipping locked scenery, region mats (they have
   *  handles), and the root. */
  function selectableIdsInRect(r?: {
    left: number;
    right: number;
    top: number;
    bottom: number;
  }): string[] {
    const out: string[] = [];
    for (const el of viewportEl.querySelectorAll<HTMLElement>('[data-entity-id]')) {
      const id = el.dataset.entityId!;
      const ent = table.get(id);
      if (!ent || ent.locked) continue;
      if (ent.kind === 'mat' && ['free', 'grid', 'slots'].includes(ent.config.placement.type))
        continue;
      if (r) {
        const bb = el.getBoundingClientRect();
        const cx = bb.x + bb.width / 2;
        const cy = bb.y + bb.height / 2;
        if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) continue;
      }
      out.push(id);
    }
    return out;
  }

  // ---- entities at the root. The root mat itself renders as the felt; mats
  // I pinned render in my tray instead (a local view preference, SPEC §15)
  const tableEntities = $derived(
    Object.values(table.state.entities)
      .filter(
        (e) => e.parent === null && e.id !== ROOT_MAT_ID && !(e.kind === 'mat' && table.isPinned(e.id)),
      )
      .sort((a, b) => a.pos.z - b.pos.z),
  );

  // the felt IS the root mat: color and grid come from its config
  const root = $derived(rootMat(table.state));
  const rootGrid = $derived(
    root?.config.placement.type === 'grid' ? (root.config.placement.grid ?? null) : null,
  );

  // ---- selection & hover (feeds hover buttons, palette, keys) ----
  let hoveredId = $state<string | null>(null);
  let lastClickedId = $state<string | null>(null);
  let lastMouse = { x: 0, y: 0 };

  // leaving an entity clears hover after a grace period, so the pointer can
  // travel to the hover buttons (which cancel the timer) without losing them
  let hoverClearTimer: ReturnType<typeof setTimeout> | undefined;
  function setHover(id: string | null) {
    clearTimeout(hoverClearTimer);
    if (id) hoveredId = id;
    else hoverClearTimer = setTimeout(() => (hoveredId = null), 250);
  }

  /** What the user means right now: hovered entity, else whatever is under
   *  the cursor (hover state can go stale — enter/leave don't re-fire while
   *  the mouse is still), else the last thing clicked. */
  function selectionNow(): Entity | null {
    if (hoveredId) return table.get(hoveredId) ?? null;
    for (const el of document.elementsFromPoint(lastMouse.x, lastMouse.y)) {
      const id = (el as HTMLElement).dataset?.entityId;
      if (id) return table.get(id) ?? null;
    }
    return lastClickedId ? (table.get(lastClickedId) ?? null) : null;
  }

  // ---- drag: entities (in whatever mat frame they live). `extras` carries
  // the rest of the selection for rigid multi-moves ----
  interface DragPart {
    id: string;
    dx: number;
    dy: number;
    fx: number;
    fy: number;
  }
  let drag: (DragPart & { moved: boolean; extras: DragPart[] }) | null = null;

  /** Entry rules of the root mat: the felt is a mat like any other. */
  function rootEntryFace(natural: boolean): boolean {
    const fd = root?.config.faceDefault ?? 'keep';
    return fd === 'keep' ? natural : fd === 'up';
  }
  function rootSnap(pos: Pos, item?: Entity): Pos {
    return root ? ops.snapPos(root, pos, item) : pos;
  }

  function isDescendant(id: string, ancestorId: string): boolean {
    let cur: string | null = id;
    let hops = 0;
    while (cur && hops++ < 20) {
      if (cur === ancestorId) return true;
      cur = table.get(cur)?.parent ?? null;
    }
    return false;
  }

  const isRegionMatEnt = (ent: Entity) =>
    ent.kind === 'mat' && ['free', 'grid', 'slots'].includes(ent.config.placement.type);

  /** Start a plain positional drag of `ent` (and, for multi, the rest of the
   *  selection, each in its own frame). */
  function beginEntityDrag(e: PointerEvent, ent: Entity, multi = false) {
    const p = screenToTable(e.clientX, e.clientY);
    const mk = (it: Entity): DragPart => {
      const frame = table.effectiveOrigin(it.parent);
      const shown = table.effectivePos(it);
      return {
        id: it.id,
        dx: p.x - frame.x - shown.x,
        dy: p.y - frame.y - shown.y,
        fx: frame.x,
        fy: frame.y,
      };
    };
    const extras = multi
      ? selectionEntities()
          .filter((it) => it.id !== ent.id && !it.locked)
          .map(mk)
      : [];
    drag = { ...mk(ent), moved: false, extras };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragUp);
  }

  function onGrab(e: PointerEvent | MouseEvent, ent: Entity) {
    if (!(e instanceof PointerEvent) || e.button !== 0) return;
    lastClickedId = ent.id;
    // resolve a pending send-to by clicking the target mat
    if (table.pendingSend && ent.kind === 'mat') {
      e.stopPropagation();
      resolveSend(ent);
      return;
    }
    // ⌘/Ctrl-click toggles selection membership (PROPOSAL v4 §1)
    if ((e.metaKey || e.ctrlKey) && !ent.locked && !isRegionMatEnt(ent)) {
      e.stopPropagation();
      table.toggleSelect(ent.id);
      return;
    }
    // region mats and locked scenery let the gesture bubble: a drag starting
    // on them rubber-bands (mats move only by their handles)
    if (isRegionMatEnt(ent) || ent.locked) return;
    e.stopPropagation();
    // dragging any member of a multi-selection moves the whole selection
    if (table.selected.length > 1 && table.isSelected(ent.id)) {
      beginEntityDrag(e, ent, true);
      return;
    }
    table.select([ent.id]); // plain click replaces the selection
    // the body of a pile always takes the top STACKED item; handles move it
    if (ent.kind === 'mat' && ent.config.placement.type === 'stack') {
      const top = topStacked(table.state, ent);
      if (top) startGhostDrag(e, top.id, ent.id);
      return;
    }
    if (ent.kind === 'token' && (ent.state.count ?? 1) > 1) {
      startGhostDrag(e, ent.id, ent.parent, 'one');
      return;
    }
    // fan/collapsed mats have no body-drag either (their cards ghost-drag
    // via the fan slots; the mat itself moves by handles)
    if (ent.kind === 'mat') return;
    beginEntityDrag(e, ent);
  }

  /** Handle drag: always moves the entity itself, never its contents. */
  function onMatMove(e: PointerEvent, ent: Entity) {
    if (e.button !== 0 || ent.locked) return;
    e.stopPropagation();
    lastClickedId = ent.id;
    beginEntityDrag(e, ent);
  }

  function onDragMove(e: PointerEvent) {
    if (!drag) return;
    const p = screenToTable(e.clientX, e.clientY);
    drag.moved = true;
    for (const part of [drag, ...drag.extras]) {
      const x = p.x - part.fx - part.dx;
      const y = p.y - part.fy - part.dy;
      table.dragPos[part.id] = { x, y };
      // arbitrary items move only in MY view — never stream their drags
      const ent = table.get(part.id);
      if (ent?.positioning !== 'arbitrary') table.net?.sendDrag(part.id, x, y);
    }
  }
  function onDragUp(e: PointerEvent) {
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragUp);
    const d = drag;
    drag = null;
    if (!d) return;
    const ent = table.get(d.id);
    if (!ent) return;
    if (!d.moved) {
      for (const part of [d, ...d.extras]) delete table.dragPos[part.id];
      return;
    }
    // multi-move: rigid translation of the whole selection in one atomic
    // batch (no re-parenting, no snapping — gather actions do that job)
    if (d.extras.length > 0) {
      const muts: Mutation[] = [];
      for (const part of [d, ...d.extras]) {
        const it = table.get(part.id);
        const cur = table.dragPos[part.id];
        if (!it || !cur) continue;
        if (it.positioning === 'arbitrary') {
          delete table.dragPos[part.id];
          table.setPosOverride(part.id, { x: cur.x, y: cur.y, z: it.pos.z });
        } else {
          const c = table.clone(it);
          c.pos = { ...c.pos, x: cur.x, y: cur.y };
          c.version = table.next();
          muts.push({ t: 'put', entity: c });
        }
      }
      table.commit(muts);
      return;
    }
    const p = screenToTable(e.clientX, e.clientY);
    const isRegionMat =
      ent.kind === 'mat' && ['free', 'grid', 'slots'].includes(ent.config.placement.type);

    // token-stack merge
    if (ent.kind === 'token') {
      const dst = matchingTokenAt(e.clientX, e.clientY, ent);
      if (dst?.kind === 'token') {
        table.commit(ops.mergeTokens(table, ent, dst));
        return;
      }
    }

    const target = dropTargetAt(e.clientX, e.clientY, ent.id);
    if (target?.type === 'tray' && ent.kind === 'card') {
      dropInTray(ent, e.clientX, e.clientY);
      return;
    }
    if (target?.type === 'mat' && !isDescendant(target.id, ent.id)) {
      const mat = getMat(table.state, target.id);
      if (mat) {
        const stackish = ['stack', 'fan'].includes(mat.config.placement.type);
        // only stackKinds pile onto a stack; other kinds land loose on it
        if (stackish && isStackedKind(mat, ent) && (ent.kind === 'card' || ent.kind === 'token')) {
          table.setPosOverride(ent.id, null);
          table.commit(ops.moveToMat(table, ent, mat, { where: 'top' }));
          return;
        }
        if (!isRegionMat) {
          const o = table.effectiveOrigin(mat.id);
          const pos: Pos = {
            x: p.x - o.x - d.dx,
            y: p.y - o.y - d.dy,
            z: table.maxZ() + 1,
            rot: ent.pos.rot,
          };
          table.setPosOverride(ent.id, null);
          table.commit(ops.moveToMat(table, ent, mat, { pos, snap: !e.altKey }));
          return;
        }
      }
    }
    // root table (or repositioning within current frame if unchanged parent = root)
    const rawPos: Pos = {
      x: p.x - d.dx,
      y: p.y - d.dy,
      z: isRegionMat ? ent.pos.z : table.maxZ() + 1,
      rot: ent.pos.rot,
    };
    const pos: Pos = e.altKey ? rawPos : rootSnap(rawPos, ent); // ⌥ skips the grid
    if (ent.parent === null) {
      if (ent.positioning === 'arbitrary') {
        // my view only: store the placement locally, never sync (SPEC §10)
        delete table.dragPos[ent.id];
        table.setPosOverride(ent.id, { x: pos.x, y: pos.y, z: pos.z });
      } else {
        table.update(ent, (draft) => {
          draft.pos = pos;
        });
      }
    } else {
      const parentMat = getMat(table.state, ent.parent);
      const stillInside =
        parentMat &&
        target?.type === 'mat' &&
        target.id === ent.parent &&
        !['stack', 'fan'].includes(parentMat.config.placement.type);
      if (stillInside) {
        // moving within the same region mat: reposition + snap (⌥ skips it),
        // no entry rule
        const local: Pos = { x: p.x - d.fx - d.dx, y: p.y - d.fy - d.dy, z: pos.z, rot: pos.rot };
        const snapped = e.altKey ? local : ops.snapPos(parentMat, local, ent);
        if (ent.positioning === 'arbitrary') {
          delete table.dragPos[ent.id];
          table.setPosOverride(ent.id, { x: snapped.x, y: snapped.y, z: snapped.z });
        } else {
          table.update(ent, (draft) => {
            draft.pos = snapped;
          });
        }
      } else {
        table.setPosOverride(ent.id, null); // containment changes are shared
        table.commit(
          ops.moveToTable(
            table,
            ent,
            pos,
            ent.kind === 'card' ? rootEntryFace(ent.state.faceUp) : undefined,
          ),
        );
      }
    }
  }

  /** Which pinned mat a tray drop lands in (default: my hand). */
  function trayMatAt(cx: number, cy: number): MatEntity {
    for (const el of document.elementsFromPoint(cx, cy)) {
      const id = (el as HTMLElement).dataset?.trayMat;
      const m = id ? getMat(table.state, id) : undefined;
      if (m) return m;
    }
    return table.myHand();
  }

  /** Where in a tray fan a drop at screen-x lands: count the other cards
   *  whose center is left of the pointer. */
  function trayInsertIndex(matId: string, cx: number, excludeId: string): number {
    let idx = 0;
    for (const el of document.querySelectorAll<HTMLElement>(
      `.tray [data-tray-mat="${matId}"] .slot`,
    )) {
      if (el.dataset.cardId === excludeId) continue;
      const r = el.getBoundingClientRect();
      if (cx > r.left + r.width / 2) idx++;
    }
    return idx;
  }

  /** Drop a card into the tray: reorder if it's already in that mat, else
   *  move it in at the pointed-at index. */
  function dropInTray(item: Entity, cx: number, cy: number) {
    const mat = trayMatAt(cx, cy);
    const idx = trayInsertIndex(mat.id, cx, item.id);
    if (item.parent === mat.id) table.commit(ops.reorderInMat(table, mat, item, idx));
    else
      table.commit([
        ...ops.moveToMat(table, item, mat),
        ...ops.reorderInMat(table, mat, item, idx),
      ]);
  }

  type DropTarget = { type: 'mat' | 'token'; id: string } | { type: 'tray' };

  /** All drop candidates under the point, topmost first — callers pick the
   *  first that applies (e.g. a road ignores the hex tile it lands on and
   *  falls through to the board mat beneath). */
  function dropTargetsAt(cx: number, cy: number, excludeId: string): DropTarget[] {
    const out: DropTarget[] = [];
    for (const el of document.elementsFromPoint(cx, cy)) {
      const html = el as HTMLElement;
      if (html.dataset?.entityId === excludeId) continue;
      const dd = html.dataset?.drop;
      if (!dd) continue;
      if (dd === 'tray') {
        out.push({ type: 'tray' });
        continue;
      }
      const [t, id] = dd.split(':');
      if ((t === 'mat' || t === 'token') && id !== excludeId && !isDescendant(id, excludeId))
        out.push({ type: t as 'mat' | 'token', id });
    }
    return out;
  }

  /** First target that isn't a token (tokens only matter for merging). */
  function dropTargetAt(cx: number, cy: number, excludeId: string): DropTarget | null {
    return dropTargetsAt(cx, cy, excludeId).find((t) => t.type !== 'token') ?? null;
  }

  /** First token under the point that merges with `tok`. */
  function matchingTokenAt(cx: number, cy: number, tok: Entity & { kind: 'token' }): Entity | null {
    for (const t of dropTargetsAt(cx, cy, tok.id)) {
      if (t.type !== 'token') continue;
      const dst = table.get(t.id);
      if (dst?.kind === 'token' && ops.tokensMatch(tok, dst)) return dst;
    }
    return null;
  }

  // ---- ghost drag: a card out of a fan/tray/stack top, or ONE token off a
  // stack (mode 'one') ----
  let ghost = $state<{
    id: string;
    srcMat: string | null;
    mode: 'item' | 'one';
    sx: number;
    sy: number;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);

  function startGhostDrag(
    e: PointerEvent,
    itemId: string,
    srcMatId: string | null,
    mode: 'item' | 'one' = 'item',
  ) {
    if (e.button !== 0) return;
    e.stopPropagation();
    lastClickedId = itemId;
    ghost = {
      id: itemId,
      srcMat: srcMatId,
      mode,
      sx: e.clientX,
      sy: e.clientY,
      x: e.clientX,
      y: e.clientY,
      moved: false,
    };
    window.addEventListener('pointermove', onGhostMove);
    window.addEventListener('pointerup', onGhostUp);
  }
  function onGhostMove(e: PointerEvent) {
    if (!ghost) return;
    ghost.x = e.clientX;
    ghost.y = e.clientY;
    if (Math.hypot(e.clientX - ghost.sx, e.clientY - ghost.sy) > 5) ghost.moved = true;
  }
  function onGhostUp(e: PointerEvent) {
    window.removeEventListener('pointermove', onGhostMove);
    window.removeEventListener('pointerup', onGhostUp);
    const g = ghost;
    ghost = null;
    if (!g || !g.moved) return;
    const item = table.get(g.id);
    if (!item) return;

    // mode 'one': take a single piece off a token stack
    if (g.mode === 'one' && item.kind === 'token') {
      const dst = matchingTokenAt(e.clientX, e.clientY, item);
      if (dst?.kind === 'token') {
        table.commit(ops.transferToken(table, item, dst));
        return;
      }
      const target = dropTargetAt(e.clientX, e.clientY, g.id);
      const p = screenToTable(e.clientX, e.clientY);
      const half = item.config.size / 2;
      if (target?.type === 'mat') {
        const mat = getMat(table.state, target.id);
        if (mat && !['stack', 'fan'].includes(mat.config.placement.type)) {
          const o = table.effectiveOrigin(mat.id);
          table.commit(
            ops.takeOneTo(table, item, mat, {
              x: p.x - o.x - half,
              y: p.y - o.y - half,
              z: table.maxZ() + 1,
              rot: 0,
            }),
          );
          return;
        }
        return; // token into a card stack: not a thing
      }
      table.commit(
        ops.takeOneTo(table, item, null, {
          x: p.x - half,
          y: p.y - half,
          z: table.maxZ() + 1,
          rot: 0,
        }),
      );
      return;
    }

    const src = getMat(table.state, g.srcMat);
    const target = dropTargetAt(e.clientX, e.clientY, g.id);

    if (target?.type === 'tray') {
      dropInTray(item, e.clientX, e.clientY);
      return;
    }
    if (target?.type === 'mat') {
      const mat = getMat(table.state, target.id);
      if (mat && !isDescendant(mat.id, g.id)) {
        if (mat.id === g.srcMat && ['stack'].includes(mat.config.placement.type)) return;
        const stackish = ['stack', 'fan'].includes(mat.config.placement.type);
        if (stackish && isStackedKind(mat, item)) {
          table.commit(ops.moveToMat(table, item, mat, { where: 'top' }));
        } else {
          const o = table.effectiveOrigin(mat.id);
          const p = screenToTable(e.clientX, e.clientY);
          const w = item.kind === 'card' ? item.config.w : 30;
          const h = item.kind === 'card' ? item.config.h : 30;
          table.commit(
            ops.moveToMat(table, item, mat, {
              pos: { x: p.x - o.x - w / 2, y: p.y - o.y - h / 2, z: table.maxZ() + 1, rot: 0 },
              snap: !e.altKey,
            }),
          );
        }
        return;
      }
    }
    // to the root table. Natural face: if I could see its face where it came
    // from (hand, face-up pile), it plays face up; from a hidden stack it
    // stays hidden. Shift inverts; the felt's own entry rule trumps both.
    const p = screenToTable(e.clientX, e.clientY);
    const w = item.kind === 'card' ? item.config.w : 30;
    const h = item.kind === 'card' ? item.config.h : 30;
    const naturalUp = src ? canSeeFaces(src, table.me.id) : true;
    const rawDrop: Pos = { x: p.x - w / 2, y: p.y - h / 2, z: table.maxZ() + 1, rot: 0 };
    const pos = e.altKey ? rawDrop : rootSnap(rawDrop, item);
    table.commit(
      ops.moveToTable(
        table,
        item,
        pos,
        item.kind === 'card' ? rootEntryFace(naturalUp !== e.shiftKey) : undefined,
      ),
    );
  }

  const ghostItem = $derived(ghost?.moved ? table.get(ghost.id) : undefined);
  // never reveal what the viewer isn't entitled to while dragging
  const ghostFace = $derived.by(() => {
    if (!ghostItem || ghostItem.kind !== 'card' || !ghost) return null;
    if (ghostItem.state.faceUp) return ghostItem.config.front;
    const src = getMat(table.state, ghost.srcMat);
    return src && canSeeFaces(src, table.me.id) ? ghostItem.config.front : null;
  });

  // ---- double-click: configured quick action #1 (⌥ = #2), else the
  // platform default per kind (v4 §9) ----
  function onDouble(e: PointerEvent | MouseEvent, ent: Entity) {
    e.stopPropagation();
    if (ent.kind === 'mat' && ent.config.quickActions?.length) {
      const qa = ent.config.quickActions;
      runMatButton((e.altKey && qa[1]) || qa[0], ent);
      return;
    }
    if (ent.kind === 'card') table.commit(ops.flipCard(table, ent));
    else if (ent.kind === 'mat' && ['stack', 'fan'].includes(ent.config.placement.type))
      table.commit(ops.drawTo(table, ent, table.myHand()));
    else if (ent.kind === 'dice') table.commit(ops.rollDice(table, ent, table.me.id));
  }

  // ---- send-to (stateful key sequence / click-resolve) ----
  const letters = $derived(matLetters(table.state));
  function beginSend(action: UiAction, sel: Entity) {
    // invoked with a multi-selection, send applies to all of it
    const ids =
      table.selected.length > 1 && table.isSelected(sel.id) ? [...table.selected] : [sel.id];
    table.pendingSend = { actionId: action.id, selIds: ids };
  }
  function resolveSend(mat: MatEntity) {
    const pending = table.pendingSend;
    table.pendingSend = null;
    if (!pending) return;
    const action = ACTIONS.find((a) => a.id === pending.actionId);
    const ents = pending.selIds
      .map((id) => table.get(id))
      .filter((e): e is Entity => !!e && e.id !== mat.id);
    if (!action || ents.length === 0) return;
    if (action.muts) commitAll(action.muts, ents, { mat });
    else action.run(ents[0], { mat });
  }

  // ---- context menu / hover buttons / palette (all from the registry) ----
  let menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);
  let searchMatId = $state<string | null>(null);
  let settingsMatId = $state<string | null>(null);
  let itemSettingsId = $state<string | null>(null);
  let paletteOpen = $state(false);
  let paletteSel = $state<Entity | null>(null);
  const searchMat = $derived(searchMatId ? getMat(table.state, searchMatId) : undefined);
  const settingsMat = $derived(settingsMatId ? getMat(table.state, settingsMatId) : undefined);
  const settingsItem = $derived(itemSettingsId ? table.get(itemSettingsId) : undefined);

  uiHooks.openSearch = (matId) => (searchMatId = matId);
  uiHooks.spotBeside = (e) => {
    const o = table.effectiveOrigin(e.parent);
    return { x: o.x + e.pos.x + 88, y: o.y + e.pos.y, z: table.maxZ() + 1, rot: 0 };
  };

  /** Macros take no selection; every other action arrives via actionsFor(sel)
   *  and therefore has one. */
  function runAction(a: UiAction, sel: Entity | null) {
    if (a.needsMat) {
      if (sel) beginSend(a, sel);
      return;
    }
    a.run(sel as Entity);
  }

  function onMenu(e: PointerEvent | MouseEvent, ent: Entity) {
    e.preventDefault();
    e.stopPropagation();
    lastClickedId = ent.id;
    menu = { x: e.clientX, y: e.clientY, items: menuFor(ent) };
  }

  function menuFor(ent: Entity): MenuItem[] {
    const items: MenuItem[] = actionsFor(ent).map((a) => ({
      label: a.key ? `${a.label}  (${a.key})` : a.label,
      danger: a.id === 'delete',
      run: () => runAction(a, ent),
    }));

    if (ent.kind === 'mat') {
      // act-on-all compounds, derived from the registry (PROPOSAL v4 §1)
      items.push(...matCompoundItems(ent));
      const contents = matItems(table.state, ent).filter((i) => !i.locked);
      if (contents.length > 1)
        items.push({
          label: `Select all ${contents.length} items here`,
          run: () => table.select(contents.map((i) => i.id)),
        });
      items.push({ label: '⚙ Mat settings…', run: () => (settingsMatId = ent.id) });
      items.push({
        label: table.isPinned(ent.id) ? 'Unpin from my tray' : 'Pin to my tray',
        run: () => table.setPin(ent.id, !table.isPinned(ent.id)),
      });
      if (['stack', 'fan'].includes(ent.config.placement.type)) {
        const cur = table.views[ent.id] ?? 'auto';
        const next = cur === 'auto' ? 'fan' : cur === 'fan' ? 'collapsed' : 'auto';
        items.push({
          label: `My view: ${cur} → ${next}`,
          run: () => table.setView(ent.id, next),
        });
      } else if (ent.id !== ROOT_MAT_ID) {
        // region mats: shrink-wrap the outline to the contents (v4 §2)
        const fit = table.views[ent.id] === 'fit';
        items.push({
          label: fit ? 'My view: fit contents → fixed size' : 'My view: fixed size → fit contents',
          run: () => table.setView(ent.id, fit ? 'auto' : 'fit'),
        });
      }
    }

    // positioning mode: shared moves vs my-view-only (SPEC §10)
    {
      const arb = ent.positioning === 'arbitrary';
      items.push({
        label: arb ? 'Position: my view only → shared' : 'Position: shared → my view only',
        run: () => {
          if (arb) {
            // adopt my current placement as the shared one
            const mine = table.effectivePos(ent);
            table.setPosOverride(ent.id, null);
            table.update(ent, (d) => {
              d.positioning = 'absolute';
              d.pos = { ...d.pos, x: mine.x, y: mine.y, z: mine.z };
            });
          } else {
            table.update(ent, (d) => {
              d.positioning = 'arbitrary';
            });
          }
        },
      });
      if (arb && table.posOverrides[ent.id]) {
        items.push({
          label: 'Reset to default spot',
          run: () => table.setPosOverride(ent.id, null),
        });
      }
    }

    // "apply to my siblings": select everything of my kind in my container
    if (ent.kind !== 'mat' && !ent.locked) {
      const sibs = Object.values(table.state.entities).filter(
        (x) => x.kind === ent.kind && x.parent === ent.parent && !x.locked,
      );
      if (sibs.length > 1)
        items.push({
          label: `Select all ${sibs.length} ${ent.kind === 'dice' ? 'dice' : `${ent.kind}s`} here`,
          run: () => table.select(sibs.map((x) => x.id)),
        });
    }

    // annotations live on any entity (SPEC §15)
    items.push({
      label: ent.annotation ? '📝 Annotation…' : 'Annotation…',
      run: () => {
        const text = prompt('Annotation (empty to remove):', ent.annotation ?? '');
        if (text === null) return;
        table.update(ent, (d) => {
          d.annotation = text.trim() || undefined;
        });
      },
    });

    if (ent.kind === 'token') {
      const count = ent.state.count ?? 1;
      if (count > 1) {
        const splitOff = (n: number) =>
          table.commit(
            ops.splitToken(table, ent, n, {
              x: ent.pos.x + ent.config.size + 12,
              y: ent.pos.y,
              z: table.maxZ() + 1,
              rot: 0,
            }),
          );
        items.push(
          { label: 'Take 1 off the stack', run: () => splitOff(1) },
          {
            label: 'Split stack…',
            run: () => {
              const n = Number(prompt(`Take how many? (stack of ${count})`, '1'));
              if (Number.isInteger(n)) splitOff(n);
            },
          },
        );
      }
    }
    // one dialog for what an item IS (label, value, shape, sides…) — v4 §4
    if (['token', 'dice', 'card', 'counter', 'scoreboard'].includes(ent.kind)) {
      items.push({ label: '⚙ Item settings…', run: () => (itemSettingsId = ent.id) });
    }
    if (ent.kind === 'note') {
      const NOTE_COLORS: Array<[string, string]> = [
        ['🟡 yellow', '#e7d980'],
        ['🟢 green', '#b6dc9a'],
        ['🩷 pink', '#eab6cf'],
        ['🔵 blue', '#a9cdea'],
      ];
      for (const [name, color] of NOTE_COLORS) {
        if (ent.config.color === color) continue;
        items.push({
          label: `Color: ${name}`,
          run: () =>
            table.update(ent, (n) => {
              n.config.color = color;
            }),
        });
      }
    }
    if (ent.kind === 'timer') {
      items.push(
        {
          label: 'Countdown…',
          run: () => {
            const min = Number(prompt('Countdown minutes:', '5'));
            if (!(min > 0)) return;
            table.update(ent, (t) => {
              t.state.mode = 'countdown';
              t.state.durationMs = Math.round(min * 60000);
              t.state.running = false;
              t.state.elapsedMs = 0;
            });
          },
        },
        {
          label: 'Stopwatch',
          run: () =>
            table.update(ent, (t) => {
              t.state.mode = 'stopwatch';
              t.state.running = false;
              t.state.elapsedMs = 0;
            }),
        },
      );
    }
    return items;
  }

  // hover buttons overlay: registry actions with hover:true for the hovered entity
  const hoverTarget = $derived.by(() => {
    if (!hoveredId || drag || ghost || table.pendingSend) return null;
    const e = table.get(hoveredId);
    return e ?? null;
  });
  const hoverActions = $derived(
    hoverTarget ? actionsFor(hoverTarget).filter((a) => a.hover).slice(0, 3) : [],
  );
  const hoverPos = $derived.by(() => {
    if (!hoverTarget) return null;
    const o = table.effectiveOrigin(hoverTarget.parent);
    const pos = table.dragPos[hoverTarget.id] ?? table.effectivePos(hoverTarget);
    return tableToScreen(o.x + pos.x, o.y + pos.y);
  });
  // every gesture needs a visible affordance (SPEC §15): teach the stack pull
  const gestureHint = $derived.by(() => {
    const t = hoverTarget;
    if (!t) return null;
    if (t.kind === 'mat' && t.config.placement.type === 'stack' && matItems(table.state, t).length > 1)
      return 'drag = take one · side handles move the pile';
    if (t.kind === 'token' && (t.state.count ?? 1) > 1)
      return 'drag = take one · side handles move the stack';
    return null;
  });

  // ---- spawning ----
  function centerPos(): Pos {
    const r = viewportEl.getBoundingClientRect();
    const p = screenToTable(r.left + r.width / 2, r.top + r.height / 2);
    const j = () => Math.round((Math.random() - 0.5) * 120);
    return { x: p.x + j(), y: p.y + j(), z: table.maxZ() + 1, rot: 0 };
  }

  function spawn(kind: Entity['kind'], config: unknown, state: unknown, prefix: string = kind) {
    table.create({
      id: newId(prefix),
      kind,
      version: table.next(),
      parent: null,
      pos: centerPos(),
      locked: false,
      config,
      state,
    } as Entity);
  }

  const TOKEN_COLORS = ['#e4573d', '#3d9be4', '#48b265', '#d9a521', '#9b59c9', '#f0f0f0', '#22242a'];
  let tokenColorIdx = 0;
  // chips carry a label AND a numeric value; stacks show the total (v4 §4)
  const CHIPS = [
    { label: '$1', color: '#b8b2a0', value: 1 },
    { label: '$5', color: '#c0392b', value: 5 },
    { label: '$25', color: '#27ae60', value: 25 },
    { label: '$100', color: '#22242a', value: 100 },
  ];

  function spawnMat(opts: Parameters<typeof makeMat>[2]) {
    table.create(makeMat(table.next(), centerPos(), opts));
  }

  function spawnMenuItems(): MenuItem[] {
    return [
      { label: '🂠 52-card deck', run: () => table.commit(standardDeck(table, centerPos())) },
      { label: '🂠 Discard pile', run: () => spawnMat(matPresets.pile()) },
      ...CHIPS.map((chip) => ({
        label: `⛁ Chips ${chip.label} (×20)`,
        run: () =>
          spawn(
            'token',
            {
              shape: 'disc',
              color: chip.color,
              label: chip.label,
              size: 34,
              values: { value: chip.value },
            },
            { count: 20 },
            'tok',
          ),
      })),
      {
        label: '● Token',
        run: () =>
          spawn(
            'token',
            {
              shape: 'disc',
              color: TOKEN_COLORS[tokenColorIdx++ % TOKEN_COLORS.length],
              label: '',
              size: 28,
            },
            { count: 1 },
            'tok',
          ),
      },
      {
        label: '⚄ Dice tray (2d6)',
        run: () => {
          const pos = centerPos();
          const tray = makeMat(table.next(), pos, matPresets.diceTray());
          const muts: Mutation[] = [{ t: 'put', entity: tray }];
          for (let i = 0; i < 2; i++) {
            muts.push({
              t: 'put',
              entity: {
                id: newId('dice'),
                kind: 'dice',
                version: table.next(),
                parent: tray.id,
                pos: { x: 18 + i * 58, y: 26, z: i + 1, rot: 0 },
                locked: false,
                config: { sides: 6 },
                state: { values: [i + 2], rolledBy: null, rolledAt: 0 },
              },
            });
          }
          table.commit(muts);
        },
      },
      {
        label: '⚄ Die (d6)',
        run: () => spawn('dice', { sides: 6 }, { values: [1], rolledBy: null, rolledAt: 0 }),
      },
      { label: '# Counter', run: () => spawn('counter', { label: 'Counter' }, { value: 0 }) },
      { label: '≡ Scoreboard', run: () => spawn('scoreboard', { label: 'Score' }, { values: {} }) },
      {
        label: '⏱ Timer',
        run: () =>
          spawn(
            'timer',
            {},
            { mode: 'stopwatch', running: false, startedAt: 0, elapsedMs: 0, durationMs: 0 },
          ),
      },
      { label: '▦ Mat (snap grid)', run: () => spawnMat(matPresets.zone('Zone')) },
      {
        label: '▭ Mat (cards enter face down)',
        run: () => spawnMat(matPresets.zone('Play area', 'down')),
      },
      { label: '▭ Mat (free — no snap)', run: () => spawnMat(matPresets.zone('Zone', 'keep', false)) },
      {
        label: '⬡ Mat (hex grid)',
        run: () =>
          spawnMat({
            ...matPresets.zone('Hex board'),
            placement: { type: 'grid', grid: { size: 60, hex: true } },
            size: { w: 380, h: 320 },
          }),
      },
      { label: '🗈 Note', run: () => spawn('note', { color: '#e7d980' }, { text: '' }) },
      {
        label: '⬡ Catan setup (beginner)',
        run: () => {
          const p = centerPos();
          table.commit(catanTable(table, { x: p.x - 260, y: p.y - 280, z: p.z, rot: 0 }));
        },
      },
      {
        label: '⚔ Dominion setup (base)',
        run: () => {
          const p = centerPos();
          table.commit(dominionTable(table, { x: p.x - 450, y: p.y - 280, z: p.z, rot: 0 }));
        },
      },
      { label: '⇪ Import card set…', run: () => cardSetInput.click() },
    ];
  }

  function openSpawnMenu(e: MouseEvent) {
    menu = { x: e.clientX, y: e.clientY, items: spawnMenuItems() };
  }

  /** Arrange OTHER players' private mats in MY view only (v4 §10): their
   *  placement is per-viewer (arbitrary positioning), so this is local. */
  function arrangeOthersPrivate(mode: 'side' | 'circle') {
    const mats = Object.values(table.state.entities).filter(
      (e): e is MatEntity =>
        e.kind === 'mat' &&
        e.id !== ROOT_MAT_ID &&
        isPrivate(e) &&
        !isOwnerOf(e, table.me.id) &&
        e.positioning === 'arbitrary' &&
        !table.isPinned(e.id),
    );
    if (mats.length === 0) return;
    const r = viewportEl.getBoundingClientRect();
    if (mode === 'side') {
      const p = screenToTable(r.left + 90, r.top + 120);
      mats.forEach((m, i) =>
        table.setPosOverride(m.id, { x: p.x, y: p.y + i * 190, z: m.pos.z }),
      );
    } else {
      const c = screenToTable(r.left + r.width / 2, r.top + r.height / 2);
      const rad = Math.min(r.width, r.height) / (2.3 * (table.uiScale || 1));
      mats.forEach((m, i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / mats.length;
        table.setPosOverride(m.id, {
          x: Math.round(c.x + rad * Math.cos(a) - 70),
          y: Math.round(c.y + rad * Math.sin(a) - 50),
          z: m.pos.z,
        });
      });
    }
  }

  // right-clicking the felt opens the ROOT MAT's menu — the table is a mat
  function onFeltMenu(e: MouseEvent) {
    e.preventDefault();
    const { clientX: x, clientY: y } = e;
    menu = {
      x,
      y,
      items: [
        { label: '⚙ Table settings…', run: () => (settingsMatId = ROOT_MAT_ID) },
        { label: '＋ Add to table…', run: () => (menu = { x, y, items: spawnMenuItems() }) },
        { label: 'Select all', run: () => table.select(selectableIdsInRect()) },
        {
          label: "Arrange others' private mats: to the side (my view)",
          run: () => arrangeOthersPrivate('side'),
        },
        {
          label: "Arrange others' private mats: in a circle (my view)",
          run: () => arrangeOthersPrivate('circle'),
        },
      ],
    };
  }

  let cardSetInput: HTMLInputElement;
  async function importCardSet(file: File) {
    try {
      const spec = validateCardSet(JSON.parse(await file.text()));
      table.commit(buildCardSet(table, spec, centerPos()));
    } catch (err) {
      alert(`Card set import failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ---- import / export (a template IS an ordinary save, SPEC §15) ----
  function doExport() {
    exportTable(room, table.snapshot());
  }
  async function doImport(file: File) {
    try {
      const snap = JSON.parse(await file.text());
      if (!snap?.entities || !snap?.tombstones) throw new Error('not a ludwig table file');
      snap.log ??= {};
      table.receiveSnapshot(snap);
      table.net?.broadcastSnapshot();
    } catch (err) {
      alert(`Import failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ---- presence ----
  function onPointerMoveViewport(e: PointerEvent) {
    lastMouse = { x: e.clientX, y: e.clientY };
    const p = screenToTable(e.clientX, e.clientY);
    table.net?.sendPointer(p.x, p.y);
  }

  // ---- keyboard ----
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      menu = null;
      searchMatId = null;
      settingsMatId = null;
      itemSettingsId = null;
      paletteOpen = false;
      table.pendingSend = null;
      table.select([]);
      return;
    }
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key.toLowerCase() === 'z' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      table.undo();
      return;
    }
    if (paletteOpen) return; // palette handles its own keys

    // pending send-to: the next letter picks the target mat
    if (table.pendingSend) {
      const matId = Object.entries(letters).find(([, l]) => l === e.key)?.[0];
      const mat = matId ? getMat(table.state, matId) : undefined;
      if (mat) resolveSend(mat);
      else table.pendingSend = null;
      e.preventDefault();
      return;
    }

    if (e.key === ' ') {
      e.preventDefault();
      paletteSel = selectionNow();
      paletteOpen = true;
      return;
    }
    if (e.key === 'z' && !e.metaKey && !e.ctrlKey) {
      table.undo();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // a live multi-selection takes the keys (f flips all, x deletes all…)
    const selEnts = selectionEntities();
    if (selEnts.length > 1) {
      const a = actionForKeyMulti(e.key, selEnts);
      if (a) {
        e.preventDefault();
        if (a.needsMat) beginSend(a, selEnts[0]);
        else commitAll(a.muts!, selEnts);
      }
      return;
    }
    const sel = selectionNow();
    const action = actionForKey(e.key, sel);
    if (action && sel) {
      e.preventDefault();
      runAction(action, sel);
    }
  }

  const handlers = {
    onGrab,
    onDouble,
    onMenu,
    onGhostGrab: startGhostDrag,
    onMatMove,
    onHover: setHover,
  };
</script>

<svelte:window onkeydown={onKey} onpagehide={() => table.flush()} />

<div class="table-screen">
  <Toolbar
    onAddMenu={openSpawnMenu}
    onExport={doExport}
    onImport={doImport}
    onUndo={() => table.undo()}
  />
  <input
    type="file"
    accept="application/json"
    bind:this={cardSetInput}
    hidden
    onchange={(e) => {
      const f = e.currentTarget.files?.[0];
      if (f) importCardSet(f);
      e.currentTarget.value = '';
    }}
  />

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="viewport"
    data-drop="table"
    bind:this={viewportEl}
    style:background-color={root?.config.color ?? undefined}
    onwheel={onWheel}
    onpointerdown={onBackgroundDown}
    onpointermove={onPointerMoveViewport}
    oncontextmenu={onFeltMenu}
  >
    <div class="surface" style:transform="translate({view.x}px, {view.y}px) scale({view.scale})">
      {#if rootGrid}
        {@const g = rootGrid.size}
        {@const dy = Math.round(g * 0.866)}
        {@const bx = 20000 % g}
        {@const by = rootGrid.hex ? 20000 % (2 * dy) : 20000 % g}
        <div
          class="feltgrid"
          style:background-size={rootGrid.hex ? `${g}px ${2 * dy}px` : `${g}px ${g}px`}
          style:background-image={rootGrid.hex
            ? 'radial-gradient(circle 2px, rgba(255,255,255,0.28) 98%, transparent), radial-gradient(circle 2px, rgba(255,255,255,0.28) 98%, transparent)'
            : 'linear-gradient(to right, rgba(255,255,255,0.09) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.09) 1px, transparent 1px)'}
          style:background-position={rootGrid.hex
            ? `${bx}px ${by}px, ${bx + g / 2}px ${by + dy}px`
            : `${bx}px ${by}px`}
        ></div>
      {/if}
      {#each tableEntities as entity (entity.id)}
        <EntityView {entity} {handlers} />
      {/each}
      <Cursors />
      {#if table.pendingSend}
        {#each tableEntities.filter((e) => e.kind === 'mat' && letters[e.id]) as m (m.id)}
          {@const mp = table.effectivePos(m)}
          <span class="letter" style:left="{mp.x - 12}px" style:top="{mp.y - 12}px">
            {letters[m.id]}
          </span>
        {/each}
      {/if}
    </div>
  </div>

  <QuickActions />
  <Roster />
  <HandTray onCardGrab={(e, id, matId) => startGhostDrag(e, id, matId)} />
  <LogPanel />

  {#if table.pendingSend}
    <div class="sendhint">send to… press a mat letter (h = hand, Esc cancels)</div>
  {/if}

  {#if band && (Math.abs(band.x1 - band.x0) > 4 || Math.abs(band.y1 - band.y0) > 4)}
    <div
      class="band"
      style:left="{Math.min(band.x0, band.x1)}px"
      style:top="{Math.min(band.y0, band.y1)}px"
      style:width="{Math.abs(band.x1 - band.x0)}px"
      style:height="{Math.abs(band.y1 - band.y0)}px"
    ></div>
  {/if}

  {#if hoverTarget && hoverActions.length > 0 && hoverPos}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="hoverbar"
      style:left="{hoverPos.x}px"
      style:top="{hoverPos.y}px"
      onpointerenter={() => clearTimeout(hoverClearTimer)}
      onpointerleave={() => setHover(null)}
    >
      <div class="buttons">
        {#each hoverActions as a (a.id)}
          <button
            title="{a.label}{a.key ? ` (${a.key})` : ''}"
            onpointerdown={(e) => e.stopPropagation()}
            onclick={() => runAction(a, hoverTarget)}
          >
            {a.icon ?? a.label}
          </button>
        {/each}
        <button
          title="more…"
          onpointerdown={(e) => e.stopPropagation()}
          onclick={(e) => {
            menu = { x: e.clientX, y: e.clientY, items: menuFor(hoverTarget) };
          }}
        >
          ⋯
        </button>
      </div>
      {#if gestureHint}
        <div class="gesturehint">{gestureHint}</div>
      {/if}
    </div>
  {/if}

  {#if ghostItem}
    <div class="ghost" style:left="{ghost!.x}px" style:top="{ghost!.y}px">
      {#if ghostItem.kind === 'card'}
        <CardFaceView face={ghostFace} w={ghostItem.config.w} h={ghostItem.config.h} />
      {:else if ghostItem.kind === 'token'}
        <div
          class="ghost-token"
          style:width="{ghostItem.config.size}px"
          style:height="{ghostItem.config.size}px"
          style:background={ghostItem.config.color}
        ></div>
      {/if}
    </div>
  {/if}

  {#if menu}
    <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => (menu = null)} />
  {/if}
  {#if searchMat}
    <DeckSearch mat={searchMat} onClose={() => (searchMatId = null)} />
  {/if}
  {#if settingsMat}
    {#key settingsMat.id}
      <MatSettings mat={settingsMat} onClose={() => (settingsMatId = null)} />
    {/key}
  {/if}
  {#if settingsItem}
    {#key settingsItem.id}
      <ItemSettings item={settingsItem} onClose={() => (itemSettingsId = null)} />
    {/key}
  {/if}
  {#if paletteOpen}
    <Palette
      selection={paletteSel}
      extras={macroActions()}
      onRun={(a) => {
        paletteOpen = false;
        runAction(a, paletteSel);
      }}
      onClose={() => (paletteOpen = false)}
    />
  {/if}
</div>

<style>
  .table-screen {
    position: fixed;
    inset: 0;
    overflow: hidden;
  }
  .viewport {
    position: absolute;
    inset: 44px 0 0 0;
    background:
      radial-gradient(ellipse at center, rgba(255, 255, 255, 0.05), transparent 70%),
      repeating-linear-gradient(0deg, var(--felt), var(--felt) 40px, var(--felt-line) 40px, var(--felt-line) 41px),
      repeating-linear-gradient(90deg, var(--felt), var(--felt) 40px, transparent 40px, transparent 41px);
    background-color: var(--felt);
    cursor: default;
    touch-action: none;
  }
  .surface {
    position: absolute;
    transform-origin: 0 0;
  }
  /* root-mat grid, drawn in table coordinates so it pans/zooms with play */
  .feltgrid {
    position: absolute;
    left: -20000px;
    top: -20000px;
    width: 40000px;
    height: 40000px;
    pointer-events: none;
  }
  .ghost {
    position: fixed;
    z-index: 400000;
    pointer-events: none;
    transform: translate(-50%, -50%) rotate(3deg);
    opacity: 0.9;
  }
  .ghost-token {
    border-radius: 50%;
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.4);
  }
  /* sits flush against the entity's top edge (no gap to cross) */
  .hoverbar {
    position: fixed;
    z-index: 250001;
    transform: translateY(-100%);
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding-bottom: 0;
  }
  .buttons {
    display: flex;
    gap: 2px;
    background: rgba(30, 34, 43, 0.95);
    border: 1px solid #454f60;
    border-radius: 6px;
    padding: 2px;
  }
  .gesturehint {
    order: -1;
    background: rgba(30, 34, 43, 0.85);
    border-radius: 5px;
    padding: 1px 7px;
    font-size: 0.62rem;
    color: var(--muted);
    white-space: nowrap;
    pointer-events: none;
  }
  .hoverbar button {
    padding: 1px 7px;
    font-size: 0.8rem;
    border: none;
    background: none;
  }
  .hoverbar button:hover {
    background: var(--panel-2);
  }
  .letter {
    position: absolute;
    z-index: 260000;
    background: var(--accent);
    color: #241d06;
    font-weight: 700;
    font-size: 0.8rem;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
  }
  .band {
    position: fixed;
    z-index: 260001;
    border: 1px solid #4da3ff;
    background: rgba(77, 163, 255, 0.12);
    pointer-events: none;
  }
  .sendhint {
    position: fixed;
    top: 54px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--accent);
    color: #241d06;
    font-size: 0.8rem;
    font-weight: 600;
    padding: 4px 14px;
    border-radius: 14px;
    z-index: 300002;
  }
</style>
