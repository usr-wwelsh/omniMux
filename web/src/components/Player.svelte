<script lang="ts">
  import { currentTrack, isPlaying, currentTime, duration, volume, shuffle, loop, togglePlay, seek, setVolume, playNext, playPrev, toggleShuffle, cycleLoop, formatTime } from '$lib/stores/player';

  let progressBar: HTMLDivElement;
  let volumeBar: HTMLDivElement;
  let seeking = false;

  function handleProgressClick(e: MouseEvent) {
    if (!progressBar) return;
    const rect = progressBar.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    seek(pct * $duration);
  }

  function handleVolumeClick(e: MouseEvent) {
    if (!volumeBar) return;
    const rect = volumeBar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setVolume(pct);
  }

  let progress = $derived($duration > 0 ? ($currentTime / $duration) * 100 : 0);
</script>

{#if $currentTrack}
<div class="player">
  <div class="player-track">
    {#if $currentTrack.coverUrl}
      <img src={$currentTrack.coverUrl} alt="" class="player-cover" />
    {:else}
      <div class="player-cover placeholder"></div>
    {/if}
    <div class="player-info">
      <div class="player-title">{$currentTrack.title}</div>
      <div class="player-artist">{$currentTrack.artist}</div>
    </div>
  </div>

  <div class="player-controls">
    <div class="player-buttons">
      <button class="control-btn mode-btn" class:active={$shuffle} onclick={toggleShuffle} title="Shuffle">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>
      </button>
      <button class="control-btn" onclick={playPrev}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
      </button>
      <button class="control-btn play-btn" onclick={togglePlay}>
        {#if $isPlaying}
          <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
        {:else}
          <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        {/if}
      </button>
      <button class="control-btn" onclick={playNext}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
      </button>
      <button class="control-btn mode-btn" class:active={$loop !== 'none'} onclick={cycleLoop} title={$loop === 'one' ? 'Repeat one' : $loop === 'all' ? 'Repeat all' : 'No repeat'}>
        {#if $loop === 'one'}
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z"/></svg>
        {:else}
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>
        {/if}
      </button>
    </div>
    <div class="player-progress-row">
      <span class="time">{formatTime($currentTime)}</span>
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="progress-bar" bind:this={progressBar} onclick={handleProgressClick}>
        <div class="progress-fill" style="width: {progress}%"></div>
      </div>
      <span class="time">{formatTime($duration)}</span>
    </div>
  </div>

  <div class="player-volume">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <svg viewBox="0 0 24 24" width="18" height="18" fill="var(--text-secondary)"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>
    <div class="volume-bar" bind:this={volumeBar} onclick={handleVolumeClick}>
      <div class="volume-fill" style="width: {$volume * 100}%"></div>
    </div>
  </div>
</div>
{/if}

<style>
  .player {
    display: flex;
    align-items: center;
    height: var(--player-height);
    background: var(--bg-secondary);
    border-top: 1px solid var(--border);
    padding: 0 16px;
    gap: 16px;
  }

  .player-track {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: 1;
    min-width: 0;
  }

  .player-cover {
    width: 48px;
    height: 48px;
    border-radius: 4px;
    object-fit: cover;
    flex-shrink: 0;
  }

  .player-cover.placeholder {
    background: var(--bg-elevated);
  }

  .player-info {
    min-width: 0;
  }

  .player-title {
    font-size: 14px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .player-artist {
    font-size: 12px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .player-controls {
    flex: 2;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }

  .player-buttons {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .control-btn {
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 0.15s;
  }

  .control-btn:hover {
    color: var(--text-primary);
  }

  .mode-btn.active {
    color: var(--accent);
  }

  .play-btn {
    background: var(--text-primary);
    color: var(--bg-primary) !important;
    border-radius: 50%;
    width: 36px;
    height: 36px;
  }

  .player-progress-row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    max-width: 600px;
  }

  .time {
    font-size: 11px;
    color: var(--text-secondary);
    min-width: 35px;
    text-align: center;
  }

  .progress-bar, .volume-bar {
    flex: 1;
    height: 4px;
    background: var(--bg-highlight);
    border-radius: 2px;
    cursor: pointer;
    position: relative;
  }

  .progress-fill, .volume-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 2px;
    transition: width 0.1s linear;
  }

  .progress-bar:hover .progress-fill,
  .volume-bar:hover .volume-fill {
    background: var(--accent-hover);
  }

  .player-volume {
    flex: 0.5;
    display: flex;
    align-items: center;
    gap: 8px;
    justify-content: flex-end;
  }

  @media (max-width: 768px) {
    .player-controls {
      display: none;
    }
    .player-volume {
      display: none;
    }
    .player {
      padding: 0 12px;
    }
    .player-track {
      flex: 1;
    }
  }
</style>
