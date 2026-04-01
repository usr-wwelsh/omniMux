<script lang="ts">
  import { subsonic, type Playlist } from '$lib/subsonic';
  import { coverArtUrl } from '$lib/subsonic';

  let playlists = $state<Playlist[]>([]);
  let loading = $state(true);

  $effect(() => {
    subsonic.getPlaylists()
      .then((p) => (playlists = p))
      .catch(() => {})
      .finally(() => (loading = false));
  });

  function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }
</script>

<div class="playlists-page">
  <h1 class="page-title">Playlists</h1>

  {#if loading}
    <p class="status-text">Loading...</p>
  {:else if playlists.length === 0}
    <p class="status-text">No playlists yet. Import a YouTube playlist from the Downloads page to get started.</p>
  {:else}
    <div class="playlist-grid">
      {#each playlists as pl}
        <a href="/playlists/{pl.id}" class="playlist-card">
          <div class="playlist-art">
            <svg viewBox="0 0 24 24" width="48" height="48" fill="var(--text-subdued)"><path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/></svg>
          </div>
          <div class="playlist-name">{pl.name}</div>
          <div class="playlist-meta">
            {pl.songCount} track{pl.songCount !== 1 ? 's' : ''}
            {#if pl.duration > 0} &middot; {formatDuration(pl.duration)}{/if}
          </div>
        </a>
      {/each}
    </div>
  {/if}
</div>

<style>
  .playlists-page {
    max-width: 1200px;
  }

  .page-title {
    font-size: 32px;
    font-weight: 700;
    margin-bottom: 24px;
  }

  .status-text {
    color: var(--text-secondary);
    font-size: 14px;
  }

  .playlist-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 16px;
  }

  .playlist-card {
    display: flex;
    flex-direction: column;
    padding: 12px;
    background: var(--bg-secondary);
    border-radius: 8px;
    transition: background 0.2s;
  }

  .playlist-card:hover {
    background: var(--bg-elevated);
  }

  .playlist-art {
    width: 100%;
    aspect-ratio: 1;
    border-radius: 4px;
    background: var(--bg-elevated);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 12px;
  }

  .playlist-name {
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-bottom: 4px;
  }

  .playlist-meta {
    font-size: 12px;
    color: var(--text-secondary);
  }
</style>
