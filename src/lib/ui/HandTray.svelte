<script lang="ts">
  import { table } from '../state/store.svelte';
  import { describeRule, matCards } from '../model/mats';
  import CardFaceView from './CardFaceView.svelte';

  let { onCardGrab }: { onCardGrab: (e: PointerEvent, cardId: string) => void } = $props();

  const hand = $derived(table.myHand());
  const cards = $derived(matCards(table.state, hand));
  const revealed = $derived(hand.config.visibility.faces === 'public');

  function toggleReveal() {
    const rule = revealed ? 'owner' : 'public';
    table.update(hand, (h) => {
      h.config.visibility.faces = rule;
    });
    table.logMsg(
      `${table.playerName(table.me.id)} set “Hand” faces visible to ${describeRule(rule)}`,
    );
  }
</script>

<div class="tray" class:priv={!revealed} data-drop="tray">
  <div class="side">
    <span class="title">your hand {revealed ? '' : '👁'}</span>
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
      <span class="hint">drag cards here, or draw from a deck — drag out to play (⇧ flips)</span>
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
  /* privileged view: only I can see these faces (SPEC §11) */
  .tray.priv {
    border-color: color-mix(in srgb, var(--accent) 60%, #454f60);
    border-style: dashed;
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
