<script lang="ts">
  import {
    currentTrack, isPlaying, currentTime, duration, volume,
    shuffle, loop, togglePlay, seek, setVolume,
    playNext, playPrev, toggleShuffle, cycleLoop, formatTime,
    queue,
  } from '$lib/stores/player';
  import { showFullscreenPlayer } from '$lib/stores/ui';
  import { goto } from '$app/navigation';
  import QueuePanel from './QueuePanel.svelte';

  let tab = $state<'playing' | 'queue'>('playing');

  let progressBar: HTMLDivElement;
  let volumeBar: HTMLDivElement;

  let progress = $derived($duration > 0 ? ($currentTime / $duration) * 100 : 0);

  function handleProgressClick(e: MouseEvent) {
    if (!progressBar) return;
    const rect = progressBar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seek(pct * $duration);
  }

  function handleVolumeClick(e: MouseEvent) {
    if (!volumeBar) return;
    const rect = volumeBar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setVolume(pct);
  }

  function close() {
    showFullscreenPlayer.set(false);
  }

  // Swipe down to close
  let touchStartY = 0;
  function onTouchStart(e: TouchEvent) {
    touchStartY = e.touches[0].clientY;
  }
  function onTouchEnd(e: TouchEvent) {
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (dy > 80) close();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fs-overlay"
  ontouchstart={onTouchStart}
  ontouchend={onTouchEnd}
>
  <!-- Header -->
  <div class="fs-header">
    <button class="fs-close" onclick={close}>
      <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/></svg>
    </button>
    <div class="fs-tabs">
      <button class="fs-tab" class:active={tab === 'playing'} onclick={() => tab = 'playing'}>Now Playing</button>
      <button class="fs-tab" class:active={tab === 'queue'} onclick={() => tab = 'queue'}>Queue {#if $queue.length > 0}<span class="fs-tab-count">{$queue.length}</span>{/if}</button>
    </div>
    <div style="width: 36px"></div>
  </div>

  {#if $currentTrack}
  <div class="fs-body">

    <!-- Player panel (hidden on mobile when queue tab active) -->
    <div class="fs-player-panel" class:mobile-hidden={tab === 'queue'}>

      <!-- Album art -->
      <div class="fs-art-wrap">
        {#if $currentTrack.coverUrl}
          <img src={$currentTrack.coverUrl} alt="" class="fs-art" />
        {:else}
          <div class="fs-art placeholder">
            <svg viewBox="0 0 24 24" width="80" height="80" fill="var(--text-subdued)"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
          </div>
        {/if}
      </div>

      <!-- Track info -->
      <div class="fs-info">
        <div class="fs-title">{$currentTrack.title}</div>
        {#if $currentTrack.artistId}
          <button class="fs-artist fs-artist--link" onclick={() => { close(); goto(`/library/artist/${$currentTrack!.artistId}`); }}>
            {$currentTrack.artist}
          </button>
        {:else}
          <div class="fs-artist">{$currentTrack.artist}</div>
        {/if}
      </div>

      <!-- Progress -->
      <div class="fs-progress-section">
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
          class="fs-progress-bar"
          bind:this={progressBar}
          onclick={handleProgressClick}
        >
          <div class="fs-progress-fill" style="width: {progress}%">
            <div class="fs-progress-thumb"></div>
          </div>
        </div>
        <div class="fs-times">
          <span>{formatTime($currentTime)}</span>
          <span>{formatTime($duration)}</span>
        </div>
      </div>

      <!-- Controls -->
      <div class="fs-controls">
        <button class="fs-mode-btn" class:active={$shuffle} onclick={toggleShuffle} title="Shuffle">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>
        </button>
        <button class="fs-btn" onclick={playPrev}>
          <svg viewBox="0 0 24 24" width="36" height="36" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
        </button>
        <button class="fs-play-btn" onclick={togglePlay}>
          {#if $isPlaying}
            <svg viewBox="0 0 24 24" width="36" height="36" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
          {:else}
            <svg viewBox="0 0 24 24" width="36" height="36" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          {/if}
        </button>
        <button class="fs-btn" onclick={playNext}>
          <svg viewBox="0 0 24 24" width="36" height="36" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
        </button>
        <button class="fs-mode-btn" class:active={$loop !== 'none'} onclick={cycleLoop}>
          {#if $loop === 'one'}
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z"/></svg>
          {:else}
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>
          {/if}
        </button>
      </div>

      <!-- Volume -->
      <div class="fs-volume">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="var(--text-subdued)"><path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/><path d="M5 9v6h4l5 5V4L9 9H5zm7-.17v6.34L9.83 13H7v-2h2.83L12 8.83z"/></svg>
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="fs-vol-bar" bind:this={volumeBar} onclick={handleVolumeClick}>
          <div class="fs-vol-fill" style="width: {$volume * 100}%"></div>
        </div>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="var(--text-subdued)"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
      </div>

    </div>

    <!-- Queue panel (hidden on mobile when playing tab active) -->
    <div class="fs-queue-panel" class:mobile-hidden={tab === 'playing'}>
      <QueuePanel />
    </div>

  </div>
  {/if}
</div>

<style>
  .fs-overlay {
    position: fixed;
    inset: 0;
    z-index: 500;
    background: var(--bg-primary);
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .fs-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px 8px;
    flex-shrink: 0;
  }

  .fs-tabs {
    display: flex;
    background: var(--bg-elevated);
    border-radius: 10px;
    padding: 3px;
    gap: 2px;
  }

  .fs-tab {
    padding: 7px 20px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    gap: 6px;
    transition: all 0.15s;
  }

  .fs-tab.active {
    background: var(--bg-primary);
    color: var(--text-primary);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  }

  .fs-tab-count {
    font-size: 11px;
    font-weight: 700;
    background: var(--accent);
    color: #000;
    border-radius: 10px;
    padding: 1px 6px;
    line-height: 1.4;
  }

  .fs-tab.active .fs-tab-count {
    background: var(--accent);
  }

  .fs-close {
    color: var(--text-secondary);
    display: flex;
    padding: 4px;
    transition: color 0.15s;
  }

  .fs-close:hover {
    color: var(--text-primary);
  }

  .fs-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .fs-body {
    flex: 1;
    display: flex;
    flex-direction: row;
    min-height: 0;
  }

  .fs-player-panel {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 24px;
    padding: 0 40px 40px;
    /* mobile: full width single column */
    width: 100%;
  }

  .fs-queue-panel {
    overflow-y: auto;
    /* mobile: full width single column */
    width: 100%;
  }

  .mobile-hidden {
    display: none;
  }

  .fs-art-wrap {
    width: 100%;
    max-width: 380px;
  }

  .fs-art {
    width: 100%;
    aspect-ratio: 1;
    border-radius: 12px;
    object-fit: cover;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
  }

  .fs-art.placeholder {
    aspect-ratio: 1;
    background: var(--bg-elevated);
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .fs-info {
    text-align: center;
    width: 100%;
  }

  .fs-title {
    font-size: 22px;
    font-weight: 700;
    margin-bottom: 6px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .fs-artist {
    font-size: 16px;
    color: var(--text-secondary);
  }

  .fs-artist--link {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    transition: color 0.15s;
  }

  .fs-artist--link:hover {
    color: var(--text-primary);
    text-decoration: underline;
  }

  .fs-progress-section {
    width: 100%;
  }

  .fs-progress-bar {
    width: 100%;
    height: 4px;
    background: var(--bg-highlight);
    border-radius: 2px;
    cursor: pointer;
    position: relative;
    margin-bottom: 8px;
  }

  .fs-progress-bar:hover {
    height: 6px;
    margin-top: -1px;
  }

  .fs-progress-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 2px;
    position: relative;
  }

  .fs-progress-thumb {
    position: absolute;
    right: -6px;
    top: 50%;
    transform: translateY(-50%);
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--text-primary);
    opacity: 0;
    transition: opacity 0.15s;
  }

  .fs-progress-bar:hover .fs-progress-thumb {
    opacity: 1;
  }

  .fs-times {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    color: var(--text-subdued);
  }

  .fs-controls {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 28px;
    width: 100%;
  }

  .fs-btn {
    color: var(--text-primary);
    display: flex;
    transition: opacity 0.15s;
  }

  .fs-btn:hover {
    opacity: 0.7;
  }

  .fs-play-btn {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: var(--text-primary);
    color: var(--bg-primary);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.1s;
    flex-shrink: 0;
  }

  .fs-play-btn:hover {
    transform: scale(1.04);
  }

  .fs-mode-btn {
    color: var(--text-subdued);
    display: flex;
    transition: color 0.15s;
  }

  .fs-mode-btn:hover, .fs-mode-btn.active {
    color: var(--accent);
  }

  .fs-volume {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
  }

  .fs-vol-bar {
    flex: 1;
    height: 4px;
    background: var(--bg-highlight);
    border-radius: 2px;
    cursor: pointer;
  }

  .fs-vol-fill {
    height: 100%;
    background: var(--text-secondary);
    border-radius: 2px;
  }

  /* Desktop: side-by-side layout, tabs hidden */
  @media (min-width: 900px) {
    .fs-tabs {
      display: none;
    }

    .fs-header {
      /* keep close button left-aligned without centering the now-absent tabs */
      justify-content: flex-start;
      gap: 0;
    }

    .fs-body {
      overflow: hidden;
    }

    .fs-player-panel {
      flex: 0 0 480px;
      justify-content: center;
      padding: 0 48px 48px;
    }

    /* Override mobile-hidden on desktop so both panels are always visible */
    .fs-player-panel.mobile-hidden,
    .fs-queue-panel.mobile-hidden {
      display: flex;
    }

    .fs-queue-panel {
      flex: 1;
      display: flex;
      flex-direction: column;
      border-left: 1px solid var(--bg-elevated);
      padding: 16px 0 0;
    }
  }

  /* Mobile: tab-controlled single panel, volume hidden */
  @media (max-width: 899px) {
    .fs-body {
      flex-direction: column;
    }

    .fs-player-panel {
      padding: 0 24px 32px;
      gap: 20px;
    }

    .fs-volume {
      display: none;
    }
  }
</style>
