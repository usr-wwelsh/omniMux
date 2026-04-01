<script lang="ts">
  import { currentTrack, queue, queueIndex, formatTime } from '$lib/stores/player';
</script>

<aside class="now-playing">
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
        <h3 class="np-queue-title">Queue</h3>
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
</aside>

<style>
  .now-playing {
    width: var(--now-playing-width);
    background: var(--bg-secondary);
    padding: 16px;
    overflow-y: auto;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
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

  .np-queue-title {
    font-size: 14px;
    font-weight: 700;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 12px;
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
