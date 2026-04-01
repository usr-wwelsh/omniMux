<script lang="ts">
  import { coverArtUrl, type Album } from '$lib/subsonic';

  interface Props {
    album: Album;
  }

  let { album }: Props = $props();

  let coverUrl = $state('');

  $effect(() => {
    if (album.coverArt) {
      coverArtUrl(album.coverArt, 300).then((url) => (coverUrl = url));
    }
  });
</script>

<a href="/library/album/{album.id}" class="album-card">
  {#if coverUrl}
    <img src={coverUrl} alt={album.name} class="album-art" />
  {:else}
    <div class="album-art placeholder">
      <svg viewBox="0 0 24 24" width="48" height="48" fill="var(--text-subdued)"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
    </div>
  {/if}
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

  .album-art {
    width: 100%;
    aspect-ratio: 1;
    border-radius: 4px;
    object-fit: cover;
    margin-bottom: 12px;
  }

  .album-art.placeholder {
    background: var(--bg-elevated);
    display: flex;
    align-items: center;
    justify-content: center;
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
</style>
