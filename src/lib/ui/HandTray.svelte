<script lang="ts">
  import { table } from '../state/store.svelte';
  import { containerCards } from '../model/containers';
  import CardFaceView from './CardFaceView.svelte';

  let { onCardGrab }: { onCardGrab: (e: PointerEvent, cardId: string) => void } = $props();

  const hand = $derived(table.myHand());
  const cards = $derived(containerCards(table.state, hand));
  const revealed = $derived(hand.state.revealedTo === 'all');

  function toggleReveal() {
    table.update(hand, (h) => {
      h.state.revealedTo = h.state.revealedTo === 'all' ? [] : 'all';
    });
  }
</script>

<div class="tray" data-drop="tray">
  <div class="side">
    <span class="title">your hand</span>
    <button class="tiny" onclick={toggleReveal}>{revealed ? 'conceal' : 'reveal all'}</button>
    {#if revealed}<span class="warn">visible to everyone</span>{/if}
  </div>
  <div class="cards">
    {#each cards as card (card.id)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="slot" onpointerdown={(e) => onCardGrab(e, card.id)}>
        <CardFaceView face={card.config.front} w={card.config.w} h={card.config.h} />
      </div>
    {:else}
      <span class="hint">drag cards here, or draw from a deck — drag out to play (⇧ plays face down)</span>
    {/each}
  </div>
</div>

<style>
  .tray {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    bottom: 0;
    min-width: 340px;
    max-width: 90%;
    background: rgba(30, 34, 43, 0.92);
    border: 1px solid #454f60;
    border-bottom: none;
    border-radius: 10px 10px 0 0;
    padding: 8px 14px 10px;
    display: flex;
    gap: 14px;
    align-items: center;
    z-index: 200000;
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: 4px;
    align-items: flex-start;
    min-width: 74px;
  }
  .title {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--muted);
  }
  .tiny {
    font-size: 0.65rem;
    padding: 2px 6px;
  }
  .warn {
    font-size: 0.6rem;
    color: var(--accent);
  }
  .cards {
    display: flex;
    align-items: flex-end;
    min-height: 104px;
  }
  .slot {
    margin-left: -28px;
    cursor: grab;
    transition: transform 0.08s;
    touch-action: none;
  }
  .slot:first-child {
    margin-left: 0;
  }
  .slot:hover {
    transform: translateY(-10px);
    z-index: 1;
    position: relative;
  }
  .hint {
    color: var(--muted);
    font-size: 0.75rem;
    align-self: center;
  }
</style>
