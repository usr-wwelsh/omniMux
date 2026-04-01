<script lang="ts">
  import { page } from '$app/state';
  import { subsonic, type Playlist, type Song } from '$lib/subsonic';
  import TrackList from '../../../components/TrackList.svelte';

  let playlist = $state<Playlist | null>(null);
  let songs = $state<Song[]>([]);
  let loading = $state(true);

  $effect(() => {
    loadPlaylist(page.params.id);
  });

  async function loadPlaylist(id: string) {
    loading = true;
    try {
      const data = await subsonic.getPlaylist(id);
      playlist = data.playlist;
      songs = data.songs;
    } catch {
      playlist = null;
      songs = [];
    } finally {
      loading = false;
    }
  }

  function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }
</script>

<div class="playlist-page">
  {#if loading}
    <p class="loading-text">Loading...</p>
  {:else if playlist}
    <div class="playlist-header">
      <div class="playlist-icon">
        <svg viewBox="0 0 24 24" width="64" height="64" fill="var(--text-subdued)"><path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/></svg>
      </div>
      <div class="playlist-info">
        <h1 class="page-title">{playlist.name}</h1>
        <p class="playlist-meta">
          {playlist.songCount} track{playlist.songCount !== 1 ? 's' : ''}
          {#if playlist.duration > 0} &middot; {formatDuration(playlist.duration)}{/if}
        </p>
      </div>
    </div>

    {#if songs.length > 0}
      <TrackList {songs} showAlbum />
    {:else}
      <p class="loading-text">This playlist is empty. Tracks will appear here once downloads complete.</p>
    {/if}
  {:else}
    <p class="loading-text">Playlist not found.</p>
  {/if}
</div>

<style>
  .playlist-page {
    max-width: 900px;
  }

  .playlist-header {
    display: flex;
    align-items: center;
    gap: 24px;
    margin-bottom: 32px;
  }

  .playlist-icon {
    width: 120px;
    height: 120px;
    border-radius: 8px;
    background: var(--bg-elevated);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .playlist-info {
    flex: 1;
    min-width: 0;
  }

  .page-title {
    font-size: 32px;
    font-weight: 700;
    margin-bottom: 8px;
  }

  .playlist-meta {
    color: var(--text-secondary);
    font-size: 14px;
  }

  .loading-text {
    color: var(--text-secondary);
    font-size: 14px;
  }
</style>
