<script lang="ts">
  // Item settings (v4 §4) — the sibling of Mat settings for every item
  // kind. Values are named numbers; chips carry label AND value; nothing
  // like "20 × $5 chips" is hardcoded anywhere anymore.
  import type { Entity } from '../model/types';
  import { table } from '../state/store.svelte';

  let { item, onClose }: { item: Entity; onClose: () => void } = $props();

  // the dialog is keyed by item id; capturing initial values is intended
  // svelte-ignore state_referenced_locally
  const kind = item.kind;
  // svelte-ignore state_referenced_locally
  const snap = $state.snapshot(item);
  const cfg = snap.config as Record<string, unknown>;

  let label = $state((cfg.label as string) ?? '');
  let color = $state((cfg.color as string) ?? '#e4573d');
  let shape = $state((cfg.shape as string) ?? 'disc');
  let size = $state((cfg.size as number) ?? 28);
  let value = $state(((cfg.values as Record<string, number>)?.value as number) ?? 0);
  let sides = $state((cfg.sides as number) ?? 6);
  let counterValue = $state(snap.kind === 'counter' ? snap.state.value : 0);
  const front = (cfg.front ?? {}) as Record<string, string | undefined>;
  let title = $state(front.title ?? front.corner ?? '');
  let body = $state(front.body ?? '');
  let sub = $state(front.sub ?? '');
  let cardColor = $state(front.color ?? '#4a4f58');

  function save() {
    const it = table.get(item.id);
    if (!it) return onClose();
    table.update(it, (d) => {
      if (d.kind === 'token') {
        d.config.label = label;
        d.config.color = color;
        d.config.shape = shape as typeof d.config.shape;
        d.config.size = Math.max(10, Math.min(200, Math.round(size) || 28));
        if (value) d.config.values = { ...d.config.values, value };
        else if (d.config.values) delete d.config.values.value;
      } else if (d.kind === 'dice') {
        d.config.sides = Math.max(2, Math.min(1000, Math.round(sides) || 6));
      } else if (d.kind === 'card') {
        // house cards: text faces are editable in place
        d.config.front = { ...d.config.front, title, body, sub, color: cardColor };
        delete d.config.front.corner;
        delete d.config.front.center;
      } else if (d.kind === 'counter') {
        d.config.label = label;
        if (Number.isFinite(counterValue)) d.state.value = counterValue;
      } else if (d.kind === 'scoreboard') {
        d.config.label = label;
      }
    });
    onClose();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="backdrop" onpointerdown={onClose}></div>
<div class="dialog">
  <h3>Item settings — {kind}</h3>

  {#if kind === 'token'}
    <label>Label <input data-field="label" bind:value={label} maxlength="12" /></label>
    <label>
      Value (chips: their worth — stacks show the total)
      <input data-field="value" type="number" bind:value={value} />
    </label>
    <div class="row2">
      <label>
        Shape
        <select data-field="shape" bind:value={shape}>
          <option value="disc">disc</option>
          <option value="square">square</option>
          <option value="hex">hex</option>
          <option value="bar">bar</option>
        </select>
      </label>
      <label>Size <input type="number" min="10" max="200" bind:value={size} /></label>
    </div>
    <label>Color <input type="color" bind:value={color} /></label>
  {:else if kind === 'dice'}
    <label>Sides <input data-field="sides" type="number" min="2" max="1000" bind:value={sides} /></label>
  {:else if kind === 'card'}
    <label>Title <input data-field="title" bind:value={title} maxlength="40" /></label>
    <label>Text <textarea bind:value={body} rows="3"></textarea></label>
    <label>Bottom line <input bind:value={sub} maxlength="40" /></label>
    <label>Accent color <input type="color" bind:value={cardColor} /></label>
  {:else if kind === 'counter' || kind === 'scoreboard'}
    <label>Label <input data-field="label" bind:value={label} maxlength="30" /></label>
    {#if kind === 'counter'}
      <label>Value <input data-field="cvalue" type="number" bind:value={counterValue} /></label>
    {/if}
  {/if}

  <div class="row">
    <button class="primary" onclick={save}>Save</button>
    <button onclick={onClose}>Cancel</button>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 300000;
    background: rgba(0, 0, 0, 0.3);
  }
  .dialog {
    position: fixed;
    top: 16vh;
    left: 50%;
    transform: translateX(-50%);
    width: 20rem;
    max-width: 90vw;
    background: var(--panel);
    border: 1px solid #454f60;
    border-radius: 10px;
    z-index: 300001;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.55);
  }
  h3 {
    margin: 0 0 2px;
    font-size: 1rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 0.75rem;
    color: var(--muted);
  }
  input,
  select,
  textarea {
    font-size: 0.85rem;
  }
  textarea {
    resize: vertical;
    background: var(--panel-2);
    color: var(--text);
    border: 1px solid #454f60;
    border-radius: 5px;
    padding: 4px 6px;
  }
  .row2 {
    display: flex;
    gap: 10px;
  }
  .row2 label {
    flex: 1;
  }
  .row {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    margin-top: 4px;
  }
</style>
