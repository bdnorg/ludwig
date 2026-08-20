<script lang="ts">
  // The tray is a LOCAL pinned view of ordinary mats (SPEC §15) — usually my
  // hand, but any mat can be pinned. It owns no objects: every card here is
  // an entity in a mat that also lives on the table.
  import type { MatEntity } from '../model/types';
  import { table } from '../state/store.svelte';
  import {
    canSeeExistence,
    describeRule,
    faceVisible,
    matCards,
    privileged,
  } from '../model/mats';
  import CardFaceView from './CardFaceView.svelte';
  import { setInspectHover } from '../state/inspect.svelte';

  let {
    onCardGrab,
  }: { onCardGrab: (e: PointerEvent, cardId: string, matId: string) => void } = $props();

  const me = $derived(table.me.id);
  const pinned = $derived(
    Object.values(table.state.entities).filter(
      (e): e is MatEntity => e.kind === 'mat' && table.isPinned(e.id) && canSeeExistence(e, me),
    ),
  );
  const connectedIds = $derived([...new Set([me, ...Object.values(table.peers)])]);

  // the tray itself is draggable screen chrome (v5 round 3): park it
  // anywhere; double-click its grip to re-dock bottom-center. Per browser.
  const TRAY_KEY = 'ludwig:tray';
  let trayEl: HTMLDivElement | undefined = $state();
  let trayPos = $state<{ x: number; y: number } | null>(
    (() => {
      try {
        return JSON.parse(localStorage.getItem(TRAY_KEY) ?? 'null');
      } catch {
        return null;
      }
    })(),
  );
  let trayDrag: { dx: number; dy: number } | null = null;
  function startTrayMove(e: PointerEvent) {
    if (!trayEl) return;
    const r = trayEl.getBoundingClientRect();
    trayDrag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    e.preventDefault();
    window.addEventListener('pointermove', onTrayMove);
    window.addEventListener('pointerup', onTrayUp);
  }
  function onTrayMove(e: PointerEvent) {
    if (!trayDrag) return;
    trayPos = {
      x: Math.max(0, Math.min(window.innerWidth - 80, e.clientX - trayDrag.dx)),
      y: Math.max(0, Math.min(window.innerHeight - 60, e.clientY - trayDrag.dy)),
    };
  }
  function onTrayUp() {
    trayDrag = null;
    window.removeEventListener('pointermove', onTrayMove);
    window.removeEventListener('pointerup', onTrayUp);
    localStorage.setItem(TRAY_KEY, JSON.stringify(trayPos));
  }
  function redock() {
    trayPos = null;
    localStorage.removeItem(TRAY_KEY);
  }

  function toggleReveal(mat: MatEntity) {
    const rule = mat.config.visibility.faces === 'public' ? 'owner' : 'public';
    table.update(mat, (m) => {
      m.config.visibility.faces = rule;
      m.config.privacy = rule === 'public' ? 'public' : 'backs';
    });
    table.logMsg(
      `${table.playerName(me)} set “${mat.config.label}” faces visible to ${describeRule(rule)}`,
    );
  }
</script>

{#if pinned.length > 0}
  <div
    bind:this={trayEl}
    class="tray"
    class:floating={trayPos !== null}
    style:left={trayPos ? `${trayPos.x}px` : undefined}
    style:top={trayPos ? `${trayPos.y}px` : undefined}
    data-drop="tray"
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="grab"
      title="drag to move the tray · double-click to re-dock"
      onpointerdown={startTrayMove}
      ondblclick={redock}
    >
      ⠿
    </div>
    {#each pinned as mat (mat.id)}
      {@const cards = matCards(table.state, mat)}
      {@const priv = privileged(mat, me, connectedIds)}
      {@const revealed = mat.config.visibility.faces === 'public'}
      <div class="pinmat" class:priv data-tray-mat={mat.id}>
        <div class="side">
          <span class="title">
            {mat.config.ownerId === me ? 'your' : ''}
            {mat.config.label}
            {#if priv}👁{/if}
          </span>
          {#if mat.config.ownerId === me}
            <button class="tiny" onclick={() => toggleReveal(mat)}>
              {revealed ? 'conceal' : 'reveal all'}
            </button>
            {#if revealed}<span class="warn">visible to everyone</span>{/if}
          {/if}
          <button class="tiny" title="show on the table instead" onclick={() => table.setPin(mat.id, false)}>
            unpin
          </button>
        </div>
        <div class="cards">
          {#each cards as card (card.id)}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="slot"
              data-card-id={card.id}
              onpointerdown={(e) => onCardGrab(e, card.id, mat.id)}
              onpointerenter={() => setInspectHover(card.id)}
              onpointerleave={() => setInspectHover(null)}
            >
              <CardFaceView
                face={faceVisible(table.state, card, me) ? card.config.front : null}
                w={card.config.w}
                h={card.config.h}
              />
            </div>
          {:else}
            <span class="hint">drag cards here, or draw from a deck — drag out to play (⇧ flips)</span>
          {/each}
        </div>
      </div>
    {/each}
  </div>
{/if}

<style>
  .tray {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    bottom: 0;
    max-width: 94%;
    display: flex;
    gap: 10px;
    align-items: flex-end;
    z-index: 200000;
  }
  /* parked somewhere by its grip: fixed at that spot, fully rounded */
  .tray.floating {
    position: fixed;
    transform: none;
    bottom: auto;
  }
  .tray.floating .pinmat {
    border-radius: 10px;
    border-bottom: 1px solid #454f60;
  }
  .grab {
    align-self: stretch;
    display: flex;
    align-items: center;
    padding: 0 4px;
    color: var(--muted);
    background: rgba(30, 34, 43, 0.92);
    border: 1px solid #454f60;
    border-radius: 8px 0 0 8px;
    cursor: move;
    user-select: none;
    touch-action: none;
  }
  .pinmat {
    min-width: 340px;
    background: rgba(30, 34, 43, 0.92);
    border: 1px solid #454f60;
    border-bottom: none;
    border-radius: 10px 10px 0 0;
    padding: 8px 14px 10px;
    display: flex;
    gap: 14px;
    align-items: center;
  }
  /* my private mat: thick solid accent, same language as on the table (v4 §10) */
  .pinmat.priv {
    border-color: var(--accent);
    border-width: 3px;
    border-style: solid;
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
