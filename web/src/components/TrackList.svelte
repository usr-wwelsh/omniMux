<script lang="ts">
  import { type Song } from '$lib/subsonic';
  import { playSong, playQueue, formatTime } from '$lib/stores/player';

  interface Props {
    songs: Song[];
    showAlbum?: boolean;
  }

  let { songs, showAlbum = false }: Props = $props();

  function handlePlay(index: number) {
    playQueue(songs, index);
  }
</script>

<div class="track-list">
  {#each songs as song, i}
    <button class="track-row" onclick={() => handlePlay(i)}>
      <span class="track-num">{i + 1}</span>
      <div class="track-info">
        <div class="track-title">{song.title}</div>
        <div class="track-artist">{song.artist}{#if showAlbum} &middot; {song.album}{/if}</div>
      </div>
      <span class="track-duration">{formatTime(song.duration)}</span>
    </button>
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
    gap: 16px;
    padding: 8px 16px;
    border-radius: 4px;
    transition: background 0.15s;
    text-align: left;
    width: 100%;
  }

  .track-row:hover {
    background: var(--bg-elevated);
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
</style>
