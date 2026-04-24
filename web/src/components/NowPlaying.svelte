<script lang="ts">
  import { currentTrack, queue, queueIndex, clearQueue, formatTime } from '$lib/stores/player';
  import { nowPlayingCollapsed } from '$lib/stores/ui';
</script>

<aside class="now-playing" class:collapsed={$nowPlayingCollapsed}>
  <button class="collapse-btn" onclick={() => ($nowPlayingCollapsed = !$nowPlayingCollapsed)} title={$nowPlayingCollapsed ? 'Expand panel' : 'Collapse panel'}>
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
      {#if $nowPlayingCollapsed}
        <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
      {:else}
        <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
      {/if}
    </svg>
  </button>

  <div class="np-content">
    {#if $currentTrack}
      <div class="np-cover-section">
        {#if $currentTrack.coverUrl}
          <img src={$currentTrack.coverUrl} alt="" class="np-cover" />
        {:else}
          <div class="np-cover placeholder">
            <svg viewBox="0 0 24 24" width="64" height="64" fill="var(--text-subdued)"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
          </div>
        {/if}
        <div class="np-title">{$currentTrack.title}</div>
        <div class="np-artist">{$currentTrack.artist}</div>
      </div>

      {#if $queue.length > 1}
        <div class="np-queue">
          <div class="np-queue-header">
            <h3 class="np-queue-title">Queue</h3>
            <button class="np-queue-clear" onclick={clearQueue} title="Clear queue">Clear</button>
          </div>
          <div class="np-queue-list">
            {#each $queue as track, i}
              {#if i > $queueIndex}
                <div class="np-queue-item">
                  <span class="np-queue-title-text">{track.title}</span>
                  <span class="np-queue-artist">{track.artist}</span>
                </div>
              {/if}
            {/each}
          </div>
        </div>
      {/if}
    {:else}
      <div class="np-empty">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="var(--text-subdued)"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
        <p>Nothing playing</p>
      </div>
    {/if}
  </div>
</aside>

<style>
  .now-playing {
    width: var(--now-playing-width);
    background: var(--bg-secondary);
    padding: 16px;
    overflow-y: auto;
    overflow-x: hidden;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    position: relative;
    transition: width 0.25s ease, padding 0.25s ease;
  }

  .now-playing.collapsed {
    width: 40px;
    padding: 8px 4px;
    overflow-y: hidden;
  }

  .collapse-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 6px;
    border-radius: 4px;
    flex-shrink: 0;
    align-self: flex-end;
    margin-bottom: 8px;
    transition: color 0.15s ease, background 0.15s ease;
  }

  .collapse-btn:hover {
    color: var(--text-primary);
    background: var(--bg-elevated);
  }

  .collapsed .collapse-btn {
    align-self: center;
    margin-bottom: 0;
  }

  .np-content {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    opacity: 1;
    transition: opacity 0.15s ease;
  }

  .collapsed .np-content {
    opacity: 0;
    pointer-events: none;
    overflow: hidden;
    height: 0;
  }

  .np-cover-section {
    text-align: center;
  }

  .np-cover {
    width: 100%;
    aspect-ratio: 1;
    border-radius: 8px;
    object-fit: cover;
    margin-bottom: 16px;
  }

  .np-cover.placeholder {
    background: var(--bg-elevated);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .np-title {
    font-size: 18px;
    font-weight: 700;
    margin-bottom: 4px;
  }

  .np-artist {
    font-size: 14px;
    color: var(--text-secondary);
  }

  .np-queue {
    margin-top: 24px;
  }

  .np-queue-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }

  .np-queue-title {
    font-size: 14px;
    font-weight: 700;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 0;
  }

  .np-queue-clear {
    font-size: 12px;
    color: var(--text-subdued);
    padding: 2px 6px;
    border-radius: 4px;
    transition: color 0.15s, background 0.15s;
  }

  .np-queue-clear:hover {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 10%, transparent);
  }

  .np-queue-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .np-queue-item {
    display: flex;
    flex-direction: column;
    padding: 8px;
    border-radius: 4px;
  }

  .np-queue-item:hover {
    background: var(--bg-elevated);
  }

  .np-queue-title-text {
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .np-queue-artist {
    font-size: 11px;
    color: var(--text-secondary);
  }

  .np-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: var(--text-subdued);
    font-size: 14px;
  }
</style>
