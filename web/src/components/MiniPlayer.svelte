<script lang="ts">
  import { currentTrack, isPlaying, currentTime, duration, shuffle, loop, togglePlay, playNext, toggleShuffle, cycleLoop, formatTime, activeDeviceId, localDeviceId, claimPlayback } from '$lib/stores/player';
  import { otherDevices } from '$lib/stores/devices';
  import { showFullscreenPlayer } from '$lib/stores/ui';
  import DevicesPopover from './DevicesPopover.svelte';

  let progress = $derived($duration > 0 ? ($currentTime / $duration) * 100 : 0);
  let showDevices = $state(false);

  const isActivePlayer = $derived(!$activeDeviceId || $activeDeviceId === $localDeviceId);
  const activeDeviceName = $derived(
    $otherDevices.find((d) => d.device_id === $activeDeviceId)?.device_name ?? 'another device'
  );
</script>

{#if $currentTrack}
<div class="mini-player">
  {#if !isActivePlayer}
  <div class="mini-ownership">
    <span>Playing on <strong>{activeDeviceName}</strong></span>
    <button class="mini-play-here" onclick={claimPlayback}>Play here</button>
  </div>
  {/if}
  <div class="mini-progress-bar"><div class="mini-progress" style="width: {progress}%"></div></div>
  <div class="mini-content" class:inactive={!isActivePlayer}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="mini-track" onclick={() => showFullscreenPlayer.set(true)}>
      {#if $currentTrack.coverUrl}
        <img src={$currentTrack.coverUrl} alt="" class="mini-cover" />
      {:else}
        <div class="mini-cover placeholder"></div>
      {/if}
      <div class="mini-info">
        <div class="mini-title">{$currentTrack.title}</div>
        <div class="mini-artist">{$currentTrack.artist}</div>
      </div>
    </div>
    <button class="mini-play" onclick={togglePlay}>
      {#if $isPlaying}
        <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
      {:else}
        <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
      {/if}
    </button>
    <button class="mini-btn" onclick={playNext}>
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
    </button>
    <button class="mini-btn" class:active={$shuffle} onclick={toggleShuffle}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>
    </button>
    <button class="mini-btn" class:active={$loop !== 'none'} onclick={cycleLoop}>
      {#if $loop === 'one'}
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z"/></svg>
      {:else}
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>
      {/if}
    </button>
    <div class="mini-devices-wrap">
      <button class="mini-btn" class:active={$otherDevices.length > 0} onclick={() => showDevices = !showDevices}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M4 6h18V4H4c-1.1 0-2 .9-2 2v11H0v3h14v-3H4V6zm19 2h-6c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h6c.55 0 1-.45 1-1V9c0-.55-.45-1-1-1zm-1 9h-4v-7h4v7z"/></svg>
        {#if $otherDevices.length > 0}
          <span class="mini-device-badge">{$otherDevices.length}</span>
        {/if}
      </button>
      {#if showDevices}
        <DevicesPopover onclose={() => showDevices = false} />
      {/if}
    </div>
  </div>
</div>
{/if}

<style>
  .mini-player {
    position: fixed;
    bottom: var(--bottom-nav-height);
    left: 0;
    right: 0;
    z-index: 200;
    background: var(--bg-elevated);
    border-radius: 8px 8px 0 0;
    overflow: visible;
    margin: 0 8px;
  }

  .mini-ownership {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 5px 12px 3px;
    font-size: 11px;
    color: var(--text-secondary);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    border-radius: 8px 8px 0 0;
  }

  .mini-ownership strong {
    color: var(--text-primary);
    font-weight: 600;
  }

  .mini-play-here {
    font-size: 10px;
    font-weight: 700;
    color: var(--accent);
    padding: 2px 8px;
    border: 1px solid var(--accent);
    border-radius: 20px;
    white-space: nowrap;
  }

  .mini-content.inactive .mini-play {
    opacity: 0.4;
    pointer-events: none;
  }

  .mini-progress-bar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    overflow: hidden;
    border-radius: 8px 8px 0 0;
  }

  .mini-progress {
    height: 2px;
    background: var(--accent);
    transition: width 0.2s linear;
  }

  .mini-content {
    display: flex;
    align-items: center;
    padding: 8px 12px;
    gap: 8px;
  }

  .mini-cover {
    width: 40px;
    height: 40px;
    border-radius: 4px;
    object-fit: cover;
    flex-shrink: 0;
  }

  .mini-cover.placeholder {
    background: var(--bg-highlight);
  }

  .mini-track {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    min-width: 0;
    cursor: pointer;
  }

  .mini-info {
    min-width: 0;
  }

  .mini-title {
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .mini-artist {
    font-size: 11px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .mini-play {
    color: var(--text-primary);
    flex-shrink: 0;
    display: flex;
  }

  .mini-btn {
    color: var(--text-secondary);
    flex-shrink: 0;
    display: flex;
    transition: color 0.15s;
  }

  .mini-btn:hover, .mini-btn.active {
    color: var(--accent);
  }

  .mini-devices-wrap {
    position: relative;
    display: flex;
  }

  .mini-device-badge {
    position: absolute;
    top: -3px;
    right: -3px;
    background: var(--accent);
    color: #000;
    font-size: 8px;
    font-weight: 700;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
</style>
