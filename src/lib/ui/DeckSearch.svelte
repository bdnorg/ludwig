<script lang="ts">
  import type { DeckEntity } from '../model/types';
  import { table } from '../state/store.svelte';
  import { containerCards } from '../model/containers';
  import { takeToHand, shuffleDeck } from '../model/ops';
  import CardFaceView from './CardFaceView.svelte';

  let { deck, onClose }: { deck: DeckEntity; onClose: () => void } = $props();

  const cards = $derived(containerCards(table.state, deck));

  function take(cardId: string) {
    const card = table.get(cardId);
    if (card?.kind === 'card') table.commit(takeToHand(table, card, table.myHand()));
  }
</script>

<div class="backdrop">
  <div class="modal">
    <header>
      <strong>{deck.config.label}</strong>
      <span class="note">searching a deck is a public act — shuffle when you're done</span>
      <button onclick={() => table.commit(shuffleDeck(table, deck))}>Shuffle</button>
      <button onclick={onClose}>Close</button>
    </header>
    <div class="grid">
      {#each cards as card (card.id)}
        <button class="cardbtn" title="Take to hand" onclick={() => take(card.id)}>
          <CardFaceView face={card.config.front} w={card.config.w} h={card.config.h} />
        </button>
      {:else}
        <p class="note">deck is empty</p>
      {/each}
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    z-index: 300000;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .modal {
    background: var(--panel);
    border: 1px solid #454f60;
    border-radius: 10px;
    max-width: 720px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    padding: 14px;
    gap: 12px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  header button:last-child {
    margin-left: auto;
  }
  .note {
    color: var(--muted);
    font-size: 0.75rem;
  }
  .grid {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    overflow-y: auto;
  }
  .cardbtn {
    background: none;
    border: none;
    padding: 0;
    border-radius: 6px;
  }
  .cardbtn:hover {
    outline: 2px solid var(--accent);
  }
</style>
