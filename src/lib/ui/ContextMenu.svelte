<script lang="ts">
  import type { MenuItem } from './menu';

  let {
    x,
    y,
    items,
    onClose,
  }: { x: number; y: number; items: MenuItem[]; onClose: () => void } = $props();

  // keep the menu on screen
  const left = $derived(Math.min(x, window.innerWidth - 190));
  const top = $derived(Math.min(y, window.innerHeight - items.length * 30 - 16));
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="backdrop"
  onpointerdown={onClose}
  oncontextmenu={(e) => {
    e.preventDefault();
    onClose();
  }}
></div>
<div class="menu" style:left="{left}px" style:top="{top}px">
  {#each items as item (item.label)}
    <button
      class:danger={item.danger}
      onclick={() => {
        onClose();
        item.run();
      }}
    >
      {item.label}
    </button>
  {/each}
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 300000;
  }
  .menu {
    position: fixed;
    z-index: 300001;
    background: var(--panel);
    border: 1px solid #454f60;
    border-radius: 8px;
    padding: 4px;
    display: flex;
    flex-direction: column;
    min-width: 170px;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5);
  }
  button {
    background: none;
    border: none;
    text-align: left;
    padding: 6px 10px;
    border-radius: 5px;
    font-size: 0.85rem;
  }
  button:hover {
    background: var(--panel-2);
  }
  button.danger {
    color: #e4573d;
  }
</style>
