<script lang="ts">
  import { type Song } from '$lib/subsonic';
  import { playQueue, addSongToQueue, formatTime, currentTrack, isPlaying } from '$lib/stores/player';
  import { addToPlaylistTarget } from '$lib/stores/ui';
  import { isGuest } from '$lib/auth';

  interface Props {
    songs: Song[];
    showAlbum?: boolean;
    onRemove?: (index: number) => void;
  }

  let { songs, showAlbum = false, onRemove }: Props = $props();

  function handlePlay(index: number) {
    playQueue(songs, index);
  }

  async function handleAddToQueue(e: MouseEvent, song: Song) {
    e.stopPropagation();
    await addSongToQueue(song);
  }

  function handleAddToPlaylist(e: MouseEvent, song: Song) {
    e.stopPropagation();
    addToPlaylistTarget.set(song);
  }

  function handleRemove(e: MouseEvent, index: number) {
    e.stopPropagation();
    onRemove?.(index);
  }
</script>

<div class="track-list">
  {#each songs as song, i}
    {@const isCurrent = $currentTrack?.id === song.id}
    <div class="track-row" class:current={isCurrent} role="row">
      <button class="track-main" onclick={() => handlePlay(i)}>
        {#if isCurrent}
          <span class="track-num eq" class:paused={!$isPlaying}>
            <span></span><span></span><span></span>
          </span>
        {:else}
          <span class="track-num">{i + 1}</span>
        {/if}
        <div class="track-info">
          <div class="track-title" class:current={isCurrent}>{song.title}</div>
          <div class="track-artist">{song.artist}{#if showAlbum} &middot; {song.album}{/if}</div>
        </div>
        <span class="track-duration">{formatTime(song.duration)}</span>
      </button>
      <button class="track-queue-btn" onclick={(e) => handleAddToQueue(e, song)} title="Add to queue">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 11H7.83l4.88-4.88c.39-.39.39-1.03 0-1.42-.39-.39-1.02-.39-1.41 0l-6.59 6.59c-.39.39-.39 1.02 0 1.41l6.59 6.59c.39.39 1.02.39 1.41 0 .39-.39.39-1.02 0-1.41L7.83 13H19c.55 0 1-.45 1-1s-.45-1-1-1zM3 18c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm0-7c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm0-7c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1z"/></svg>
      </button>
      {#if !$isGuest}
        <button class="track-queue-btn" onclick={(e) => handleAddToPlaylist(e, song)} title="Add to playlist">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM2 16h8v-2H2v2z"/></svg>
        </button>
        {#if onRemove}
          <button class="track-queue-btn" onclick={(e) => handleRemove(e, i)} title="Remove from playlist">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M14 10H2v2h12v-2zm0-4H2v2h12V6zM2 16h8v-2H2v2zm14.34-1.24L18 13.1l1.66 1.66 1.41-1.41L19.41 11.7l1.66-1.66-1.41-1.41L18 10.29l-1.66-1.66-1.41 1.41 1.66 1.66-1.66 1.66z"/></svg>
          </button>
        {/if}
      {/if}
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

  .track-row.current {
    background: color-mix(in srgb, var(--accent) 6%, transparent);
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

  .eq {
    display: flex;
    align-items: flex-end;
    justify-content: center;
    gap: 2px;
    height: 14px;
  }

  .eq span {
    width: 3px;
    background: var(--accent);
    border-radius: 1px;
    animation: eq-bounce 1s ease-in-out infinite;
  }

  .eq span:nth-child(2) { animation-delay: 0.25s; }
  .eq span:nth-child(3) { animation-delay: 0.5s; }

  .eq.paused span {
    animation-play-state: paused;
  }

  @keyframes eq-bounce {
    0%, 100% { height: 30%; }
    50% { height: 100%; }
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

  .track-title.current {
    color: var(--accent);
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

  /* No hover on touch devices — keep the button visible */
  @media (hover: none) {
    .track-queue-btn {
      opacity: 1;
    }
  }
</style>
