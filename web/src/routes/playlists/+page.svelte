<script lang="ts">
  import { goto } from '$app/navigation';
  import { errorMessage } from '$lib/errors';
  import { subsonic, type Playlist, type Song, coverArtUrl } from '$lib/subsonic';
  import { isGuest } from '$lib/auth';
  import { focusOnMount } from '$lib/focusOnMount';

  type SortBy = 'name' | 'updated' | 'created' | 'tracks' | 'mostPlayed' | 'recentlyPlayed';
  const SORT_OPTIONS: SortBy[] = ['name', 'updated', 'created', 'tracks', 'mostPlayed', 'recentlyPlayed'];
  const CONTENT_SORTS: SortBy[] = ['mostPlayed', 'recentlyPlayed'];
  const SORT_STORAGE_KEY = 'omnimux-playlist-sort';
  const HIDE_MOOD_STORAGE_KEY = 'omnimux-playlist-hide-mood';
  const MOOD_PREFIX = 'Mood: ';

  function loadStoredSort(): SortBy {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(SORT_STORAGE_KEY) : null;
    return SORT_OPTIONS.includes(stored as SortBy) ? (stored as SortBy) : 'name';
  }

  function loadStoredHideMood(): boolean {
    return typeof localStorage !== 'undefined' && localStorage.getItem(HIDE_MOOD_STORAGE_KEY) === 'true';
  }

  let playlists = $state<Playlist[]>([]);
  let loading = $state(true);
  let coverArts = $state<Map<string, string[]>>(new Map());
  let creatingPlaylist = $state(false);
  let newPlaylistName = $state('');
  let createError = $state('');
  let searchQuery = $state('');
  let sortBy = $state<SortBy>(loadStoredSort());
  let hideMoodPlaylists = $state(loadStoredHideMood());
  let trackContents = $state<Map<string, Song[]> | null>(null);
  let loadingTracks = $state(false);

  $effect(() => {
    localStorage.setItem(SORT_STORAGE_KEY, sortBy);
  });

  $effect(() => {
    localStorage.setItem(HIDE_MOOD_STORAGE_KEY, String(hideMoodPlaylists));
  });

  $effect(() => {
    subsonic.getPlaylists()
      .then((p) => {
        playlists = p;
        loadCoverArts(p);
      })
      .catch(() => {})
      .finally(() => (loading = false));
  });

  // Track contents are only needed once someone searches or sorts by play data,
  // so fetch them lazily rather than pulling every playlist's songs on every page load.
  let searchDebounce: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const hasQuery = searchQuery.trim().length > 0;
    const needsContents = hasQuery || CONTENT_SORTS.includes(sortBy);
    clearTimeout(searchDebounce);
    if (!needsContents || trackContents || loadingTracks) return;
    searchDebounce = setTimeout(() => {
      loadingTracks = true;
      subsonic.getPlaylistContents()
        .then((m) => (trackContents = m))
        .catch(() => {})
        .finally(() => (loadingTracks = false));
    }, hasQuery ? 300 : 0);
  });

  // Navidrome tracks play_count/played per song, not per playlist, so "most
  // played" / "recently played" are aggregated from each playlist's songs.
  function playStats(pl: Playlist): { count: number; lastPlayed: string } {
    const songs = trackContents?.get(pl.id);
    if (!songs) return { count: 0, lastPlayed: '' };
    let count = 0;
    let lastPlayed = '';
    for (const s of songs) {
      count += s.playCount;
      if (s.played && s.played > lastPlayed) lastPlayed = s.played;
    }
    return { count, lastPlayed };
  }

  function matchesSearch(pl: Playlist, needle: string): boolean {
    if (pl.name.toLowerCase().includes(needle)) return true;
    const songs = trackContents?.get(pl.id);
    if (!songs) return false;
    return songs.some(
      (s) => s.title.toLowerCase().includes(needle) || s.artist.toLowerCase().includes(needle),
    );
  }

  let visiblePlaylists = $derived.by(() => {
    const base = hideMoodPlaylists ? playlists.filter((pl) => !pl.name.startsWith(MOOD_PREFIX)) : playlists;
    const query = searchQuery.trim().toLowerCase();
    const filtered = query ? base.filter((pl) => matchesSearch(pl, query)) : base;
    const sorted = [...filtered];
    switch (sortBy) {
      case 'name':
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'tracks':
        sorted.sort((a, b) => b.songCount - a.songCount);
        break;
      case 'updated':
        sorted.sort((a, b) => (b.changedAt ?? '').localeCompare(a.changedAt ?? ''));
        break;
      case 'created':
        sorted.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
        break;
      case 'mostPlayed':
        sorted.sort((a, b) => playStats(b).count - playStats(a).count);
        break;
      case 'recentlyPlayed':
        sorted.sort((a, b) => playStats(b).lastPlayed.localeCompare(playStats(a).lastPlayed));
        break;
    }
    return sorted;
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

  async function createPlaylist() {
    const name = newPlaylistName.trim();
    if (!name) return;
    createError = '';
    try {
      const pl = await subsonic.createPlaylist(name);
      goto(`/playlists/${pl.id}`);
    } catch (e) {
      createError = errorMessage(e, 'Failed to create playlist');
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
    {#if !$isGuest}
      {#if creatingPlaylist}
        <input
          class="name-input"
          type="text"
          placeholder="Playlist name"
          bind:value={newPlaylistName}
          onkeydown={(e) => e.key === 'Enter' && createPlaylist()}
          use:focusOnMount
        />
        <button class="sync-btn" onclick={createPlaylist} disabled={!newPlaylistName.trim()}>Create</button>
        <button class="sync-btn" onclick={() => (creatingPlaylist = false)}>Cancel</button>
      {:else}
        <button class="sync-btn" onclick={() => (creatingPlaylist = true)}>New playlist</button>
      {/if}
    {/if}
  </div>

  {#if createError}
    <p class="sync-result error">{createError}</p>
  {/if}

  {#if !loading && playlists.length > 0}
    <div class="filter-bar">
      <input
        class="search-input"
        type="text"
        placeholder="Search playlists and tracks..."
        bind:value={searchQuery}
      />
      <label class="sort-group">
        <span class="sort-label">Sort</span>
        <select class="sort-select" bind:value={sortBy}>
          <option value="name">Name</option>
          <option value="updated">Recently updated</option>
          <option value="created">Recently created</option>
          <option value="tracks">Track count</option>
          <option value="mostPlayed">Most played</option>
          <option value="recentlyPlayed">Recently played</option>
        </select>
      </label>
      <label class="mood-toggle">
        <input type="checkbox" bind:checked={hideMoodPlaylists} />
        Hide mood playlists
      </label>
      {#if loadingTracks}
        <span class="status-text">Loading track data...</span>
      {/if}
    </div>
  {/if}

  {#if loading}
    <p class="status-text">Loading...</p>
  {:else if playlists.length === 0}
    <p class="status-text">No playlists yet. Import a YouTube playlist from the Downloads page to get started.</p>
  {:else if visiblePlaylists.length === 0}
    <p class="status-text">No playlists match "{searchQuery}".</p>
  {:else}
    <div class="playlist-grid">
      {#each visiblePlaylists as pl (pl.id)}
        <a href="/playlists/{pl.id}" class="playlist-card">
          <div class="playlist-art">
            {#if (coverArts.get(pl.id) ?? []).length > 0}
              <div class="art-collage" class:single={(coverArts.get(pl.id) ?? []).length === 1}>
                {#each (coverArts.get(pl.id) ?? []).slice(0, 4) as url, i (i)}
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

  .sync-result.error {
    color: var(--danger);
  }

  .name-input {
    padding: 8px 14px;
    background: var(--bg-elevated);
    border: 1px solid var(--border, rgba(255,255,255,0.1));
    border-radius: 20px;
    color: var(--text-primary);
    font-size: 13px;
    outline: none;
    min-width: 0;
  }

  .status-text {
    color: var(--text-secondary);
    font-size: 14px;
  }

  .filter-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 20px;
  }

  .search-input {
    flex: 1;
    min-width: 0;
    max-width: 360px;
    padding: 8px 14px;
    background: var(--bg-elevated);
    border: 1px solid var(--border, rgba(255,255,255,0.1));
    border-radius: 20px;
    color: var(--text-primary);
    font-size: 13px;
    outline: none;
  }

  .sort-group {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 4px 4px 12px;
    background: var(--bg-secondary);
    border: 1px solid var(--border, rgba(255,255,255,0.1));
    border-radius: 8px;
  }

  .sort-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-subdued, var(--text-secondary));
    white-space: nowrap;
  }

  .sort-select {
    padding: 6px 10px;
    background: var(--bg-elevated);
    border: none;
    border-radius: 6px;
    color: var(--text-primary);
    font-size: 13px;
    outline: none;
    cursor: pointer;
  }

  .mood-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--text-secondary);
    white-space: nowrap;
    cursor: pointer;
  }

  .mood-toggle input {
    cursor: pointer;
  }

  .playlist-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 16px;
  }

  @media (max-width: 600px) {
    .playlist-grid {
      grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
      gap: 12px;
    }
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
