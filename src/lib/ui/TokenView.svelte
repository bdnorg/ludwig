<script lang="ts">
  // One token face, config-driven — used on the table, as a stack's top and
  // under-piece, and as the drag ghost (M17: what you drag is what you see).
  import type { TokenEntity } from '../model/types';

  let {
    config,
    rot = 0,
    under = false,
  }: {
    config: TokenEntity['config'];
    rot?: number;
    /** the piece peeking out from behind a stack's top (M17) */
    under?: boolean;
  } = $props();
</script>

<div
  class="token"
  class:square={config.shape === 'square'}
  class:hex={config.shape === 'hex'}
  class:bar={config.shape === 'bar'}
  class:under
  style:width="{config.size}px"
  style:height="{config.shape === 'bar' ? Math.round(config.size * 0.3) : config.size}px"
  style:background={config.color}
  style:transform={rot ? `rotate(${rot}deg)` : undefined}
>
  {config.label}
</div>

<style>
  .token {
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.7rem;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.9);
    box-shadow:
      inset 0 -3px 0 rgba(0, 0, 0, 0.25),
      0 1px 3px rgba(0, 0, 0, 0.4);
    user-select: none;
    position: relative;
  }
  .token.square {
    border-radius: 4px;
  }
  .token.hex {
    border-radius: 0;
    clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%);
    box-shadow: none;
  }
  .token.bar {
    border-radius: 3px;
  }
  /* thin contrasting rim so the stack reads as depth, not a smudge */
  .token.under {
    border: 1.5px solid rgba(255, 255, 255, 0.75);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
  }
</style>
