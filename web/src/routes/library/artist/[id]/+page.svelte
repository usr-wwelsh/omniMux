<script lang="ts">
  import { page } from '$app/state';
  import { subsonic, type Artist, type Album } from '$lib/subsonic';
  import { api, type YouTubeAlbumResult } from '$lib/api';
  import AlbumCard from '../../../../components/AlbumCard.svelte';

  let artist = $state<Artist | null>(null);
  let albums = $state<Album[]>([]);
  let ytAlbums = $state<YouTubeAlbumResult[]>([]);
  let loading = $state(true);
  let showAllYt = $state(false);
  let importingAlbums = $state<Set<string>>(new Set());
  let importedAlbums = $state<Set<string>>(new Set());

  const YT_PREVIEW = 8;
  const visibleYtAlbums = $derived(showAllYt ? ytAlbums : ytAlbums.slice(0, YT_PREVIEW));

  $effect(() => {
    loadArtist(page.params.id);
  });

  async function loadArtist(id: string) {
    loading = true;
    showAllYt = false;
    try {
      const data = await subsonic.getArtist(id);
      artist = data.artist;
      albums = data.albums;
      // Search YouTube for this artist's albums in the background
      api.searchYouTubeAlbums(data.artist.name, 20).then((r) => (ytAlbums = r)).catch(() => {});
    } catch {
      artist = null;
      albums = [];
    } finally {
      loading = false;
    }
  }

  async function importAlbum(album: YouTubeAlbumResult) {
    importingAlbums = new Set([...importingAlbums, album.playlist_id]);
    try {
      await api.importPlaylist(album.url, album.title);
      importingAlbums.delete(album.playlist_id);
      importingAlbums = new Set(importingAlbums);
      importedAlbums = new Set([...importedAlbums, album.playlist_id]);
    } catch {
      importingAlbums.delete(album.playlist_id);
      importingAlbums = new Set(importingAlbums);
    }
  }
</script>

<div class="artist-page">
  {#if loading}
    <p class="loading-text">Loading...</p>
  {:else if artist}
    <h1 class="page-title">{artist.name}</h1>

    {#if albums.length > 0}
      <section class="section">
        <h2 class="section-title">In Your Library</h2>
        <p class="album-count">{artist.albumCount} album{artist.albumCount !== 1 ? 's' : ''}</p>
        <div class="album-grid">
          {#each albums as album}
            <AlbumCard {album} />
          {/each}
        </div>
      </section>
    {/if}

    <section class="section">
      <h2 class="section-title">YouTube Albums</h2>
      {#if ytAlbums.length === 0}
        <p class="loading-text">Searching YouTube...</p>
      {:else}
        <div class="yt-album-grid">
          {#each visibleYtAlbums as album}
            <div class="yt-album-card">
              {#if album.thumbnail_url}
                <img src={album.thumbnail_url} alt={album.title} class="yt-album-art" />
              {:else}
                <div class="yt-album-art placeholder">
                  <svg viewBox="0 0 24 24" width="40" height="40" fill="var(--text-subdued)"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
                </div>
              {/if}
              <div class="yt-album-name">{album.title}</div>
              {#if album.track_count > 0}
                <div class="yt-album-meta">{album.track_count} tracks</div>
              {/if}
              {#if importedAlbums.has(album.playlist_id)}
                <a href="/playlists" class="yt-album-imported">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="var(--accent)"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                  View in Playlists
                </a>
              {:else if importingAlbums.has(album.playlist_id)}
                <span class="yt-album-importing">
                  <svg class="spin" viewBox="0 0 24 24" width="12" height="12" fill="var(--text-secondary)"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>
                  Importing...
                </span>
              {:else}
                <button class="yt-album-import-btn" onclick={() => importAlbum(album)}>
                  Import Album
                </button>
              {/if}
            </div>
          {/each}
        </div>
        {#if ytAlbums.length > YT_PREVIEW}
          <button class="show-more-btn" onclick={() => showAllYt = !showAllYt}>
            {showAllYt ? 'Show less' : `Show ${ytAlbums.length - YT_PREVIEW} more albums`}
          </button>
        {/if}
      {/if}
    </section>
  {/if}
</div>

<style>
  .artist-page {
    max-width: 1200px;
  }

  .page-title {
    font-size: 32px;
    font-weight: 700;
    margin-bottom: 24px;
  }

  .section {
    margin-bottom: 36px;
  }

  .section-title {
    font-size: 20px;
    font-weight: 700;
    margin-bottom: 12px;
  }

  .album-count {
    color: var(--text-secondary);
    font-size: 14px;
    margin-bottom: 16px;
  }

  .album-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 16px;
  }

  .yt-album-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 14px;
  }

  .yt-album-card {
    display: flex;
    flex-direction: column;
    background: var(--bg-secondary);
    border-radius: 8px;
    padding: 12px;
    gap: 6px;
  }

  .yt-album-art {
    width: 100%;
    aspect-ratio: 1;
    border-radius: 4px;
    object-fit: cover;
    margin-bottom: 4px;
  }

  .yt-album-art.placeholder {
    background: var(--bg-elevated);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .yt-album-name {
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .yt-album-meta {
    font-size: 11px;
    color: var(--text-secondary);
  }

  .yt-album-import-btn {
    margin-top: 4px;
    padding: 5px 0;
    background: transparent;
    border: 1px solid var(--text-secondary);
    border-radius: 12px;
    color: var(--text-primary);
    font-size: 11px;
    font-weight: 600;
    transition: all 0.15s;
  }

  .yt-album-import-btn:hover {
    border-color: var(--text-primary);
  }

  .yt-album-importing {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    font-size: 11px;
    color: var(--text-secondary);
    margin-top: 4px;
  }

  .yt-album-imported {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    font-size: 11px;
    color: var(--accent);
    font-weight: 600;
    margin-top: 4px;
  }

  .show-more-btn {
    margin-top: 16px;
    padding: 8px 20px;
    background: transparent;
    border: 1px solid var(--text-secondary);
    border-radius: 16px;
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 600;
    transition: all 0.15s;
  }

  .show-more-btn:hover {
    border-color: var(--text-primary);
  }

  .loading-text {
    color: var(--text-secondary);
    font-size: 14px;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .spin {
    animation: spin 1s linear infinite;
  }
</style>
