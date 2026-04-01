<script lang="ts">
  import { type Song } from '$lib/subsonic';
  import { playQueue, addSongToQueue, formatTime } from '$lib/stores/player';

  interface Props {
    songs: Song[];
    showAlbum?: boolean;
  }

  let { songs, showAlbum = false }: Props = $props();

  function handlePlay(index: number) {
    playQueue(songs, index);
  }

  async function handleAddToQueue(e: MouseEvent, song: Song) {
    e.stopPropagation();
    await addSongToQueue(song);
  }
</script>

<div class="track-list">
  {#each songs as song, i}
    <div class="track-row" role="row">
      <button class="track-main" onclick={() => handlePlay(i)}>
        <span class="track-num">{i + 1}</span>
        <div class="track-info">
          <div class="track-title">{song.title}</div>
          <div class="track-artist">{song.artist}{#if showAlbum} &middot; {song.album}{/if}</div>
        </div>
        <span class="track-duration">{formatTime(song.duration)}</span>
      </button>
      <button class="track-queue-btn" onclick={(e) => handleAddToQueue(e, song)} title="Add to queue">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 11H7.83l4.88-4.88c.39-.39.39-1.03 0-1.42-.39-.39-1.02-.39-1.41 0l-6.59 6.59c-.39.39-.39 1.02 0 1.41l6.59 6.59c.39.39 1.02.39 1.41 0 .39-.39.39-1.02 0-1.41L7.83 13H19c.55 0 1-.45 1-1s-.45-1-1-1zM3 18c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm0-7c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm0-7c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1z"/></svg>
      </button>
    </div>
  {/each}
</div>

<style>
  .track-list {
    display: flex;
    flex-direction: column;
  }

  .track-row {
    display: flex;
    align-items: center;
    border-radius: 4px;
    transition: background 0.15s;
  }

  .track-row:hover {
    background: var(--bg-elevated);
  }

  .track-main {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 8px 8px 8px 16px;
    flex: 1;
    min-width: 0;
    text-align: left;
  }

  .track-num {
    width: 24px;
    text-align: center;
    font-size: 14px;
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .track-info {
    flex: 1;
    min-width: 0;
  }

  .track-title {
    font-size: 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .track-artist {
    font-size: 12px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .track-duration {
    font-size: 13px;
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .track-queue-btn {
    padding: 8px 12px;
    color: var(--text-subdued);
    flex-shrink: 0;
    display: flex;
    opacity: 0;
    transition: opacity 0.15s, color 0.15s;
  }

  .track-row:hover .track-queue-btn {
    opacity: 1;
  }

  .track-queue-btn:hover {
    color: var(--accent);
  }
</style>
