<script lang="ts">
  import { subsonic, type Artist, type Album, type Song } from '$lib/subsonic';
  import { playQueue } from '$lib/stores/player';
  import {
    cachedLibrary, loadLibrary, refreshLibrary, isStale,
    rememberRanking, recalledRanking, libraryView, type SortKey,
  } from '$lib/stores/libraryCache';
  import AlbumCard from '../../components/AlbumCard.svelte';

  const cached = cachedLibrary();

  let albums = $state<Album[]>(cached?.albums ?? []);
  let artists = $state<(Artist & { coverUrl?: string })[]>(cached?.artists ?? []);
  let loading = $state(cached === null);
  let shuffling = $state(false);

  const sortOptions: { value: SortKey; label: string }[] = [
    { value: 'name', label: 'Name' },
    { value: 'artist', label: 'Artist' },
    { value: 'added', label: 'Recently added' },
    { value: 'year', label: 'Year' },
    { value: 'played', label: 'Recently played' },
    { value: 'plays', label: 'Most played' },
  ];

  // Toolbar state lives in the store so it survives leaving and coming back.
  let filter = $derived($libraryView.filter);
  let sortBy = $derived($libraryView.sortBy);
  let genreFilter = $derived($libraryView.genreFilter);

  // Genres come from the loaded albums rather than getGenres.view — no extra
  // request, and the list only ever offers genres you actually own.
  const genres = $derived.by(() => {
    const seen = new Map<string, string>();
    for (const a of albums) {
      const g = a.genre?.trim();
      if (g) seen.set(g.toLowerCase(), g);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  });

  // 'added'/'played'/'plays' are orderings only Navidrome can compute, so they're
  // fetched as ranked id lists on demand and cached for the session.
  const SERVER_SORTS: Partial<Record<SortKey, 'newest' | 'recent' | 'frequent'>> = {
    added: 'newest',
    played: 'recent',
    plays: 'frequent',
  };

  let rankings = $state<Partial<Record<SortKey, Map<string, number>>>>({
    ...(cached ? Object.fromEntries(
      (Object.keys(SERVER_SORTS) as SortKey[])
        .map((k) => [k, recalledRanking(k)])
        .filter(([, rank]) => rank),
    ) : {}),
  });
  let rankLoading = $state(false);

  async function ensureRanking(key: SortKey) {
    const type = SERVER_SORTS[key];
    if (!type || rankings[key]) return;
    rankLoading = true;
    try {
      const ordered = await subsonic.getAlbumsByType(type);
      const rank = new Map(ordered.map((a, i) => [a.id, i]));
      rememberRanking(key, rank);
      rankings = { ...rankings, [key]: rank };
    } catch {
      // Leave unranked — the list falls back to name order below.
    } finally {
      rankLoading = false;
    }
  }

  $effect(() => { ensureRanking(sortBy); });

  const visibleAlbums = $derived.by(() => {
    const q = filter.trim().toLowerCase();
    const g = genreFilter.toLowerCase();
    const out = albums.filter((a) => {
      if (g && a.genre?.toLowerCase() !== g) return false;
      if (!q) return true;
      return a.name.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q);
    });

    const byName = (a: Album, b: Album) => a.name.localeCompare(b.name);

    if (SERVER_SORTS[sortBy]) {
      const rank = rankings[sortBy];
      if (!rank) return out.sort(byName);
      // Albums absent from the ranking (never played, etc.) sort last by name.
      return out.sort((a, b) => {
        const ra = rank.get(a.id) ?? Infinity;
        const rb = rank.get(b.id) ?? Infinity;
        return ra === rb ? byName(a, b) : ra - rb;
      });
    }

    if (sortBy === 'artist') {
      return out.sort((a, b) => a.artist.localeCompare(b.artist) || byName(a, b));
    }
    if (sortBy === 'year') {
      return out.sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || byName(a, b));
    }
    return out.sort(byName);
  });

  // Artists have no genre of their own, so a genre filter narrows them to those
  // credited on a matching album rather than hiding the section entirely.
  const visibleArtists = $derived.by(() => {
    const q = filter.trim().toLowerCase();
    const g = genreFilter.toLowerCase();
    const allowed = g
      ? new Set(albums.filter((a) => a.genre?.toLowerCase() === g).map((a) => a.artist.toLowerCase()))
      : null;
    return artists.filter((a) => {
      if (allowed && !allowed.has(a.name.toLowerCase())) return false;
      return !q || a.name.toLowerCase().includes(q);
    });
  });

  const isFiltered = $derived(filter.trim() !== '' || genreFilter !== '');

  function clearFilters() {
    libraryView.update((v) => ({ ...v, filter: '', genreFilter: '' }));
  }

  $effect(() => {
    load();
  });

  // A cached library renders straight away and is only re-fetched in the
  // background once it has had time to go out of date.
  async function load() {
    const snapshot = cachedLibrary();
    if (snapshot) {
      if (isStale(snapshot)) apply(await refreshLibrary());
      return;
    }
    loading = true;
    try {
      apply(await loadLibrary());
    } catch {
      albums = [];
      artists = [];
    } finally {
      loading = false;
    }
  }

  function apply(snapshot: { albums: Album[]; artists: Artist[] }) {
    albums = snapshot.albums;
    artists = snapshot.artists;
  }

  const SHUFFLE_SONG_LIMIT = 500;
  const SHUFFLE_ALBUM_LIMIT = 60;

  function shuffled<T>(items: T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  // getRandomSongs.view can't be narrowed by the album/artist text filter, so a
  // filtered shuffle pulls tracks from the albums on screen instead — capped so a
  // wide filter doesn't fan out into hundreds of getAlbum calls.
  async function filteredSongs(): Promise<Song[]> {
    const picks = shuffled(visibleAlbums).slice(0, SHUFFLE_ALBUM_LIMIT);
    const tracks = await Promise.all(
      picks.map((a) => subsonic.getAlbum(a.id).then((r) => r.songs).catch(() => [] as Song[])),
    );
    return shuffled(tracks.flat()).slice(0, SHUFFLE_SONG_LIMIT);
  }

  async function shuffleAll() {
    shuffling = true;
    try {
      const songs = isFiltered
        ? await filteredSongs()
        : await subsonic.getRandomSongs(SHUFFLE_SONG_LIMIT);
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
      <button
        class="shuffle-btn"
        onclick={shuffleAll}
        disabled={shuffling || (isFiltered && visibleAlbums.length === 0)}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>
        </svg>
        {shuffling ? 'Loading...' : isFiltered ? 'Shuffle Filtered' : 'Shuffle All'}
      </button>
    {/if}
  </div>

  {#if loading}
    <p class="loading-text">Loading...</p>
  {:else if albums.length === 0 && artists.length === 0}
    <p class="empty-text">No music in your library yet. Cache some music from YouTube!</p>
  {:else}
    <div class="toolbar">
      <div class="filter-wrap">
        <svg class="filter-icon" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
          <path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
        </svg>
        <input
          class="filter-input"
          type="search"
          placeholder="Filter by album or artist..."
          bind:value={$libraryView.filter}
        />
      </div>

      {#if genres.length > 1}
        <select class="toolbar-select" bind:value={$libraryView.genreFilter} aria-label="Filter by genre">
          <option value="">All genres</option>
          {#each genres as g (g)}
            <option value={g}>{g}</option>
          {/each}
        </select>
      {/if}

      <select class="toolbar-select" bind:value={$libraryView.sortBy} aria-label="Sort albums">
        {#each sortOptions as opt (opt.value)}
          <option value={opt.value}>Sort: {opt.label}</option>
        {/each}
      </select>

      {#if isFiltered}
        <button class="clear-btn" onclick={clearFilters}>Clear</button>
      {/if}
    </div>

    {#if isFiltered && visibleAlbums.length === 0 && visibleArtists.length === 0}
      <p class="empty-text">No albums or artists match that filter.</p>
    {/if}

    {#if visibleAlbums.length > 0}
      <section class="section">
        <h2 class="section-title">
          Albums
          {#if isFiltered}<span class="count">{visibleAlbums.length}</span>{/if}
          {#if rankLoading}<span class="count">sorting…</span>{/if}
        </h2>
        <div class="album-grid">
          {#each visibleAlbums as album (album.id)}
            <AlbumCard {album} />
          {/each}
        </div>
      </section>
    {/if}

    {#if visibleArtists.length > 0}
      <section class="section">
        <h2 class="section-title">
          Artists
          {#if isFiltered}<span class="count">{visibleArtists.length}</span>{/if}
        </h2>
        <div class="artist-grid">
          {#each visibleArtists as artist (artist.id)}
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

  .toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 28px;
  }

  .filter-wrap {
    position: relative;
    flex: 1 1 260px;
    min-width: 0;
  }

  .filter-icon {
    position: absolute;
    left: 12px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--text-subdued);
    pointer-events: none;
  }

  .filter-input {
    width: 100%;
    padding: 9px 12px 9px 36px;
    background: var(--bg-secondary);
    border: 1px solid transparent;
    border-radius: 20px;
    color: var(--text-primary);
    font-size: 14px;
  }

  .filter-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .filter-input::placeholder { color: var(--text-subdued); }

  .toolbar-select {
    padding: 9px 12px;
    background: var(--bg-secondary);
    border: 1px solid transparent;
    border-radius: 20px;
    color: var(--text-secondary);
    font-size: 13px;
    cursor: pointer;
    max-width: 190px;
  }

  .toolbar-select:focus {
    outline: none;
    border-color: var(--accent);
  }

  .clear-btn {
    padding: 9px 14px;
    background: none;
    border: none;
    color: var(--text-secondary);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }

  .clear-btn:hover { color: var(--text-primary); }

  .count {
    color: var(--text-subdued);
    font-size: 14px;
    font-weight: 400;
    margin-left: 6px;
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

  @media (max-width: 600px) {
    .album-grid,
    .artist-grid {
      grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
      gap: 12px;
    }

    .artist-img {
      width: 88px;
      height: 88px;
    }

    .artist-card {
      padding: 12px;
    }
  }
</style>
