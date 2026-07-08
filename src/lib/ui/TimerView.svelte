<script lang="ts">
  import type { TimerEntity } from '../model/types';
  import { table } from '../state/store.svelte';

  let { timer }: { timer: TimerEntity } = $props();

  // local ticking only — state stores timestamps, so peers need no messages
  let now = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 200);
    return () => clearInterval(t);
  });

  const elapsed = $derived(
    timer.state.elapsedMs + (timer.state.running ? now - timer.state.startedAt : 0),
  );
  const remaining = $derived(Math.max(0, timer.state.durationMs - elapsed));
  const shown = $derived(timer.state.mode === 'countdown' ? remaining : elapsed);
  const expired = $derived(timer.state.mode === 'countdown' && remaining === 0);

  function fmt(ms: number): string {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function toggle() {
    table.update(timer, (t) => {
      if (t.state.running) {
        t.state.elapsedMs += Date.now() - t.state.startedAt;
        t.state.running = false;
      } else {
        t.state.startedAt = Date.now();
        t.state.running = true;
      }
    });
  }

  function reset() {
    table.update(timer, (t) => {
      t.state.running = false;
      t.state.elapsedMs = 0;
    });
  }
</script>

<div class="timer" class:expired>
  <span class="time">{fmt(shown)}</span>
  <div class="controls">
    <button onpointerdown={(e) => e.stopPropagation()} ondblclick={(e) => e.stopPropagation()} onclick={toggle}>
      {timer.state.running ? '⏸' : '▶'}
    </button>
    <button onpointerdown={(e) => e.stopPropagation()} ondblclick={(e) => e.stopPropagation()} onclick={reset}>↺</button>
  </div>
</div>

<style>
  .timer {
    background: var(--panel);
    border: 1px solid #454f60;
    border-radius: 8px;
    padding: 6px 12px;
    display: flex;
    align-items: center;
    gap: 10px;
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.35);
  }
  .timer.expired {
    border-color: #e4573d;
    animation: pulse 1s infinite;
  }
  @keyframes pulse {
    50% {
      background: #4a2b28;
    }
  }
  .time {
    font-size: 1.3rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    user-select: none;
  }
  .controls {
    display: flex;
    gap: 4px;
  }
  button {
    padding: 2px 8px;
    font-size: 0.8rem;
  }
</style>
