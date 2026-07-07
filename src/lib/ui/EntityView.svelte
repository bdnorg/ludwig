<script lang="ts">
  import type { Entity } from '../model/types';
  import { table } from '../state/store.svelte';
  import { containerCards, topCard } from '../model/containers';
  import CardFaceView from './CardFaceView.svelte';
  import NoteView from './NoteView.svelte';

  type Handler = (e: PointerEvent | MouseEvent, ent: Entity) => void;
  let {
    entity,
    onGrab,
    onDouble,
    onMenu,
  }: { entity: Entity; onGrab: Handler; onDouble: Handler; onMenu: Handler } = $props();

  const pos = $derived(table.dragPos[entity.id] ?? entity.pos);
  const z = $derived(table.dragPos[entity.id] ? 100000 : entity.pos.z);

  const deckCards = $derived(entity.kind === 'deck' ? containerCards(table.state, entity) : []);
  const deckTop = $derived(entity.kind === 'deck' ? topCard(table.state, entity) : undefined);
  const deckShowsFront = $derived(
    entity.kind === 'deck' &&
      deckTop !== undefined &&
      (entity.config.facePolicy === 'up' || deckTop.state.faceUp),
  );
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="entity"
  class:locked={entity.locked}
  style:left="{pos.x}px"
  style:top="{pos.y}px"
  style:z-index={z}
  data-entity-id={entity.id}
  data-drop={entity.kind === 'deck' ? `deck:${entity.id}` : undefined}
  onpointerdown={(e) => onGrab(e, entity)}
  ondblclick={(e) => onDouble(e, entity)}
  oncontextmenu={(e) => onMenu(e, entity)}
>
  {#if entity.kind === 'token'}
    <div
      class="token"
      class:square={entity.config.shape === 'square'}
      style:width="{entity.config.size}px"
      style:height="{entity.config.size}px"
      style:background={entity.config.color}
    >
      {entity.config.label}
    </div>
  {:else if entity.kind === 'note'}
    <NoteView note={entity} />
  {:else if entity.kind === 'card'}
    <CardFaceView
      face={entity.state.faceUp ? entity.config.front : null}
      w={entity.config.w}
      h={entity.config.h}
    />
  {:else if entity.kind === 'deck'}
    <div class="deck" style:width="{entity.config.w}px" style:height="{entity.config.h}px">
      {#if deckCards.length === 0}
        <div class="empty" style:width="{entity.config.w}px" style:height="{entity.config.h}px">
          {entity.config.label}
        </div>
      {:else}
        {#if deckCards.length > 1}
          <div class="under"><CardFaceView w={entity.config.w} h={entity.config.h} /></div>
        {/if}
        <CardFaceView
          face={deckShowsFront ? deckTop?.config.front : null}
          w={entity.config.w}
          h={entity.config.h}
        />
        <span class="count">{deckCards.length}</span>
        <span class="label">{entity.config.label}</span>
      {/if}
    </div>
  {/if}
</div>

<style>
  .entity {
    position: absolute;
    touch-action: none;
    cursor: grab;
  }
  .entity.locked {
    cursor: default;
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
  }
  .token.square {
    border-radius: 4px;
  }
  .deck {
    position: relative;
  }
  .under {
    position: absolute;
    left: 2px;
    top: 2px;
  }
  .deck > :global(.face) {
    position: relative;
  }
  .empty {
    border: 2px dashed rgba(255, 255, 255, 0.35);
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(255, 255, 255, 0.55);
    font-size: 0.7rem;
    user-select: none;
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
</style>
