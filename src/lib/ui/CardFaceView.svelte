<script lang="ts">
  import type { CardFace } from '../model/types';

  let {
    face = null,
    w,
    h,
  }: { face?: CardFace | null; w: number; h: number } = $props();
</script>

{#if face}
  <div class="face front" style:width="{w}px" style:height="{h}px" style:color={face.color ?? '#222'}>
    {#if face.image}
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
    font-size: 0.5rem;
    font-weight: 700;
    line-height: 1.1;
    border-bottom: 1px solid currentColor;
    padding-bottom: 2px;
  }
  .body {
    position: absolute;
    top: 20px;
    bottom: 14px;
    left: 5px;
    right: 5px;
    font-size: 0.42rem;
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
    font-size: 0.42rem;
    font-weight: 700;
    display: flex;
    justify-content: space-between;
  }
</style>
