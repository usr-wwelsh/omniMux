<script lang="ts">
  import { targetBpm } from '$lib/stores/autodj';
  import { keylock } from '$lib/stores/player';

  const MIN_BPM = 100;
  const MAX_BPM = 200;

  function onInput(e: Event) {
    targetBpm.set(Number((e.currentTarget as HTMLInputElement).value));
  }
</script>

<div class="dj-panel">
  <span class="dj-label">Tempo</span>
  <input
    type="range" min={MIN_BPM} max={MAX_BPM} step="1"
    value={$targetBpm || 120}
    oninput={onInput}
    class="dj-slider"
    class:off={$targetBpm === 0}
    aria-label="Target BPM"
  />
  <span class="dj-val">{$targetBpm === 0 ? 'Native' : `${$targetBpm} BPM`}</span>
  <button class="dj-btn" disabled={$targetBpm === 0} onclick={() => targetBpm.set(0)} title="Play tracks at native tempo">Reset</button>
  <button class="dj-btn" class:active={$keylock} onclick={() => keylock.update((v) => !v)} title="Keep pitch when tempo changes">Keylock</button>
</div>

<style>
  .dj-panel {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    font-size: 12px;
    color: var(--text-subdued);
  }

  .dj-slider {
    flex: 1;
    min-width: 0;
    accent-color: var(--accent);
  }

  .dj-slider.off {
    opacity: 0.45;
  }

  .dj-val {
    min-width: 64px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .dj-btn {
    background: var(--bg-highlight);
    color: var(--text-secondary);
    border: none;
    border-radius: 12px;
    padding: 3px 10px;
    font-size: 11px;
    cursor: pointer;
  }

  .dj-btn.active {
    background: var(--accent);
    color: var(--bg-base, #000);
  }

  .dj-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
