<script lang="ts">
  import { subsonic, type Playlist, coverArtUrl } from '$lib/subsonic';
  import { api } from '$lib/api';

  let playlists = $state<Playlist[]>([]);
  let loading = $state(true);
  let syncing = $state(false);
  let backfilling = $state(false);
  let syncResult = $state<string | null>(null);
  let coverArts = $state<Map<string, string[]>>(new Map());

  $effect(() => {
    subsonic.getPlaylists()
      .then((p) => {
        playlists = p;
        loadCoverArts(p);
      })
      .catch(() => {})
      .finally(() => (loading = false));
  });

  async function loadCoverArts(pls: Playlist[]) {
    await Promise.all(pls.map(async (pl) => {
      try {
        const ids = await subsonic.getPlaylistCoverArts(pl.id);
        const urls = await Promise.all(ids.map((id) => coverArtUrl(id, 150)));
        coverArts = new Map(coverArts).set(pl.id, urls);
      } catch {
        // leave empty, fallback icon will show
      }
    }));
  }

  async function backfillMoods() {
    backfilling = true;
    syncResult = null;
    try {
      const result = await api.backfillMoods();
      syncResult = `Analyzed ${result.updated} of ${result.total} tracks. Now click "Sync mood playlists".`;
    } catch (e: any) {
      syncResult = `Error: ${e.message}`;
    } finally {
      backfilling = false;
    }
  }

  async function syncMoods() {
    syncing = true;
    syncResult = null;
    try {
      const result = await api.syncMoodPlaylists();
      const moods = Object.entries(result.synced);
      if (moods.length === 0) {
        syncResult = 'No mood data found. Download some tracks first.';
      } else {
        syncResult = `Synced: ${moods.map(([m, n]) => `${m} (${n})`).join(', ')}`;
        // Refresh playlist list
        playlists = await subsonic.getPlaylists();
        await loadCoverArts(playlists);
      }
    } catch (e: any) {
      syncResult = `Error: ${e.message}`;
    } finally {
      syncing = false;
    }
  }

  function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }
</script>

<div class="playlists-page">
  <div class="page-header">
    <h1 class="page-title">Playlists</h1>
    <button class="sync-btn" onclick={backfillMoods} disabled={backfilling || syncing}>
      {backfilling ? 'Analyzing…' : 'Analyze moods'}
    </button>
    <button class="sync-btn" onclick={syncMoods} disabled={syncing || backfilling}>
      {syncing ? 'Syncing…' : 'Sync mood playlists'}
    </button>
  </div>

  {#if syncResult}
    <p class="sync-result">{syncResult}</p>
  {/if}

  {#if loading}
    <p class="status-text">Loading...</p>
  {:else if playlists.length === 0}
    <p class="status-text">No playlists yet. Import a YouTube playlist from the Downloads page to get started.</p>
  {:else}
    <div class="playlist-grid">
      {#each playlists as pl}
        <a href="/playlists/{pl.id}" class="playlist-card">
          <div class="playlist-art">
            {#if (coverArts.get(pl.id) ?? []).length > 0}
              <div class="art-collage" class:single={(coverArts.get(pl.id) ?? []).length === 1}>
                {#each (coverArts.get(pl.id) ?? []).slice(0, 4) as url}
                  <img src={url} alt="" />
                {/each}
              </div>
            {:else}
              <svg viewBox="0 0 24 24" width="48" height="48" fill="var(--text-subdued)"><path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/></svg>
            {/if}
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

  .page-header {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 24px;
  }

  .page-title {
    font-size: 32px;
    font-weight: 700;
    flex: 1;
    margin: 0;
  }

  .sync-btn {
    background: var(--bg-elevated);
    color: var(--text-primary);
    border: 1px solid var(--border, rgba(255,255,255,0.1));
    border-radius: 20px;
    padding: 8px 16px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.2s;
  }

  .sync-btn:hover:not(:disabled) {
    background: var(--bg-secondary);
  }

  .sync-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .sync-result {
    font-size: 13px;
    color: var(--text-secondary);
    margin-bottom: 16px;
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
    overflow: hidden;
  }

  .art-collage {
    width: 100%;
    height: 100%;
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
  }

  .art-collage.single {
    grid-template-columns: 1fr;
    grid-template-rows: 1fr;
  }

  .art-collage img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
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
