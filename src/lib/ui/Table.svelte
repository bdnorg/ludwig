<script lang="ts">
  import { onMount } from 'svelte';
  import type { CardEntity, Entity, MatEntity, Pos, VisibilityRule } from '../model/types';
  import { newId } from '../model/types';
  import * as ops from '../model/ops';
  import { standardDeck } from '../model/cards52';
  import {
    canSeeFaces,
    describeRule,
    getMat,
    makeMat,
    matItems,
    matLetters,
    matPresets,
    topItem,
  } from '../model/mats';
  import { buildCardSet, validateCardSet } from '../model/cardsets';
  import { dominionTable } from '../model/dominion';
  import { catanTable } from '../model/catan';
  import { table } from '../state/store.svelte';
  import { connect } from '../net/room';
  import { exportTable, exportTemplate } from '../state/persist';
  import { applyPendingTemplate } from '../state/templates';
  import { ACTIONS, actionsFor, actionForKey, uiHooks, type UiAction } from './actions';
  import type { MenuItem } from './menu';
  import EntityView from './EntityView.svelte';
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
    return () => {
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

  let pan: { sx: number; sy: number; vx: number; vy: number } | null = null;
  function onBackgroundDown(e: PointerEvent) {
    if (e.button !== 0 && e.button !== 1) return;
    pan = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
    window.addEventListener('pointermove', onPanMove);
    window.addEventListener('pointerup', onPanUp);
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

  // ---- entities at the root (docked mats render in chrome, not here) ----
  const tableEntities = $derived(
    Object.values(table.state.entities)
      .filter((e) => e.parent === null && !(e.kind === 'mat' && e.config.docked))
      .sort((a, b) => a.pos.z - b.pos.z),
  );

  // ---- selection & hover (feeds hover buttons, palette, keys) ----
  let hoveredId = $state<string | null>(null);
  let lastClickedId = $state<string | null>(null);
  let lastMouse = { x: 0, y: 0 };

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

  // ---- drag: entities (in whatever mat frame they live) ----
  let drag: { id: string; dx: number; dy: number; fx: number; fy: number; moved: boolean } | null =
    null;

  function isDescendant(id: string, ancestorId: string): boolean {
    let cur: string | null = id;
    let hops = 0;
    while (cur && hops++ < 20) {
      if (cur === ancestorId) return true;
      cur = table.get(cur)?.parent ?? null;
    }
    return false;
  }

  function onGrab(e: PointerEvent | MouseEvent, ent: Entity) {
    if (!(e instanceof PointerEvent) || e.button !== 0) return;
    e.stopPropagation();
    lastClickedId = ent.id;
    // resolve a pending send-to by clicking the target mat
    if (table.pendingSend && ent.kind === 'mat') {
      resolveSend(ent);
      return;
    }
    if (ent.locked) return;
    // dragging a stack pulls its top item, like a physical pile;
    // hold Alt/Cmd/Ctrl to move the mat itself
    if (
      ent.kind === 'mat' &&
      ent.config.placement.type === 'stack' &&
      !e.altKey &&
      !e.metaKey &&
      !e.ctrlKey
    ) {
      const top = topItem(table.state, ent);
      if (top) {
        startGhostDrag(e, top.id, ent.id);
        return;
      }
    }
    // dragging a token stack pulls one piece; Alt-drag moves the whole stack
    if (
      ent.kind === 'token' &&
      (ent.state.count ?? 1) > 1 &&
      !e.altKey &&
      !e.metaKey &&
      !e.ctrlKey
    ) {
      startGhostDrag(e, ent.id, ent.parent, 'one');
      return;
    }
    const frame = table.effectiveOrigin(ent.parent);
    const p = screenToTable(e.clientX, e.clientY);
    const shown = table.effectivePos(ent);
    drag = {
      id: ent.id,
      dx: p.x - frame.x - shown.x,
      dy: p.y - frame.y - shown.y,
      fx: frame.x,
      fy: frame.y,
      moved: false,
    };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragUp);
  }
  function onDragMove(e: PointerEvent) {
    if (!drag) return;
    const p = screenToTable(e.clientX, e.clientY);
    const x = p.x - drag.fx - drag.dx;
    const y = p.y - drag.fy - drag.dy;
    drag.moved = true;
    table.dragPos[drag.id] = { x, y };
    // arbitrary items move only in MY view — never stream their drags
    const ent = table.get(drag.id);
    if (ent?.positioning !== 'arbitrary') table.net?.sendDrag(drag.id, x, y);
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
      delete table.dragPos[d.id];
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
      table.commit(ops.moveToMat(table, ent, table.myHand()));
      return;
    }
    if (target?.type === 'mat' && !isDescendant(target.id, ent.id)) {
      const mat = getMat(table.state, target.id);
      if (mat) {
        const stackish = ['stack', 'fan'].includes(mat.config.placement.type);
        if (stackish && (ent.kind === 'card' || ent.kind === 'token')) {
          table.setPosOverride(ent.id, null);
          table.commit(ops.moveToMat(table, ent, mat, { where: 'top' }));
          return;
        }
        if (!stackish && !isRegionMat) {
          const o = table.effectiveOrigin(mat.id);
          const pos: Pos = {
            x: p.x - o.x - d.dx,
            y: p.y - o.y - d.dy,
            z: table.maxZ() + 1,
            rot: ent.pos.rot,
          };
          table.setPosOverride(ent.id, null);
          table.commit(ops.moveToMat(table, ent, mat, { pos }));
          return;
        }
      }
    }
    // root table (or repositioning within current frame if unchanged parent = root)
    const pos: Pos = {
      x: p.x - d.dx,
      y: p.y - d.dy,
      z: isRegionMat ? ent.pos.z : table.maxZ() + 1,
      rot: ent.pos.rot,
    };
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
        // moving within the same region mat: reposition + snap, no entry rule
        const local: Pos = { x: p.x - d.fx - d.dx, y: p.y - d.fy - d.dy, z: pos.z, rot: pos.rot };
        const snapped = ops.snapPos(parentMat, local, ent);
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
        table.commit(ops.moveToTable(table, ent, pos));
      }
    }
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
      if (item.parent !== table.myHand().id)
        table.commit(ops.moveToMat(table, item, table.myHand()));
      return;
    }
    if (target?.type === 'mat') {
      const mat = getMat(table.state, target.id);
      if (mat && !isDescendant(mat.id, g.id)) {
        if (mat.id === g.srcMat && ['stack'].includes(mat.config.placement.type)) return;
        const stackish = ['stack', 'fan'].includes(mat.config.placement.type);
        if (stackish) {
          table.commit(ops.moveToMat(table, item, mat, { where: 'top' }));
        } else {
          const o = table.effectiveOrigin(mat.id);
          const p = screenToTable(e.clientX, e.clientY);
          const w = item.kind === 'card' ? item.config.w : 30;
          const h = item.kind === 'card' ? item.config.h : 30;
          table.commit(
            ops.moveToMat(table, item, mat, {
              pos: { x: p.x - o.x - w / 2, y: p.y - o.y - h / 2, z: table.maxZ() + 1, rot: 0 },
            }),
          );
        }
        return;
      }
    }
    // to the root table. Natural face: if I could see its face where it came
    // from (hand, face-up pile), it plays face up; from a hidden stack it
    // stays hidden. Shift inverts.
    const p = screenToTable(e.clientX, e.clientY);
    const w = item.kind === 'card' ? item.config.w : 30;
    const h = item.kind === 'card' ? item.config.h : 30;
    const naturalUp = src ? canSeeFaces(src, table.me.id) : true;
    const pos: Pos = { x: p.x - w / 2, y: p.y - h / 2, z: table.maxZ() + 1, rot: 0 };
    table.commit(
      ops.moveToTable(table, item, pos, item.kind === 'card' ? naturalUp !== e.shiftKey : undefined),
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

  // ---- double-click ----
  function onDouble(e: PointerEvent | MouseEvent, ent: Entity) {
    e.stopPropagation();
    if (ent.kind === 'card') table.commit(ops.flipCard(table, ent));
    else if (ent.kind === 'mat' && ['stack', 'fan'].includes(ent.config.placement.type))
      table.commit(ops.drawTo(table, ent, table.myHand()));
    else if (ent.kind === 'dice') table.commit(ops.rollDice(table, ent, table.me.id));
  }

  // ---- send-to (stateful key sequence / click-resolve) ----
  const letters = $derived(matLetters(table.state));
  function beginSend(action: UiAction, sel: Entity) {
    table.pendingSend = { actionId: action.id, selId: sel.id };
  }
  function resolveSend(mat: MatEntity) {
    const pending = table.pendingSend;
    table.pendingSend = null;
    if (!pending) return;
    const sel = table.get(pending.selId);
    const action = ACTIONS.find((a) => a.id === pending.actionId);
    if (sel && action) action.run(sel, { mat });
  }

  // ---- context menu / hover buttons / palette (all from the registry) ----
  let menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);
  let searchMatId = $state<string | null>(null);
  let paletteOpen = $state(false);
  let paletteSel = $state<Entity | null>(null);
  const searchMat = $derived(searchMatId ? getMat(table.state, searchMatId) : undefined);

  uiHooks.openSearch = (matId) => (searchMatId = matId);
  uiHooks.spotBeside = (e) => {
    const o = table.effectiveOrigin(e.parent);
    return { x: o.x + e.pos.x + 88, y: o.y + e.pos.y, z: table.maxZ() + 1, rot: 0 };
  };

  function runAction(a: UiAction, sel: Entity) {
    if (a.needsMat) beginSend(a, sel);
    else a.run(sel);
  }

  function onMenu(e: PointerEvent | MouseEvent, ent: Entity) {
    e.preventDefault();
    e.stopPropagation();
    lastClickedId = ent.id;
    menu = { x: e.clientX, y: e.clientY, items: menuFor(ent) };
  }

  function setVis(mat: MatEntity, field: 'faces' | 'count' | 'existence', rule: VisibilityRule) {
    table.update(mat, (m) => {
      m.config.visibility[field] = rule;
    });
    table.logMsg(
      `${table.playerName(table.me.id)} set “${mat.config.label}” ${field} visible to ${describeRule(rule)}`,
    );
  }

  function menuFor(ent: Entity): MenuItem[] {
    const items: MenuItem[] = actionsFor(ent).map((a) => ({
      label: a.key ? `${a.label}  (${a.key})` : a.label,
      danger: a.id === 'delete',
      run: () => runAction(a, ent),
    }));

    if (ent.kind === 'mat') {
      const vis = ent.config.visibility;
      items.push({
        label: `Faces: ${describeRule(vis.faces)} → ${vis.faces === 'public' ? 'owner only' : 'everyone'}`,
        run: () => setVis(ent, 'faces', vis.faces === 'public' ? 'owner' : 'public'),
      });
      if (vis.faces !== 'public' && vis.faces !== 'owner')
        items.push({ label: 'Faces: everyone', run: () => setVis(ent, 'faces', 'public') });
      items.push({
        label: `Count: ${describeRule(vis.count)} → ${vis.count === 'public' ? 'owner only' : 'everyone'} (advanced)`,
        run: () => setVis(ent, 'count', vis.count === 'public' ? 'owner' : 'public'),
      });
      if (['stack', 'fan'].includes(ent.config.placement.type)) {
        const cur = table.views[ent.id] ?? 'auto';
        const next = cur === 'auto' ? 'fan' : cur === 'fan' ? 'collapsed' : 'auto';
        items.push({
          label: `My view: ${cur} → ${next}`,
          run: () => table.setView(ent.id, next),
        });
      }
      items.push({
        label: 'Rename…',
        run: () => {
          const label = prompt('Label:', ent.config.label);
          if (label)
            table.update(ent, (m) => {
              m.config.label = label;
            });
        },
      });
    }

    // positioning mode: shared moves vs my-view-only (SPEC §10)
    if (!(ent.kind === 'mat' && ent.config.docked)) {
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

    if (ent.kind === 'dice') {
      items.push({
        label: 'Change dice…',
        run: () => {
          const spec = prompt('Dice (e.g. 2d6, 1d20):', `${ent.config.count}d${ent.config.sides}`);
          const m = spec?.match(/^\s*(\d+)\s*d\s*(\d+)\s*$/i);
          if (!m) return;
          const [count, sides] = [Math.min(12, +m[1]), Math.min(1000, +m[2])];
          if (count < 1 || sides < 2) return;
          table.update(ent, (d) => {
            d.config.count = count;
            d.config.sides = sides;
            d.state.values = Array.from({ length: count }, () => 1);
          });
        },
      });
    }
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
      items.push({
        label: 'Set label…',
        run: () => {
          const label = prompt('Token label:', ent.config.label);
          if (label !== null)
            table.update(ent, (t) => {
              t.config.label = label;
            });
        },
      });
    }
    if (ent.kind === 'counter' || ent.kind === 'scoreboard') {
      items.push({
        label: 'Rename…',
        run: () => {
          const label = prompt('Label:', ent.config.label);
          if (label)
            table.update(ent, (c) => {
              c.config.label = label;
            });
        },
      });
    }
    if (ent.kind === 'counter') {
      items.push({
        label: 'Set value…',
        run: () => {
          const v = Number(prompt('Value:', String(ent.state.value)));
          if (Number.isFinite(v))
            table.update(ent, (c) => {
              c.state.value = v;
            });
        },
      });
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
  const CHIPS = [
    { label: '$1', color: '#b8b2a0' },
    { label: '$5', color: '#c0392b' },
    { label: '$25', color: '#27ae60' },
    { label: '$100', color: '#22242a' },
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
            { shape: 'disc', color: chip.color, label: chip.label, size: 34 },
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
        label: '⚄ Two dice (d6)',
        run: () =>
          spawn('dice', { sides: 6, count: 2 }, { values: [1, 1], rolledBy: null, rolledAt: 0 }),
      },
      {
        label: '⚄ Die (d6)',
        run: () => spawn('dice', { sides: 6, count: 1 }, { values: [1], rolledBy: null, rolledAt: 0 }),
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
      { label: '▭ Mat (free)', run: () => spawnMat(matPresets.zone('Zone')) },
      {
        label: '▭ Mat (cards enter face down)',
        run: () => spawnMat({ ...matPresets.zone('Play area', 'down') }),
      },
      {
        label: '▦ Mat (snap grid)',
        run: () =>
          spawnMat({
            ...matPresets.zone('Grid'),
            placement: { type: 'grid', grid: { size: 40 } },
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

  let cardSetInput: HTMLInputElement;
  async function importCardSet(file: File) {
    try {
      const spec = validateCardSet(JSON.parse(await file.text()));
      table.commit(buildCardSet(table, spec, centerPos()));
    } catch (err) {
      alert(`Card set import failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ---- import / export ----
  function doExport() {
    exportTable(room, table.snapshot());
  }
  function doExportTemplate() {
    exportTemplate(room, table.snapshot());
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
      paletteOpen = false;
      table.pendingSend = null;
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
    onHover: (id: string | null) => (hoveredId = id),
  };
</script>

<svelte:window onkeydown={onKey} onpagehide={() => table.flush()} />

<div class="table-screen">
  <Toolbar
    onAddMenu={openSpawnMenu}
    onExport={doExport}
    onExportTemplate={doExportTemplate}
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
    onwheel={onWheel}
    onpointerdown={onBackgroundDown}
    onpointermove={onPointerMoveViewport}
    oncontextmenu={(e) => e.preventDefault()}
  >
    <div class="surface" style:transform="translate({view.x}px, {view.y}px) scale({view.scale})">
      {#each tableEntities as entity (entity.id)}
        <EntityView {entity} {handlers} />
      {/each}
      <Cursors />
      {#if table.pendingSend}
        {#each tableEntities.filter((e) => e.kind === 'mat') as m (m.id)}
          <span class="letter" style:left="{m.pos.x - 12}px" style:top="{m.pos.y - 12}px">
            {letters[m.id]}
          </span>
        {/each}
      {/if}
    </div>
  </div>

  <Roster />
  <HandTray onCardGrab={(e, id) => startGhostDrag(e, id, table.myHand().id)} />
  <LogPanel />

  {#if table.pendingSend}
    <div class="sendhint">send to… press a mat letter (h = hand, Esc cancels)</div>
  {/if}

  {#if hoverTarget && hoverActions.length > 0 && hoverPos}
    <div class="hoverbar" style:left="{hoverPos.x}px" style:top="{hoverPos.y - 30}px">
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
  {#if paletteOpen}
    <Palette
      selection={paletteSel}
      onRun={(a) => {
        paletteOpen = false;
        if (paletteSel) runAction(a, paletteSel);
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
  .hoverbar {
    position: fixed;
    z-index: 250001;
    display: flex;
    gap: 2px;
    background: rgba(30, 34, 43, 0.95);
    border: 1px solid #454f60;
    border-radius: 6px;
    padding: 2px;
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
