<script lang="ts">
  // One dialog for everything a mat IS (SPEC §15): label, color, placement
  // (incl. hex grid), entry rule, privacy preset. Replaces the scattered
  // context-menu items. Works on the root table mat too (privacy hidden —
  // the table has no owner).
  import type { MatEntity, MatPrivacy } from '../model/types';
  import { describeRule, privacyVisibility, ROOT_MAT_ID } from '../model/mats';
  import { table } from '../state/store.svelte';

  let { mat, onClose }: { mat: MatEntity; onClose: () => void } = $props();

  // the dialog is keyed by mat id and edits a snapshot of the config, so
  // capturing initial values here is intended
  // svelte-ignore state_referenced_locally
  const isRoot = mat.id === ROOT_MAT_ID;
  // svelte-ignore state_referenced_locally
  const cur = mat.config.placement;

  type PlacementChoice = 'free' | 'grid' | 'hexgrid' | 'stack' | 'fan' | 'slots';
  function inferPrivacy(m: MatEntity): MatPrivacy {
    if (m.config.privacy) return m.config.privacy;
    const v = m.config.visibility;
    if (v.faces === 'public') return 'public';
    if (v.existence !== 'public') return 'nothing';
    return 'backs';
  }

  // svelte-ignore state_referenced_locally
  let label = $state(mat.config.label);
  // svelte-ignore state_referenced_locally
  let color = $state(mat.config.color ?? '');
  let placement = $state<PlacementChoice>(
    cur.type === 'grid' ? (cur.grid?.hex ? 'hexgrid' : 'grid') : cur.type,
  );
  let gridSize = $state(cur.grid?.size ?? 40);
  // svelte-ignore state_referenced_locally
  let faceDefault = $state(mat.config.faceDefault);
  // svelte-ignore state_referenced_locally
  let privacy = $state<MatPrivacy>(inferPrivacy(mat));
  // svelte-ignore state_referenced_locally
  let buttonsText = $state(
    (mat.config.buttons ?? []).map((b) => (b.label ? `${b.label}:${b.action}` : b.action)).join(', '),
  );
  // svelte-ignore state_referenced_locally
  let showSum = $state(mat.config.showSum ?? '');

  const COLORS: Array<[string, string]> = [
    ['none', ''],
    ['green', '#2c5138'],
    ['blue', '#2b3f5e'],
    ['red', '#5e3131'],
    ['wood', '#4d3d27'],
    ['slate', '#33363e'],
  ];
  const PRIVACY_LABEL: Record<MatPrivacy, string> = {
    public: 'public — everyone sees faces',
    backs: 'private — others see backs',
    count: 'private — others see a count',
    nothing: 'private — others see nothing',
  };

  function save() {
    const privacyBefore = inferPrivacy(mat);
    const changedPrivacy = !isRoot && privacy !== privacyBefore;
    table.update(mat, (m) => {
      m.config.label = label.trim() || m.config.label;
      m.config.color = color || null;
      if (placement !== 'slots') {
        const g = Math.max(10, Math.min(400, Math.round(gridSize) || 40));
        m.config.placement =
          placement === 'grid'
            ? { type: 'grid', grid: { size: g } }
            : placement === 'hexgrid'
              ? { type: 'grid', grid: { size: g, hex: true } }
              : { type: placement };
        // region placements need an extent; stacks/fans auto-size
        if (['free', 'grid'].includes(placement) && !m.config.size && !isRoot)
          m.config.size = { w: 300, h: 220 };
      }
      m.config.faceDefault = faceDefault;
      if (!isRoot) {
        const btns = buttonsText
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
          .map((t) => {
            const i = t.indexOf(':');
            return i > 0 ? { label: t.slice(0, i).trim(), action: t.slice(i + 1).trim() } : { action: t };
          });
        m.config.buttons = btns.length > 0 ? btns : undefined;
        m.config.showSum = showSum.trim() || undefined;
      }
      if (changedPrivacy) {
        m.config.privacy = privacy;
        m.config.visibility = privacyVisibility(privacy);
        if (privacy !== 'public' && !m.config.ownerId) m.config.ownerId = table.me.id;
      }
    });
    if (changedPrivacy) {
      const now = table.get(mat.id) as MatEntity;
      table.logMsg(
        `${table.playerName(table.me.id)} set “${now.config.label}” faces visible to ${describeRule(now.config.visibility.faces)}${privacy === 'nothing' ? ' (hidden)' : ''}`,
      );
    }
    onClose();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="backdrop" onpointerdown={onClose}></div>
<div class="dialog">
  <h3>{isRoot ? 'Table settings' : 'Mat settings'}</h3>

  <label>
    Label
    <input data-field="label" bind:value={label} maxlength="40" />
  </label>

  <div class="field">
    <span>{isRoot ? 'Felt color' : 'Color'}</span>
    <div class="swatches">
      {#each COLORS as [name, c] (name)}
        <button
          class="swatch"
          class:selected={color === c}
          style:background={c || 'transparent'}
          title={name}
          onclick={() => (color = c)}
        >
          {c ? '' : '∅'}
        </button>
      {/each}
    </div>
  </div>

  <label>
    Placement
    <select data-field="placement" bind:value={placement}>
      <option value="free">free — pieces stay where dropped</option>
      <option value="grid">grid — snap to squares</option>
      <option value="hexgrid">hex grid — snap to hex centers</option>
      {#if !isRoot}
        <option value="stack">stack — one pile</option>
        <option value="fan">fan — spread like a hand</option>
        {#if cur.type === 'slots'}<option value="slots">slots (board)</option>{/if}
      {/if}
    </select>
  </label>
  {#if placement === 'grid' || placement === 'hexgrid'}
    <label>
      Grid size
      <input type="number" bind:value={gridSize} min="10" max="400" />
    </label>
  {/if}

  <label>
    Cards entering
    <select data-field="face" bind:value={faceDefault}>
      <option value="keep">keep their face</option>
      <option value="up">flip face up</option>
      <option value="down">flip face down</option>
    </select>
  </label>

  {#if !isRoot}
    <label>
      Buttons (action ids, e.g. draw, shuffle, roll-all-dice, flip-all-cards)
      <input data-field="buttons" bind:value={buttonsText} placeholder="none" />
    </label>
    <label>
      Show sum of value (e.g. "value" for a chip pot)
      <input data-field="showsum" bind:value={showSum} placeholder="none" />
    </label>
    <label>
      Privacy
      <select data-field="privacy" bind:value={privacy}>
        {#each Object.entries(PRIVACY_LABEL) as [value, text] (value)}
          <option {value}>{text}</option>
        {/each}
      </select>
    </label>
    {#if privacy !== 'public'}
      <p class="hint">
        owner: {table.playerName(mat.config.ownerId ?? table.me.id)} — changes are logged for
        everyone
      </p>
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
    top: 14vh;
    left: 50%;
    transform: translateX(-50%);
    width: 22rem;
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
  label,
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 0.75rem;
    color: var(--muted);
  }
  input,
  select {
    font-size: 0.85rem;
  }
  .swatches {
    display: flex;
    gap: 6px;
  }
  .swatch {
    width: 26px;
    height: 26px;
    border-radius: 6px;
    border: 1px solid #454f60;
    padding: 0;
    color: var(--muted);
  }
  .swatch.selected {
    outline: 2px solid var(--accent);
  }
  .hint {
    margin: -4px 0 0;
    font-size: 0.68rem;
    color: var(--muted);
  }
  .row {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    margin-top: 4px;
  }
</style>
