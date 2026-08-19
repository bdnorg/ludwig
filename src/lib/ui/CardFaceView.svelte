<script lang="ts">
  import type { CardFace } from '../model/types';

  let {
    face = null,
    w,
    h,
    detail = false,
    fontScale = 1,
  }: {
    face?: CardFace | null;
    w: number;
    h: number;
    /** inspector rendering: flow layout with the full body text */
    detail?: boolean;
    /** multiplies every font size (detail view renders crisp, not zoomed) */
    fontScale?: number;
  } = $props();

  // badges present → the small face shows title + art + badges only; the
  // body text belongs to the inspector (v5: readable at arm's length)
  const summary = $derived(!detail && !!face?.badges?.length);
</script>

{#if face}
  <div
    class="face front"
    style:width="{w}px"
    style:height="{h}px"
    style:color={face.color ?? '#222'}
    style:font-size="{16 * fontScale}px"
  >
    {#if detail}
      <div class="detail">
        {#if face.title || face.corner}<span class="dtitle">{face.title ?? face.corner}</span>{/if}
        {#if face.image}<img class="dart" src={face.image} alt="" draggable="false" />{/if}
        {#if face.badges?.length}
          <div class="dbadges">
            {#each face.badges as b (b)}<span class="pill">{b}</span>{/each}
          </div>
        {/if}
        {#if face.body}<span class="dbody">{face.body}</span>{/if}
        {#if face.center && !face.title}<span class="dcenter">{face.center}</span>{/if}
        {#if face.sub}<span class="dsub">{face.sub}</span>{/if}
      </div>
    {:else if summary}
      <span class="title big">{face.title}</span>
      {#if face.image}<img class="art" src={face.image} alt="" draggable="false" />{/if}
      <!-- only a SHORT lone badge ("$2", "3 VP") gets the poker-face size -->
      <div class="badges" class:solo={face.badges!.length === 1 && face.badges![0].length <= 6}>
        {#each face.badges ?? [] as b (b)}<span class="bline">{b}</span>{/each}
      </div>
      {#if face.sub}<span class="sub">{face.sub}</span>{/if}
    {:else if face.image && (face.title || face.body)}
      <span class="title">{face.title}</span>
      <img class="art" src={face.image} alt="" draggable="false" />
      <span class="body arted">{face.body}</span>
      {#if face.sub}<span class="sub">{face.sub}</span>{/if}
    {:else if face.image}
      <img src={face.image} alt={face.title ?? face.corner ?? 'card'} draggable="false" />
    {:else if face.title || face.body}
      <span class="title">{face.title}</span>
      <span class="body">{face.body}</span>
      {#if face.sub}<span class="sub">{face.sub}</span>{/if}
    {:else}
      <span class="corner tl">{face.corner}</span>
      <span class="center">{face.center}</span>
      <span class="corner br">{face.corner}</span>
    {/if}
  </div>
{:else}
  <div class="face back" style:width="{w}px" style:height="{h}px"></div>
{/if}

<style>
  .face {
    border-radius: 6px;
    position: relative;
    user-select: none;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
  }
  .front {
    background: var(--card-face);
    border: 1px solid #c9c2b2;
  }
  .back {
    background:
      repeating-linear-gradient(
        45deg,
        var(--card-back),
        var(--card-back) 6px,
        var(--card-back-2) 6px,
        var(--card-back-2) 12px
      );
    border: 4px solid #f0ece1;
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 5px;
  }
  /* title + art + text composite (e.g. Dominion): art is a strip between
     the title bar and the rules text, not the whole face */
  img.art {
    position: absolute;
    top: 17px;
    left: 5px;
    right: 5px;
    width: calc(100% - 10px);
    height: 22px;
    border-radius: 3px;
  }
  .body.arted {
    top: 41px;
    font-size: 0.38em;
  }
  .corner {
    position: absolute;
    font-size: 0.78em;
    font-weight: 700;
    line-height: 1;
    white-space: pre;
  }
  .tl {
    top: 5px;
    left: 6px;
  }
  .br {
    bottom: 5px;
    right: 6px;
    transform: rotate(180deg);
  }
  .center {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 2em;
  }
  .title {
    position: absolute;
    top: 4px;
    left: 4px;
    right: 4px;
    text-align: center;
    font-size: 0.5em;
    font-weight: 700;
    line-height: 1.1;
    border-bottom: 1px solid currentColor;
    padding-bottom: 2px;
  }
  /* summary face: the title is the biggest thing on the card */
  .title.big {
    font-size: 0.56em;
    letter-spacing: -0.01em;
  }
  .badges {
    position: absolute;
    top: 42px;
    bottom: 14px;
    left: 4px;
    right: 4px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
  }
  .bline {
    font-size: 0.5em;
    font-weight: 700;
    line-height: 1.15;
    text-align: center;
    max-width: 100%;
  }
  /* a lone badge ("$2", "3 VP") gets the whole middle, poker-face big */
  .badges.solo .bline {
    font-size: 1.1em;
  }
  .body {
    position: absolute;
    top: 20px;
    bottom: 14px;
    left: 5px;
    right: 5px;
    font-size: 0.42em;
    line-height: 1.25;
    color: #3a3a40;
    display: flex;
    align-items: center;
    text-align: center;
    white-space: pre-wrap;
    overflow: hidden;
  }
  .sub {
    position: absolute;
    bottom: 3px;
    left: 5px;
    right: 5px;
    font-size: 0.42em;
    font-weight: 700;
    display: flex;
    justify-content: space-between;
  }
  /* ---- detail (inspector) layout: flows, nothing clipped ---- */
  .detail {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    padding: 4% 5%;
    gap: 3%;
  }
  .dtitle {
    font-size: 0.62em;
    font-weight: 700;
    text-align: center;
    line-height: 1.1;
    border-bottom: 1px solid currentColor;
    padding-bottom: 2%;
  }
  .dart {
    width: 100%;
    height: 14%;
    flex: none;
    border-radius: 4px;
  }
  .dbadges {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 3px;
  }
  .pill {
    font-size: 0.4em;
    font-weight: 700;
    border: 1px solid currentColor;
    border-radius: 999px;
    padding: 0.05em 0.6em;
    white-space: nowrap;
  }
  .dbody {
    flex: 1;
    min-height: 0;
    font-size: 0.4em;
    line-height: 1.3;
    color: #3a3a40;
    display: flex;
    flex-direction: column;
    /* 'safe' keeps the START visible when long text overflows — a centered
       overflow would clip both ends */
    justify-content: safe center;
    align-items: center;
    text-align: center;
    white-space: pre-wrap;
    overflow: hidden;
  }
  .dcenter {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 2em;
  }
  .dsub {
    font-size: 0.42em;
    font-weight: 700;
    display: flex;
    justify-content: space-between;
  }
</style>
