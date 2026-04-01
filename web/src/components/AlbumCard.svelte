<script lang="ts">
  import { coverArtUrl, type Album, subsonic } from '$lib/subsonic';
  import { addSongToQueue } from '$lib/stores/player';

  interface Props {
    album: Album;
  }

  let { album }: Props = $props();

  let coverUrl = $state('');
  let queuing = $state(false);

  $effect(() => {
    if (album.coverArt) {
      coverArtUrl(album.coverArt, 300).then((url) => (coverUrl = url));
    }
  });

  async function addAlbumToQueue(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (queuing) return;
    queuing = true;
    try {
      const { songs } = await subsonic.getAlbum(album.id);
      for (const song of songs) {
        await addSongToQueue(song);
      }
    } finally {
      queuing = false;
    }
  }
</script>

<a href="/library/album/{album.id}" class="album-card">
  <div class="album-art-wrap">
    {#if coverUrl}
      <img src={coverUrl} alt={album.name} class="album-art" />
    {:else}
      <div class="album-art placeholder">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="var(--text-subdued)"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
      </div>
    {/if}
    <button class="album-queue-btn" onclick={addAlbumToQueue} title="Add album to queue">
      {#if queuing}
        <svg class="spin" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25 1.97.7 2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>
      {:else}
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 11H7.83l4.88-4.88c.39-.39.39-1.03 0-1.42-.39-.39-1.02-.39-1.41 0l-6.59 6.59c-.39.39-.39 1.02 0 1.41l6.59 6.59c.39.39 1.02.39 1.41 0 .39-.39.39-1.02 0-1.41L7.83 13H19c.55 0 1-.45 1-1s-.45-1-1-1zM3 18c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm0-7c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm0-7c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1z"/></svg>
      {/if}
    </button>
  </div>
  <div class="album-name">{album.name}</div>
  <div class="album-artist">{album.artist}</div>
</a>

<style>
  .album-card {
    display: flex;
    flex-direction: column;
    padding: 12px;
    background: var(--bg-secondary);
    border-radius: 8px;
    transition: background 0.2s;
    cursor: pointer;
  }

  .album-card:hover {
    background: var(--bg-elevated);
  }

  .album-art-wrap {
    position: relative;
    width: 100%;
    margin-bottom: 12px;
  }

  .album-art {
    width: 100%;
    aspect-ratio: 1;
    border-radius: 4px;
    object-fit: cover;
    display: block;
  }

  .album-art.placeholder {
    aspect-ratio: 1;
    background: var(--bg-elevated);
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .album-queue-btn {
    position: absolute;
    bottom: 8px;
    right: 8px;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--bg-primary);
    color: var(--text-primary);
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transform: translateY(4px);
    transition: opacity 0.2s, transform 0.2s;
    box-shadow: 0 2px 8px rgba(0,0,0,0.4);
  }

  .album-card:hover .album-queue-btn {
    opacity: 1;
    transform: translateY(0);
  }

  .album-queue-btn:hover {
    background: var(--accent);
    color: #000;
  }

  .album-name {
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-bottom: 4px;
  }

  .album-artist {
    font-size: 12px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  .spin { animation: spin 1s linear infinite; }
</style>
