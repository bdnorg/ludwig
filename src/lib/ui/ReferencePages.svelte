<script lang="ts">
  // Read-only reference/rules panel (SPEC §13): a gamebox's `reference`
  // pages, carried on the root mat's config, "readable in a panel without
  // spawning anything." No editing UI — a gamebox is pure config, and this
  // is the viewer for the one part of it that's prose, not layout.
  import type { ReferencePage } from '../model/types';

  let { pages, onClose }: { pages: ReferencePage[]; onClose: () => void } = $props();

  let activeIdx = $state(0);
  const active = $derived(pages[activeIdx] ?? pages[0]);

  // A small markdown-ish reader, not a parser: headings, bullets, blank-line
  // paragraphs. Text renders through Svelte's normal interpolation (never
  // {@html}) so an uploaded gamebox's prose can't inject markup.
  type Block = { type: 'h1' | 'h2' | 'li' | 'p'; text: string };
  function blocks(md: string): Block[] {
    const out: Block[] = [];
    for (const raw of md.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('## ')) out.push({ type: 'h2', text: line.slice(3) });
      else if (line.startsWith('# ')) out.push({ type: 'h1', text: line.slice(2) });
      else if (line.startsWith('- ') || line.startsWith('* ')) out.push({ type: 'li', text: line.slice(2) });
      else out.push({ type: 'p', text: line });
    }
    return out;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="backdrop" onpointerdown={onClose}></div>
<div class="dialog">
  <div class="head">
    <h3>{active?.title ?? 'Reference'}</h3>
    <button class="close" onclick={onClose} title="close">✕</button>
  </div>

  {#if pages.length > 1}
    <div class="tabs">
      {#each pages as p, i (p.title + i)}
        <button class="tab" class:active={i === activeIdx} onclick={() => (activeIdx = i)}>
          {p.title}
        </button>
      {/each}
    </div>
  {/if}

  <div class="body">
    {#if active}
      {#each blocks(active.md) as b, i (i)}
        {#if b.type === 'h1'}
          <h4>{b.text}</h4>
        {:else if b.type === 'h2'}
          <h5>{b.text}</h5>
        {:else if b.type === 'li'}
          <div class="li">• {b.text}</div>
        {:else}
          <p>{b.text}</p>
        {/if}
      {/each}
    {/if}
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
    top: 12vh;
    left: 50%;
    transform: translateX(-50%);
    width: 30rem;
    max-width: 92vw;
    max-height: 72vh;
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
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  h3 {
    margin: 0;
    font-size: 1rem;
  }
  .close {
    font-size: 0.8rem;
    color: var(--muted);
    background: none;
    border: none;
    padding: 2px 6px;
  }
  .close:hover {
    color: var(--text);
  }
  .tabs {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
    border-bottom: 1px solid #454f60;
    padding-bottom: 8px;
  }
  .tab {
    font-size: 0.75rem;
    color: var(--muted);
    background: none;
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 3px 8px;
  }
  .tab.active {
    color: var(--text);
    border-color: #454f60;
    background: var(--panel-2);
  }
  .body {
    overflow-y: auto;
    line-height: 1.5;
    font-size: 0.85rem;
  }
  .body h4 {
    margin: 0.6rem 0 0.2rem;
    font-size: 0.95rem;
    color: var(--accent);
  }
  .body h4:first-child {
    margin-top: 0;
  }
  .body h5 {
    margin: 0.5rem 0 0.2rem;
    font-size: 0.85rem;
    color: var(--text);
  }
  .body p {
    margin: 0.4rem 0;
    color: var(--text);
  }
  .body .li {
    margin: 0.15rem 0 0.15rem 0.4rem;
    color: var(--text);
  }
</style>
