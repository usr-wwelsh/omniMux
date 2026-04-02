<script lang="ts">
  import { subsonic, type Artist, type Album } from '$lib/subsonic';
  import { playQueue } from '$lib/stores/player';
  import AlbumCard from '../../components/AlbumCard.svelte';

  let albums = $state<Album[]>([]);
  let artists = $state<(Artist & { coverUrl?: string })[]>([]);
  let loading = $state(true);
  let shuffling = $state(false);

  $effect(() => {
    load();
  });

  async function load() {
    loading = true;
    try {
      const [rawAlbums, rawArtists] = await Promise.all([
        subsonic.getAllAlbums(),
        subsonic.getArtists(),
      ]);
      albums = rawAlbums;
      artists = rawArtists;
    } catch {
      albums = [];
      artists = [];
    } finally {
      loading = false;
    }
  }

  async function shuffleAll() {
    shuffling = true;
    try {
      const songs = await subsonic.getRandomSongs(500);
      if (songs.length > 0) await playQueue(songs, 0);
    } finally {
      shuffling = false;
    }
  }
</script>

<div class="library">
  <div class="page-header">
    <h1 class="page-title">Library</h1>
    {#if !loading && (albums.length > 0 || artists.length > 0)}
      <button class="shuffle-btn" onclick={shuffleAll} disabled={shuffling}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>
        </svg>
        {shuffling ? 'Loading...' : 'Shuffle All'}
      </button>
    {/if}
  </div>

  {#if loading}
    <p class="loading-text">Loading...</p>
  {:else if albums.length === 0 && artists.length === 0}
    <p class="empty-text">No music in your library yet. Cache some music from YouTube!</p>
  {:else}
    {#if albums.length > 0}
      <section class="section">
        <h2 class="section-title">Albums</h2>
        <div class="album-grid">
          {#each albums as album}
            <AlbumCard {album} />
          {/each}
        </div>
      </section>
    {/if}

    {#if artists.length > 0}
      <section class="section">
        <h2 class="section-title">Artists</h2>
        <div class="artist-grid">
          {#each artists as artist}
            <a href="/library/artist/{artist.id}" class="artist-card">
              <div class="artist-img placeholder">
                <svg viewBox="0 0 24 24" width="40" height="40" fill="var(--text-subdued)"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
              </div>
              <div class="artist-name">{artist.name}</div>
              <div class="artist-albums">{artist.albumCount} album{artist.albumCount !== 1 ? 's' : ''}</div>
            </a>
          {/each}
        </div>
      </section>
    {/if}
  {/if}
</div>

<style>
  .library {
    max-width: 1200px;
  }

  .page-header {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 24px;
  }

  .page-title {
    font-size: 32px;
    font-weight: 700;
    margin-bottom: 0;
  }

  .shuffle-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    background: var(--accent);
    color: #000;
    border: none;
    border-radius: 20px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.2s;
  }

  .shuffle-btn:hover {
    opacity: 0.85;
  }

  .shuffle-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .loading-text, .empty-text {
    color: var(--text-secondary);
    font-size: 14px;
  }

  .section {
    margin-bottom: 40px;
  }

  .section-title {
    font-size: 20px;
    font-weight: 700;
    margin-bottom: 16px;
  }

  .album-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 16px;
  }

  .artist-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 16px;
  }

  .artist-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 16px;
    background: var(--bg-secondary);
    border-radius: 8px;
    text-align: center;
    transition: background 0.2s;
  }

  .artist-card:hover {
    background: var(--bg-elevated);
  }

  .artist-img {
    width: 120px;
    height: 120px;
    border-radius: 50%;
    object-fit: cover;
    margin-bottom: 12px;
  }

  .artist-img.placeholder {
    background: var(--bg-elevated);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .artist-name {
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 4px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }

  .artist-albums {
    font-size: 12px;
    color: var(--text-secondary);
  }
</style>
