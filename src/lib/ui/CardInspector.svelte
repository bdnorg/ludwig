<script lang="ts">
  // The inspector (v5): a fixed panel showing the hovered card at readable
  // size, with its full rules text. Small faces show title + badges only;
  // this is where the body text lives. Hover any card ~a third of a second,
  // or press `v` to pin it open. Shows only faces the viewer may see.
  import { table } from '../state/store.svelte';
  import { inspect } from '../state/inspect.svelte';
  import { faceVisible } from '../model/mats';
  import CardFaceView from './CardFaceView.svelte';

  const SCALE = 2.7;
  const DELAY_MS = 320;

  // hover target debounced: appearing instantly on every pass would flicker
  let shownHoverId = $state<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const id = inspect.hoverId;
    clearTimeout(timer);
    if (!id) {
      shownHoverId = null;
    } else {
      timer = setTimeout(() => (shownHoverId = id), DELAY_MS);
    }
  });

  const card = $derived.by(() => {
    const id = inspect.pinnedId ?? shownHoverId;
    const e = id ? table.get(id) : null;
    return e?.kind === 'card' ? e : null;
  });
  // never reveal what the viewer isn't entitled to
  const face = $derived(
    card && faceVisible(table.state, card, table.me.id) ? card.config.front : null,
  );
</script>

{#if card && face}
  <div class="inspector" class:pinned={inspect.pinnedId}>
    <CardFaceView
      {face}
      w={card.config.w * SCALE}
      h={card.config.h * SCALE}
      detail
      fontScale={SCALE * 0.95}
    />
    <span class="hint">{inspect.pinnedId ? 'v unpins' : 'v pins'}</span>
  </div>
{/if}

<style>
  .inspector {
    position: fixed;
    right: 14px;
    top: 60px;
    z-index: 250000;
    pointer-events: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    filter: drop-shadow(0 4px 14px rgba(0, 0, 0, 0.55));
  }
  .inspector.pinned {
    outline: 2px solid var(--accent);
    outline-offset: 4px;
    border-radius: 8px;
  }
  .hint {
    font-size: 0.62rem;
    color: var(--muted);
    background: rgba(30, 34, 43, 0.85);
    border-radius: 5px;
    padding: 1px 7px;
  }
</style>
