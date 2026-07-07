<script lang="ts">
  import { onMount } from 'svelte';
  import type { CardEntity, DeckEntity, Entity, Pos } from '../model/types';
  import { newId } from '../model/types';
  import * as ops from '../model/ops';
  import { standardDeck, CARD_W, CARD_H } from '../model/cards52';
  import { table } from '../state/store.svelte';
  import { connect } from '../net/room';
  import { exportTable } from '../state/persist';
  import type { MenuItem } from './menu';
  import EntityView from './EntityView.svelte';
  import HandTray from './HandTray.svelte';
  import Roster from './Roster.svelte';
  import Toolbar from './Toolbar.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import DeckSearch from './DeckSearch.svelte';
  import Cursors from './Cursors.svelte';
  import CardFaceView from './CardFaceView.svelte';

  let { room }: { room: string } = $props();

  // App keys this component by room, so `room` is fixed for our lifetime.
  // svelte-ignore state_referenced_locally
  table.init(room);

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

  function screenToTable(cx: number, cy: number): { x: number; y: number } {
    const r = viewportEl.getBoundingClientRect();
    return { x: (cx - r.left - view.x) / view.scale, y: (cy - r.top - view.y) / view.scale };
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

  // ---- entities on the table ----
  const tableEntities = $derived(
    Object.values(table.state.entities)
      .filter((e) => e.parent === null && e.kind !== 'hand')
      .sort((a, b) => a.pos.z - b.pos.z),
  );

  // ---- drag: entities on the table ----
  let drag: { id: string; dx: number; dy: number; moved: boolean } | null = null;

  function onGrab(e: PointerEvent | MouseEvent, ent: Entity) {
    if (!(e instanceof PointerEvent) || e.button !== 0 || ent.locked) return;
    e.stopPropagation();
    const p = screenToTable(e.clientX, e.clientY);
    drag = { id: ent.id, dx: p.x - ent.pos.x, dy: p.y - ent.pos.y, moved: false };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragUp);
  }
  function onDragMove(e: PointerEvent) {
    if (!drag) return;
    const p = screenToTable(e.clientX, e.clientY);
    const x = p.x - drag.dx;
    const y = p.y - drag.dy;
    drag.moved = true;
    table.dragPos[drag.id] = { x, y };
    table.net?.sendDrag(drag.id, x, y);
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
    const pos: Pos = { x: p.x - d.dx, y: p.y - d.dy, z: table.maxZ() + 1, rot: ent.pos.rot };
    if (ent.kind === 'card') {
      const target = dropTargetAt(e.clientX, e.clientY, ent.id);
      if (target?.type === 'deck') {
        const deck = table.get(target.id);
        if (deck?.kind === 'deck') {
          table.commit(ops.returnToDeck(table, ent, deck, 'top'));
          return;
        }
      } else if (target?.type === 'tray') {
        table.commit(ops.takeToHand(table, ent, table.myHand()));
        return;
      }
    }
    table.update(ent, (draft) => {
      draft.pos = pos;
    });
  }

  function dropTargetAt(
    cx: number,
    cy: number,
    excludeId: string,
  ): { type: 'deck'; id: string } | { type: 'tray' } | null {
    for (const el of document.elementsFromPoint(cx, cy)) {
      const html = el as HTMLElement;
      if (html.dataset?.entityId === excludeId) continue;
      const d = html.dataset?.drop;
      if (!d) continue;
      if (d === 'tray') return { type: 'tray' };
      const [t, id] = d.split(':');
      if (t === 'deck' && id !== excludeId) return { type: 'deck', id };
    }
    return null;
  }

  // ---- drag: cards out of the hand tray (ghost follows the cursor) ----
  let handDrag = $state<{ id: string; sx: number; sy: number; x: number; y: number; moved: boolean } | null>(null);

  function onHandCardGrab(e: PointerEvent, cardId: string) {
    if (e.button !== 0) return;
    e.stopPropagation();
    handDrag = { id: cardId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, moved: false };
    window.addEventListener('pointermove', onHandDragMove);
    window.addEventListener('pointerup', onHandDragUp);
  }
  function onHandDragMove(e: PointerEvent) {
    if (!handDrag) return;
    handDrag.x = e.clientX;
    handDrag.y = e.clientY;
    if (Math.hypot(e.clientX - handDrag.sx, e.clientY - handDrag.sy) > 5) handDrag.moved = true;
  }
  function onHandDragUp(e: PointerEvent) {
    window.removeEventListener('pointermove', onHandDragMove);
    window.removeEventListener('pointerup', onHandDragUp);
    const d = handDrag;
    handDrag = null;
    if (!d || !d.moved) return;
    const card = table.get(d.id);
    if (card?.kind !== 'card') return;
    const target = dropTargetAt(e.clientX, e.clientY, d.id);
    if (target?.type === 'tray') return; // dropped back into the hand
    if (target?.type === 'deck') {
      const deck = table.get(target.id);
      if (deck?.kind === 'deck') {
        table.commit(ops.returnToDeck(table, card, deck, 'top'));
        return;
      }
    }
    const p = screenToTable(e.clientX, e.clientY);
    const pos: Pos = {
      x: p.x - card.config.w / 2,
      y: p.y - card.config.h / 2,
      z: table.maxZ() + 1,
      rot: 0,
    };
    // shift-drop plays face down (e.g. passing cards in hearts)
    table.commit(ops.playToTable(table, card, pos, !e.shiftKey));
  }

  const handDragCard = $derived(
    handDrag?.moved ? (table.get(handDrag.id) as CardEntity | undefined) : undefined,
  );

  // ---- double-click ----
  function onDouble(e: PointerEvent | MouseEvent, ent: Entity) {
    e.stopPropagation();
    if (ent.kind === 'card') table.commit(ops.flipCard(table, ent));
    else if (ent.kind === 'deck') table.commit(ops.drawToHand(table, ent, table.myHand()));
  }

  // ---- context menu ----
  let menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);
  let searchDeckId = $state<string | null>(null);
  const searchDeck = $derived(
    searchDeckId ? (table.get(searchDeckId) as DeckEntity | undefined) : undefined,
  );

  function onMenu(e: PointerEvent | MouseEvent, ent: Entity) {
    e.preventDefault();
    e.stopPropagation();
    menu = { x: e.clientX, y: e.clientY, items: menuFor(ent) };
  }

  function menuFor(ent: Entity): MenuItem[] {
    const items: MenuItem[] = [];
    if (ent.kind === 'card') {
      items.push(
        { label: 'Flip', run: () => table.commit(ops.flipCard(table, ent)) },
        { label: 'Take to hand', run: () => table.commit(ops.takeToHand(table, ent, table.myHand())) },
      );
    }
    if (ent.kind === 'deck') {
      const spot = (): Pos => ({
        x: ent.pos.x + ent.config.w + 16,
        y: ent.pos.y,
        z: table.maxZ() + 1,
        rot: 0,
      });
      items.push(
        { label: 'Draw to hand', run: () => table.commit(ops.drawToHand(table, ent, table.myHand())) },
        { label: 'Draw face up', run: () => table.commit(ops.drawToTable(table, ent, spot(), true)) },
        { label: 'Draw face down', run: () => table.commit(ops.drawToTable(table, ent, spot(), false)) },
        { label: 'Shuffle', run: () => table.commit(ops.shuffleDeck(table, ent)) },
        { label: 'Flip top card', run: () => table.commit(ops.flipTop(table, ent)) },
        {
          label: 'Deal to each player…',
          run: () => {
            const n = Number(prompt('How many cards to each player?', '5'));
            if (Number.isInteger(n) && n > 0)
              table.commit(ops.deal(table, ent, table.connectedHands(), n));
          },
        },
        { label: 'Search / spread…', run: () => (searchDeckId = ent.id) },
        { label: 'Gather cards from table', run: () => table.commit(ops.gatherTableCards(table, ent)) },
      );
    }
    items.push(
      {
        label: ent.locked ? 'Unlock' : 'Lock in place',
        run: () =>
          table.update(ent, (d) => {
            d.locked = !d.locked;
          }),
      },
      { label: 'Delete', danger: true, run: () => table.commit(ops.deleteEntity(table, ent)) },
    );
    return items;
  }

  // ---- spawning ----
  function centerPos(): Pos {
    const r = viewportEl.getBoundingClientRect();
    const p = screenToTable(r.left + r.width / 2, r.top + r.height / 2);
    // jitter so repeated spawns don't stack invisibly
    const j = () => Math.round((Math.random() - 0.5) * 120);
    return { x: p.x + j(), y: p.y + j(), z: table.maxZ() + 1, rot: 0 };
  }

  function spawnDeck() {
    table.commit(standardDeck(table, centerPos()));
  }
  function spawnPile() {
    table.create({
      id: newId('deck'),
      kind: 'deck',
      version: table.next(),
      parent: null,
      pos: centerPos(),
      locked: false,
      config: { label: 'Discard', facePolicy: 'up', w: CARD_W, h: CARD_H },
      state: { cards: [] },
    });
  }
  const TOKEN_COLORS = ['#e4573d', '#3d9be4', '#48b265', '#d9a521', '#9b59c9', '#f0f0f0', '#22242a'];
  let tokenColorIdx = 0;
  function spawnToken() {
    table.create({
      id: newId('tok'),
      kind: 'token',
      version: table.next(),
      parent: null,
      pos: centerPos(),
      locked: false,
      config: {
        shape: 'disc',
        color: TOKEN_COLORS[tokenColorIdx++ % TOKEN_COLORS.length],
        label: '',
        size: 28,
      },
      state: {},
    });
  }
  function spawnNote() {
    table.create({
      id: newId('note'),
      kind: 'note',
      version: table.next(),
      parent: null,
      pos: centerPos(),
      locked: false,
      config: { color: '#e7d980' },
      state: { text: '' },
    });
  }

  // ---- import / export ----
  function doExport() {
    exportTable(room, table.snapshot());
  }
  async function doImport(file: File) {
    try {
      const snap = JSON.parse(await file.text());
      if (!snap?.entities || !snap?.tombstones) throw new Error('not a ludwig table file');
      table.receiveSnapshot(snap);
      table.net?.broadcastSnapshot();
    } catch (err) {
      alert(`Import failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ---- presence ----
  function onPointerMoveViewport(e: PointerEvent) {
    const p = screenToTable(e.clientX, e.clientY);
    table.net?.sendPointer(p.x, p.y);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      menu = null;
      searchDeckId = null;
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="table-screen">
  <Toolbar
    onSpawnDeck={spawnDeck}
    onSpawnPile={spawnPile}
    onSpawnToken={spawnToken}
    onSpawnNote={spawnNote}
    onExport={doExport}
    onImport={doImport}
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
    <div
      class="surface"
      style:transform="translate({view.x}px, {view.y}px) scale({view.scale})"
    >
      {#each tableEntities as entity (entity.id)}
        <EntityView {entity} {onGrab} {onDouble} {onMenu} />
      {/each}
      <Cursors />
    </div>
  </div>

  <Roster />
  <HandTray onCardGrab={onHandCardGrab} />

  {#if handDragCard}
    <div class="ghost" style:left="{handDrag!.x}px" style:top="{handDrag!.y}px">
      <CardFaceView
        face={handDragCard.config.front}
        w={handDragCard.config.w}
        h={handDragCard.config.h}
      />
    </div>
  {/if}

  {#if menu}
    <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => (menu = null)} />
  {/if}
  {#if searchDeck}
    <DeckSearch deck={searchDeck} onClose={() => (searchDeckId = null)} />
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
</style>
