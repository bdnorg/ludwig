<script lang="ts">
  import type { CardEntity, Entity, MatEntity, ViewMode } from '../model/types';
  import { table } from '../state/store.svelte';
  import {
    canSeeCount,
    canSeeExistence,
    canSeeFaces,
    canSeePositions,
    faceVisible,
    isOwnerOf,
    isPrivate,
    isStackedKind,
    matItems,
    privileged,
    sumValue,
  } from '../model/mats';
  import { matButtonLabel, runMatButton } from './actions';
  import Self from './EntityView.svelte';
  import CardFaceView from './CardFaceView.svelte';
  import NoteView from './NoteView.svelte';
  import DiceView from './DiceView.svelte';
  import CounterView from './CounterView.svelte';
  import ScoreboardView from './ScoreboardView.svelte';
  import TimerView from './TimerView.svelte';
  import MatRegion from './MatRegion.svelte';
  import TokenView from './TokenView.svelte';

  type Handler = (e: PointerEvent | MouseEvent, ent: Entity) => void;
  type GhostHandler = (e: PointerEvent, cardId: string, srcMatId: string) => void;
  interface Handlers {
    onGrab: Handler;
    onDouble: Handler;
    onMenu: Handler;
    onGhostGrab: GhostHandler;
    /** move via a handle: always drags the entity itself, never its contents */
    onMatMove: (e: PointerEvent, ent: Entity) => void;
    onHover: (id: string | null) => void;
  }
  let { entity, handlers }: { entity: Entity; handlers: Handlers } = $props();

  const me = $derived(table.me.id);
  const pos = $derived(table.dragPos[entity.id] ?? table.effectivePos(entity));
  const isRegion = $derived(
    entity.kind === 'mat' && ['free', 'grid', 'slots'].includes(entity.config.placement.type),
  );
  // region mats live on a negative band so they can never rise above pieces
  const z = $derived(
    isRegion ? entity.pos.z - 1000000 : table.dragPos[entity.id] ? 100000 : entity.pos.z,
  );

  const mat = $derived(entity.kind === 'mat' ? (entity as MatEntity) : null);
  const items = $derived(mat ? matItems(table.state, mat) : []);
  // only stackKinds pile up; the rest sit loose at their own positions (v4 §2)
  const stacked = $derived(mat ? items.filter((i) => isStackedKind(mat, i)) : []);
  const loose = $derived(mat ? items.filter((i) => !isStackedKind(mat, i)) : []);
  const top = $derived(stacked[0]);
  const sum = $derived(
    mat?.config.showSum ? sumValue(table.state, mat, mat.config.showSum) : null,
  );
  const connectedIds = $derived([...new Set([me, ...Object.values(table.peers)])]);
  const isPrivileged = $derived(mat ? privileged(mat, me, connectedIds) : false);
  const showCount = $derived(mat ? canSeeCount(mat, me) : true);

  // private mats are visually distinct: thick solid border, extra for MINE
  // (v4 §10 — it should be obvious at a glance which private mats are yours)
  const privLevel = $derived(
    mat && isPrivate(mat) ? (isOwnerOf(mat, me) ? 'mine' : 'other') : 'none',
  );

  const view = $derived.by((): ViewMode | 'region' => {
    if (!mat) return 'auto';
    if (isRegion) {
      // positions hidden: non-owners get a count chip, not a live board
      if (!canSeePositions(mat, me)) return 'collapsed';
      return 'region';
    }
    const pref = table.views[mat.id];
    if (pref && pref !== 'auto') return pref;
    // 'count' privacy: non-owners get the count chip, not the backs
    if (mat.config.privacy === 'count' && !canSeeFaces(mat, me)) return 'collapsed';
    if (mat.config.placement.type === 'fan') {
      if (canSeeFaces(mat, me)) return 'fan';
      // fanned backs only if I may watch positions; else an opaque pile
      return canSeePositions(mat, me) ? 'fan' : 'stack';
    }
    return 'stack';
  });

  // owned mats (hands, player boards) carry their owner's name
  const matLabel = $derived(
    mat
      ? mat.config.ownerId
        ? `${table.playerName(mat.config.ownerId)} · ${mat.config.label}`
        : mat.config.label
      : '',
  );

  // fit-contents view: the region outline hugs its items (v4 §2)
  const fitSize = $derived.by(() => {
    if (!mat || !isRegion || table.views[entity.id] !== 'fit') return null;
    let maxX = 48;
    let maxY = 48;
    for (const it of items) {
      const p = table.effectivePos(it);
      const w = it.kind === 'card' ? it.config.w : it.kind === 'token' ? it.config.size : 100;
      const h = it.kind === 'card' ? it.config.h : it.kind === 'token' ? it.config.size : 70;
      maxX = Math.max(maxX, p.x + w);
      maxY = Math.max(maxY, p.y + h);
    }
    return { w: Math.round(maxX + 12), h: Math.round(maxY + 12) };
  });

  // piles move by their hover handle; the body always takes the top item
  // (PROPOSAL v4 §2). Region mats carry their handle inside MatRegion.
  const showHandles = $derived(!entity.locked && mat !== null && view !== 'region');

  // handles show only when hovering THIS entity, not an ancestor or child —
  // CSS :hover applies to every ancestor of the pointer, so each view tracks
  // whether the innermost hovered entity is itself (M17)
  let el: HTMLDivElement | undefined = $state();
  let hoverSelf = $state(false);
  function onOver(e: PointerEvent) {
    hoverSelf = (e.target as Element).closest?.('[data-entity-id]') === el;
  }
  function onOut() {
    hoverSelf = false;
  }

  function cardFace(c: CardEntity) {
    return faceVisible(table.state, c, me) ? c.config.front : null;
  }
</script>

{#if !(mat && !canSeeExistence(mat, me))}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={el}
    class="entity"
    class:locked={entity.locked}
    class:selected={table.isSelected(entity.id)}
    class:matlike={showHandles}
    class:hover-self={hoverSelf}
    class:priv-other={privLevel === 'other'}
    class:priv-mine={privLevel === 'mine'}
    style:left="{pos.x}px"
    style:top="{pos.y}px"
    style:z-index={z}
    data-entity-id={entity.id}
    data-drop={entity.kind === 'mat'
      ? `mat:${entity.id}`
      : entity.kind === 'token' || entity.kind === 'card'
        ? `item:${entity.id}`
        : undefined}
    onpointerdown={(e) => handlers.onGrab(e, entity)}
    ondblclick={(e) => handlers.onDouble(e, entity)}
    oncontextmenu={(e) => handlers.onMenu(e, entity)}
    onpointerenter={() => handlers.onHover(entity.id)}
    onpointerleave={() => handlers.onHover(null)}
    onpointerover={onOver}
    onpointerout={onOut}
  >
    {#if mat}
      {#if view === 'region'}
        <MatRegion
          {mat}
          privileged={isPrivileged}
          sizeOverride={fitSize}
          hovered={hoverSelf}
          onMove={(e) => handlers.onMatMove(e, entity)}
        >
          {#each items as child (child.id)}
            <Self entity={child} {handlers} />
          {/each}
        </MatRegion>
      {:else if view === 'collapsed'}
        <div class="chip" class:priv={isPrivileged}>
          {matLabel}{#if showCount}&nbsp;·
            {mat.config.supply === 'infinite' ? '∞' : stacked.length}{/if}
          {#if isPrivileged}<span class="eye">👁</span>{/if}
        </div>
      {:else if view === 'fan'}
        <div class="fan" class:priv={isPrivileged}>
          {#each stacked as child (child.id)}
            {#if child.kind === 'card'}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="fanslot"
                onpointerdown={(e) => {
                  e.stopPropagation();
                  handlers.onGhostGrab(e, child.id, mat.id);
                }}
              >
                <CardFaceView face={cardFace(child)} w={child.config.w} h={child.config.h} />
              </div>
            {/if}
          {/each}
          {#if stacked.length === 0}
            <div class="empty small">{mat.config.label}</div>
          {/if}
          {#if isPrivileged}<span class="eye badge-eye">👁</span>{/if}
          <span class="label">{matLabel}</span>
        </div>
      {:else}
        <!-- stack: 2+ items always show a second piece peeking out from
             behind the top, with a contrasting rim between them (M17) -->
        {@const second = stacked[1]}
        <div
          class="stack"
          class:priv={isPrivileged}
          style:min-width={mat.config.implicit ? undefined : '72px'}
          style:min-height={mat.config.implicit ? undefined : '100px'}
        >
          {#if stacked.length === 0}
            <div class="empty">{mat.config.label}</div>
          {:else}
            {#if stacked.length > 1}
              <div class="under">
                {#if second?.kind === 'token'}
                  <TokenView config={second.config} under />
                {:else if second?.kind === 'card'}
                  <CardFaceView w={second.config.w} h={second.config.h} />
                {/if}
              </div>
            {/if}
            {#if top?.kind === 'card'}
              <CardFaceView face={cardFace(top)} w={top.config.w} h={top.config.h} />
            {:else if top?.kind === 'token'}
              <TokenView config={top.config} />
            {/if}
            {#if showCount}
              <span class="count">{mat.config.supply === 'infinite' ? '∞' : stacked.length}</span>
            {/if}
            {#if isPrivileged}<span class="eye badge-eye">👁</span>{/if}
            <span class="label">{matLabel}</span>
          {/if}
        </div>
      {/if}
      {#if view !== 'region'}
        {#each loose as child (child.id)}
          <Self entity={child} {handlers} />
        {/each}
      {/if}
      {#if sum !== null && (sum !== 0 || !mat.config.implicit) && showCount}
        <span class="sumbadge" title="sum of {mat.config.showSum}">Σ {sum}</span>
      {/if}
      {#if mat.config.buttons?.length}
        <div class="matbtns">
          {#each mat.config.buttons as b (b.action)}
            <button
              onpointerdown={(e) => e.stopPropagation()}
              ondblclick={(e) => e.stopPropagation()}
              onclick={() => runMatButton(b.action, mat)}
            >
              {b.label ?? matButtonLabel(b.action)}
            </button>
          {/each}
        </div>
      {/if}
    {:else if entity.kind === 'token'}
      <TokenView config={entity.config} rot={entity.pos.rot} />
    {:else if entity.kind === 'dice'}
      <DiceView dice={entity} />
    {:else if entity.kind === 'counter'}
      <CounterView counter={entity} />
    {:else if entity.kind === 'scoreboard'}
      <ScoreboardView board={entity} />
    {:else if entity.kind === 'timer'}
      <TimerView timer={entity} />
    {:else if entity.kind === 'note'}
      <NoteView note={entity} />
    {:else if entity.kind === 'card'}
      <CardFaceView
        face={entity.state.faceUp ? entity.config.front : null}
        w={entity.config.w}
        h={entity.config.h}
      />
    {/if}
    {#if entity.annotation}
      <span class="anno" title={entity.annotation}>📝</span>
    {/if}
    {#if showHandles}
      <!-- ONE handle, bottom-center (M17) — the hover-button bar owns the top -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="mhandle h-s"
        data-handle="move"
        title="move the pile (or ⇧-drag it)"
        onpointerdown={(e) => handlers.onMatMove(e, entity)}
      ></div>
    {/if}
  </div>
{/if}

<style>
  .entity {
    position: absolute;
    touch-action: none;
    cursor: grab;
  }
  .entity.locked {
    cursor: default;
  }
  /* piles reveal their mat nature on hover: dotted outline + handle —
     only when THIS pile is the innermost hovered entity (M17) */
  .entity.matlike.hover-self {
    outline: 1.5px dashed rgba(255, 255, 255, 0.45);
    outline-offset: 4px;
    border-radius: 8px;
  }
  /* private mats: thick SOLID ring (dotted means ordinary, v4 §10);
     yours is extra thick and accented so ownership reads at a glance */
  .entity.priv-other,
  .entity.priv-mine {
    border-radius: 8px;
  }
  .entity.priv-other {
    box-shadow: 0 0 0 2.5px #8791a3;
  }
  .entity.priv-mine {
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 85%, #fff);
  }
  .entity.selected {
    outline: 2px solid #4da3ff;
    outline-offset: 3px;
    border-radius: 8px;
  }
  .mhandle {
    position: absolute;
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: rgba(77, 163, 255, 0.9);
    border: 1px solid rgba(255, 255, 255, 0.7);
    cursor: move;
    opacity: 0;
    transition: opacity 0.1s;
    z-index: 6;
  }
  .entity.hover-self > .mhandle {
    opacity: 1;
  }
  .h-s {
    bottom: -10px;
    left: 50%;
    transform: translateX(-50%);
  }
  .stack,
  .fan {
    position: relative;
  }
  /* the second piece peeks out clearly, with a contrasting rim (M17) */
  .under {
    position: absolute;
    left: 4px;
    top: 5px;
  }
  .under > :global(.face) {
    outline: 1.5px solid rgba(255, 255, 255, 0.75);
  }
  .stack > :global(.face) {
    position: relative;
  }
  .fan {
    display: flex;
    align-items: flex-end;
    min-height: 100px;
    min-width: 72px;
  }
  .fanslot {
    margin-left: -46px;
  }
  .fanslot:first-child {
    margin-left: 0;
  }
  .fanslot:hover {
    transform: translateY(-8px);
    z-index: 1;
    position: relative;
  }
  .empty {
    width: 72px;
    height: 100px;
    border: 2px dashed rgba(255, 255, 255, 0.35);
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(255, 255, 255, 0.55);
    font-size: 0.7rem;
    user-select: none;
    text-align: center;
  }
  .chip {
    background: var(--panel);
    border: 1px solid #454f60;
    border-radius: 14px;
    padding: 4px 12px;
    font-size: 0.75rem;
    user-select: none;
    white-space: nowrap;
  }
  .count {
    position: absolute;
    top: -8px;
    right: -8px;
    background: var(--panel);
    border: 1px solid #454f60;
    border-radius: 10px;
    padding: 1px 6px;
    font-size: 0.65rem;
    z-index: 1;
  }
  .label {
    position: absolute;
    bottom: -18px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 0.65rem;
    color: rgba(255, 255, 255, 0.6);
    white-space: nowrap;
    user-select: none;
  }
  /* privileged view: I can see more here than someone else can (SPEC §11) */
  .priv > :global(.face.front),
  .chip.priv,
  .fan.priv {
    outline: 2px dashed var(--accent);
    outline-offset: 2px;
  }
  .eye {
    font-size: 0.7rem;
  }
  .badge-eye {
    position: absolute;
    top: -10px;
    left: -10px;
    z-index: 2;
    filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.6));
  }
  .sumbadge {
    position: absolute;
    bottom: -9px;
    right: -8px;
    background: var(--panel);
    border: 1px solid #454f60;
    border-radius: 10px;
    padding: 0 6px;
    font-size: 0.62rem;
    color: var(--accent);
    z-index: 2;
    white-space: nowrap;
  }
  /* always-visible configurable buttons on the mat's edge (v4 §5) */
  .matbtns {
    position: absolute;
    top: 100%;
    left: 0;
    margin-top: 4px;
    display: flex;
    gap: 4px;
    z-index: 2;
  }
  .matbtns button {
    font-size: 0.65rem;
    padding: 1px 8px;
    background: rgba(30, 34, 43, 0.92);
    border: 1px solid #454f60;
    border-radius: 10px;
    color: var(--text);
    white-space: nowrap;
  }
  .matbtns button:hover {
    border-color: var(--accent);
  }
  /* annotation marker: hover for the text, edit via the context menu */
  .anno {
    position: absolute;
    top: -10px;
    right: -10px;
    z-index: 3;
    font-size: 0.75rem;
    filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.6));
    cursor: help;
  }
</style>
