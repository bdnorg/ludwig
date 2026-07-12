<script lang="ts">
  import type { CardEntity, Entity, MatEntity, ViewMode } from '../model/types';
  import { table } from '../state/store.svelte';
  import {
    canSeeCount,
    canSeeExistence,
    canSeeFaces,
    faceVisible,
    matItems,
    privileged,
    topItem,
  } from '../model/mats';
  import Self from './EntityView.svelte';
  import CardFaceView from './CardFaceView.svelte';
  import NoteView from './NoteView.svelte';
  import DiceView from './DiceView.svelte';
  import CounterView from './CounterView.svelte';
  import ScoreboardView from './ScoreboardView.svelte';
  import TimerView from './TimerView.svelte';
  import MatRegion from './MatRegion.svelte';

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
  const top = $derived(mat ? items[0] : undefined);
  const connectedIds = $derived([...new Set([me, ...Object.values(table.peers)])]);
  const isPrivileged = $derived(mat ? privileged(mat, me, connectedIds) : false);
  const showCount = $derived(mat ? canSeeCount(mat, me) : true);

  const view = $derived.by((): ViewMode | 'region' => {
    if (!mat) return 'auto';
    if (isRegion) return 'region';
    const pref = table.views[mat.id];
    if (pref && pref !== 'auto') return pref;
    // 'count' privacy: non-owners get the count chip, not the backs
    if (mat.config.privacy === 'count' && !canSeeFaces(mat, me)) return 'collapsed';
    if (mat.config.placement.type === 'fan') return canSeeFaces(mat, me) ? 'fan' : 'stack';
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

  // piles move by their hover handles; the body always takes the top item
  // (PROPOSAL v4 §2). Region mats carry their handles inside MatRegion.
  const showHandles = $derived(
    !entity.locked &&
      ((mat !== null && view !== 'region') ||
        (entity.kind === 'token' && (entity.state.count ?? 1) > 1)),
  );

  function cardFace(c: CardEntity) {
    return faceVisible(table.state, c, me) ? c.config.front : null;
  }
</script>

{#if !(mat && !canSeeExistence(mat, me))}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="entity"
    class:locked={entity.locked}
    class:selected={table.isSelected(entity.id)}
    class:matlike={showHandles}
    style:left="{pos.x}px"
    style:top="{pos.y}px"
    style:z-index={z}
    data-entity-id={entity.id}
    data-drop={entity.kind === 'mat'
      ? `mat:${entity.id}`
      : entity.kind === 'token'
        ? `token:${entity.id}`
        : undefined}
    onpointerdown={(e) => handlers.onGrab(e, entity)}
    ondblclick={(e) => handlers.onDouble(e, entity)}
    oncontextmenu={(e) => handlers.onMenu(e, entity)}
    onpointerenter={() => handlers.onHover(entity.id)}
    onpointerleave={() => handlers.onHover(null)}
  >
    {#if mat}
      {#if view === 'region'}
        <MatRegion {mat} privileged={isPrivileged} onMove={(e) => handlers.onMatMove(e, entity)}>
          {#each items as child (child.id)}
            <Self entity={child} {handlers} />
          {/each}
        </MatRegion>
      {:else if view === 'collapsed'}
        <div class="chip" class:priv={isPrivileged}>
          {matLabel}{#if showCount}&nbsp;· {items.length}{/if}
          {#if isPrivileged}<span class="eye">👁</span>{/if}
        </div>
      {:else if view === 'fan'}
        <div class="fan" class:priv={isPrivileged}>
          {#each items as child (child.id)}
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
          {#if items.length === 0}
            <div class="empty small">{mat.config.label}</div>
          {/if}
          {#if isPrivileged}<span class="eye badge-eye">👁</span>{/if}
          <span class="label">{matLabel}</span>
        </div>
      {:else}
        <!-- stack -->
        <div class="stack" class:priv={isPrivileged} style:min-width="72px" style:min-height="100px">
          {#if items.length === 0}
            <div class="empty">{mat.config.label}</div>
          {:else}
            {#if items.length > 1}
              <div class="under">
                {#if top?.kind === 'card'}
                  <CardFaceView w={top.config.w} h={top.config.h} />
                {/if}
              </div>
            {/if}
            {#if top?.kind === 'card'}
              <CardFaceView face={cardFace(top)} w={top.config.w} h={top.config.h} />
            {:else if top?.kind === 'token'}
              <div
                class="token"
                style:width="{top.config.size}px"
                style:height="{top.config.size}px"
                style:background={top.config.color}
              >
                {top.config.label}
              </div>
            {/if}
            {#if showCount}<span class="count">{items.length}</span>{/if}
            {#if isPrivileged}<span class="eye badge-eye">👁</span>{/if}
            <span class="label">{matLabel}</span>
          {/if}
        </div>
      {/if}
    {:else if entity.kind === 'token'}
      <div
        class="token"
        class:square={entity.config.shape === 'square'}
        class:hex={entity.config.shape === 'hex'}
        class:bar={entity.config.shape === 'bar'}
        style:width="{entity.config.size}px"
        style:height="{entity.config.shape === 'bar'
          ? Math.round(entity.config.size * 0.3)
          : entity.config.size}px"
        style:background={entity.config.color}
        style:transform={entity.pos.rot ? `rotate(${entity.pos.rot}deg)` : undefined}
      >
        {entity.config.label}
        {#if (entity.state.count ?? 1) > 1}
          <span class="stackbadge">×{entity.state.count}</span>
        {/if}
      </div>
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
      {#each ['n', 'e', 's', 'w'] as side (side)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="mhandle h-{side}"
          data-handle="move"
          title="move the pile"
          onpointerdown={(e) => handlers.onMatMove(e, entity)}
        ></div>
      {/each}
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
  /* piles reveal their mat nature on hover: dotted outline + handles */
  .entity.matlike:hover {
    outline: 1.5px dashed rgba(255, 255, 255, 0.45);
    outline-offset: 4px;
    border-radius: 8px;
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
  .entity:hover .mhandle {
    opacity: 1;
  }
  .h-n {
    top: -10px;
    left: 50%;
    transform: translateX(-50%);
  }
  .h-s {
    bottom: -10px;
    left: 50%;
    transform: translateX(-50%);
  }
  .h-e {
    right: -10px;
    top: 50%;
    transform: translateY(-50%);
  }
  .h-w {
    left: -10px;
    top: 50%;
    transform: translateY(-50%);
  }
  .token {
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.7rem;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.9);
    box-shadow:
      inset 0 -3px 0 rgba(0, 0, 0, 0.25),
      0 1px 3px rgba(0, 0, 0, 0.4);
    user-select: none;
    position: relative;
  }
  .token.square {
    border-radius: 4px;
  }
  .token.hex {
    border-radius: 0;
    clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%);
    box-shadow: none;
  }
  .token.bar {
    border-radius: 3px;
  }
  .stackbadge {
    position: absolute;
    top: -9px;
    right: -12px;
    background: var(--panel);
    border: 1px solid #454f60;
    border-radius: 10px;
    padding: 0px 5px;
    font-size: 0.6rem;
    color: var(--text);
  }
  .stack,
  .fan {
    position: relative;
  }
  .under {
    position: absolute;
    left: 2px;
    top: 2px;
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
