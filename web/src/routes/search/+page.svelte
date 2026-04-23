<script lang="ts">
  import { page } from '$app/state';
  import { api, thumbUrl, type YouTubeResult } from '$lib/api';
  import { subsonic, type Artist, type Album, type Song } from '$lib/subsonic';
  import { playSong, formatTime } from '$lib/stores/player';
  import { isGuest } from '$lib/auth';
  import TrackList from '../../components/TrackList.svelte';
  import AlbumCard from '../../components/AlbumCard.svelte';

  let query = $state(page.url.searchParams.get('q') ?? '');
  let libraryArtists = $state<Artist[]>([]);
  let libraryAlbums = $state<Album[]>([]);
  let librarySongs = $state<Song[]>([]);
  let youtubeResults = $state<YouTubeResult[]>([]);
  let cachedIds = $state<Set<string>>(new Set());
  let downloadingIds = $state<Map<string, number>>(new Map());
  let searching = $state(false);
  let errorIds = $state<Set<string>>(new Set());
  let expandedAlbums = $state<Set<string>>(new Set());
  let downloadingAlbumIds = $state<Set<string>>(new Set());
  let ytAlbumsVisible = $state(5);

  const albumGroups = $derived.by(() => {
    const hasAlbums = youtubeResults.some(r => r.album);
    if (!hasAlbums) return null;
    const groups = new Map<string, YouTubeResult[]>();
    for (const t of youtubeResults) {
      const key = t.album || 'Singles & Other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(t);
    }
    return groups;
  });
  let searchTimeout: ReturnType<typeof setTimeout>;
  let inputFocused = $state(false);

  let recentSearches = $state<string[]>(
    typeof localStorage !== 'undefined'
      ? JSON.parse(localStorage.getItem('omnimux-recent-searches') || '[]')
      : []
  );

  const showRecents = $derived(inputFocused && query.length < 2 && recentSearches.length > 0);

  function saveRecentSearch(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    const updated = [trimmed, ...recentSearches.filter(s => s !== trimmed)].slice(0, 8);
    recentSearches = updated;
    localStorage.setItem('omnimux-recent-searches', JSON.stringify(updated));
  }

  function removeRecentSearch(e: MouseEvent, q: string) {
    e.stopPropagation();
    const updated = recentSearches.filter(s => s !== q);
    recentSearches = updated;
    localStorage.setItem('omnimux-recent-searches', JSON.stringify(updated));
  }

  function selectRecent(q: string) {
    query = q;
    doSearch();
  }

  function handleInput() {
    clearTimeout(searchTimeout);
    if (query.length < 2) {
      libraryArtists = [];
      libraryAlbums = [];
      librarySongs = [];
      youtubeResults = [];
      return;
    }
    searchTimeout = setTimeout(() => doSearch(), 300);
  }

  // Fire immediately if navigated here with ?q= from discover
  if (query.length >= 2) doSearch();

  function toggleAlbum(albumName: string) {
    const next = new Set(expandedAlbums);
    if (next.has(albumName)) next.delete(albumName);
    else next.add(albumName);
    expandedAlbums = next;
  }

  async function downloadAlbumTracks(albumName: string, tracks: YouTubeResult[]) {
    if (downloadingAlbumIds.has(albumName)) return;
    downloadingAlbumIds = new Set([...downloadingAlbumIds, albumName]);
    await Promise.allSettled(tracks.map((t) => cacheTrack(t)));
    downloadingAlbumIds.delete(albumName);
    downloadingAlbumIds = new Set(downloadingAlbumIds);
  }

  function albumDlState(albumName: string, tracks: YouTubeResult[]): 'idle' | 'loading' | 'done' {
    if (downloadingAlbumIds.has(albumName)) return 'loading';
    if (tracks.every(t => cachedIds.has(t.youtube_id))) return 'done';
    return 'idle';
  }

  async function doSearch() {
    searching = true;
    expandedAlbums = new Set();
    ytAlbumsVisible = 5;
    try {
      if ($isGuest) {
        const libraryResult = await subsonic.search(query);
        libraryArtists = libraryResult.artists;
        libraryAlbums = libraryResult.albums;
        librarySongs = libraryResult.songs;
      } else {
        const [libraryResult, ytResult, cached] = await Promise.all([
          subsonic.search(query),
          api.searchYouTube(query),
          api.getCachedIds(),
        ]);
        libraryArtists = libraryResult.artists;
        libraryAlbums = libraryResult.albums;
        librarySongs = libraryResult.songs;
        youtubeResults = ytResult;
        cachedIds = new Set(cached);
      }
      saveRecentSearch(query);
    } catch {
      // ignore
    } finally {
      searching = false;
    }
  }

  async function cacheTrack(result: YouTubeResult) {
    errorIds.delete(result.youtube_id);
    errorIds = new Set(errorIds);
    try {
      const resp = await api.startDownload(result.url, result.youtube_id, result.title, result.artist, result.album || undefined);
      if (resp.already_cached) {
        cachedIds = new Set([...cachedIds, result.youtube_id]);
      } else {
        downloadingIds = new Map([...downloadingIds, [result.youtube_id, resp.download_id]]);
        pollDownload(result.youtube_id, resp.download_id);
      }
    } catch {
      errorIds = new Set([...errorIds, result.youtube_id]);
    }
  }

  async function pollDownload(ytId: string, dlId: number) {
    let failures = 0;
    const interval = setInterval(async () => {
      try {
        const status = await api.getDownloadStatus(dlId);
        failures = 0;
        if (status.status === 'completed') {
          clearInterval(interval);
          downloadingIds.delete(ytId);
          downloadingIds = new Map(downloadingIds);
          cachedIds = new Set([...cachedIds, ytId]);
        } else if (status.status === 'failed') {
          clearInterval(interval);
          downloadingIds.delete(ytId);
          downloadingIds = new Map(downloadingIds);
          errorIds = new Set([...errorIds, ytId]);
        }
      } catch {
        // Only give up after 5 consecutive network errors
        if (++failures >= 5) {
          clearInterval(interval);
          downloadingIds.delete(ytId);
          downloadingIds = new Map(downloadingIds);
          errorIds = new Set([...errorIds, ytId]);
        }
      }
    }, 2000);
  }

  function formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  const hasLibraryResults = $derived(
    libraryArtists.length > 0 || libraryAlbums.length > 0 || librarySongs.length > 0
  );
</script>

<div class="search-page">
  <div class="search-bar-wrapper">
    <svg class="search-icon" viewBox="0 0 24 24" width="20" height="20" fill="var(--text-secondary)"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
    <input
      type="text"
      placeholder="What do you want to listen to?"
      bind:value={query}
      oninput={handleInput}
      onfocus={() => inputFocused = true}
      onblur={() => setTimeout(() => inputFocused = false, 150)}
      class="search-input"
    />
    {#if showRecents}
      <div class="recents-dropdown">
        {#each recentSearches as recent}
          <div class="recent-item" role="button" tabindex="0" onclick={() => selectRecent(recent)} onkeydown={(e) => e.key === 'Enter' && selectRecent(recent)}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="var(--text-secondary)"><path d="M13 3a9 9 0 1 0 0 18A9 9 0 0 0 13 3zm0 16a7 7 0 1 1 0-14A7 7 0 0 1 13 19zm.5-11H12v6l5.25 3.15.75-1.23-4.5-2.67V8z"/></svg>
            <span>{recent}</span>
            <button class="recent-remove" onclick={(e) => removeRecentSearch(e, recent)} aria-label="Remove">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            </button>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  {#if searching}
    <p class="status-text">Searching...</p>
  {/if}

  {#if hasLibraryResults}
    <section class="section">
      <h2 class="section-title">In Your Library</h2>

      {#if libraryArtists.length > 0}
        <h3 class="subsection-title">Artists</h3>
        <div class="artist-chips">
          {#each libraryArtists as artist}
            <a href="/library/artist/{artist.id}" class="artist-chip">
              <div class="artist-avatar">
                {artist.name.charAt(0).toUpperCase()}
              </div>
              <div class="artist-chip-info">
                <span class="artist-chip-name">{artist.name}</span>
                <span class="artist-chip-count">{artist.albumCount} album{artist.albumCount !== 1 ? 's' : ''}</span>
              </div>
            </a>
          {/each}
        </div>
      {/if}

      {#if libraryAlbums.length > 0}
        <h3 class="subsection-title">Albums</h3>
        <div class="album-grid">
          {#each libraryAlbums as album}
            <AlbumCard {album} />
          {/each}
        </div>
      {/if}

      {#if librarySongs.length > 0}
        <h3 class="subsection-title">Songs</h3>
        <TrackList songs={librarySongs} showAlbum />
      {/if}
    </section>
  {/if}

  {#if query.length >= 2 && !searching && !$isGuest}
    <a href="/browse/{encodeURIComponent(query)}" class="browse-artist-row">
      <div class="browse-artist-avatar">{query.charAt(0).toUpperCase()}</div>
      <div class="browse-artist-info">
        <span class="browse-artist-name">{query}</span>
        <span class="browse-artist-sub">Browse artist &amp; albums on YouTube</span>
      </div>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="var(--text-secondary)"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
    </a>
  {/if}

  {#if youtubeResults.length > 0 && !$isGuest}
    <section class="section">
      <h2 class="section-title">From YouTube</h2>
      {#if albumGroups}
        <p class="yt-meta">{youtubeResults.length} tracks · {albumGroups.size} album{albumGroups.size !== 1 ? 's' : ''}</p>
        <div class="yt-album-list">
          {#each [...albumGroups].slice(0, ytAlbumsVisible) as [albumName, tracks]}
            {@const isExpanded = expandedAlbums.has(albumName)}
            {@const dlState = albumDlState(albumName, tracks)}
            {@const thumb = thumbUrl(tracks[0]?.thumbnail_url ?? '')}
            <div class="yt-album" class:expanded={isExpanded}>
              <button class="yt-album-header" onclick={() => toggleAlbum(albumName)}>
                {#if thumb}
                  <img src={thumb} alt="" class="yt-album-thumb" loading="lazy" />
                {:else}
                  <div class="yt-album-thumb placeholder"></div>
                {/if}
                <div class="yt-album-meta">
                  <span class="yt-album-title">{albumName}</span>
                  <span class="yt-album-sub">{tracks.length} track{tracks.length !== 1 ? 's' : ''}</span>
                </div>
                <svg class="chevron" class:rotated={isExpanded} viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                  <path d="M7 10l5 5 5-5z"/>
                </svg>
              </button>
              {#if isExpanded}
                <div class="yt-album-tracks">
                  <div class="track-list-header">
                    {#if dlState === 'done'}
                      <span class="dl-done">All queued</span>
                    {:else if dlState === 'loading'}
                      <span class="dl-loading">
                        <svg class="spin" viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>
                        Queueing...
                      </span>
                    {:else}
                      <button class="dl-all-btn" onclick={(e) => { e.stopPropagation(); downloadAlbumTracks(albumName, tracks); }}>
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
                        Queue all
                      </button>
                    {/if}
                  </div>
                  {#each tracks as track, i}
                    <div class="yt-track-row">
                      <span class="track-num">{i + 1}</span>
                      {#if track.thumbnail_url}
                        <img src={thumbUrl(track.thumbnail_url)} alt="" class="track-thumb" loading="lazy" />
                      {:else}
                        <div class="track-thumb placeholder"></div>
                      {/if}
                      <span class="track-title">{track.title}</span>
                      <span class="track-duration">{formatDuration(track.duration)}</span>
                      {#if cachedIds.has(track.youtube_id)}
                        <span class="track-done">✓</span>
                      {:else if downloadingIds.has(track.youtube_id)}
                        <svg class="spin track-action" viewBox="0 0 24 24" width="16" height="16" fill="var(--text-secondary)"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>
                      {:else if errorIds.has(track.youtube_id)}
                        <button class="track-dl-btn track-dl-btn--error" onclick={() => cacheTrack(track)} title="Retry">
                          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
                        </button>
                      {:else}
                        <button class="track-dl-btn" onclick={() => cacheTrack(track)} title="Queue download">
                          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
                        </button>
                      {/if}
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>
        {#if ytAlbumsVisible < albumGroups.size}
          <button class="show-more-btn" onclick={() => ytAlbumsVisible += 10}>
            Show more ({albumGroups.size - ytAlbumsVisible} remaining)
          </button>
        {/if}
      {:else}
        <div class="yt-results">
          {#each youtubeResults as result}
            <div class="yt-row">
              <img src={thumbUrl(result.thumbnail_url)} alt="" class="yt-thumb" loading="lazy" />
              <div class="yt-info">
                <div class="yt-title">{result.title}</div>
                <div class="yt-artist">{result.artist} &middot; {formatDuration(result.duration)}</div>
              </div>
              <div class="yt-actions">
                {#if cachedIds.has(result.youtube_id)}
                  <span class="cached-badge">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="var(--accent)"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                    Cached
                  </span>
                {:else if downloadingIds.has(result.youtube_id)}
                  <span class="downloading-badge">
                    <svg class="spin" viewBox="0 0 24 24" width="16" height="16" fill="var(--text-secondary)"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>
                    Caching...
                  </span>
                {:else if errorIds.has(result.youtube_id)}
                  <button class="cache-btn cache-btn--error" onclick={() => cacheTrack(result)}>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
                    Retry
                  </button>
                {:else}
                  <button class="cache-btn" onclick={() => cacheTrack(result)}>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
                    Cache
                  </button>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </section>
  {/if}

  {#if query.length >= 2 && !searching && !hasLibraryResults && youtubeResults.length === 0}
    <p class="status-text">No results found</p>
  {/if}
</div>

<style>
  .search-page {
    max-width: 900px;
  }

  .search-bar-wrapper {
    position: relative;
    margin-bottom: 24px;
  }

  .recents-dropdown {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    right: 0;
    background: var(--bg-elevated);
    border-radius: 12px;
    overflow: hidden;
    z-index: 100;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4);
  }

  .recent-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 11px 16px;
    color: var(--text-primary);
    font-size: 14px;
    cursor: pointer;
    transition: background 0.1s;
    user-select: none;
  }

  .recent-item:hover {
    background: var(--bg-highlight);
  }

  .recent-item span {
    flex: 1;
  }

  .recent-remove {
    background: none;
    border: none;
    color: var(--text-secondary);
    padding: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    border-radius: 50%;
    opacity: 0.6;
    transition: opacity 0.1s;
  }

  .recent-remove:hover {
    opacity: 1;
  }

  .search-icon {
    position: absolute;
    left: 14px;
    top: 50%;
    transform: translateY(-50%);
  }

  .search-input {
    width: 100%;
    padding: 14px 16px 14px 44px;
    background: var(--bg-elevated);
    border: none;
    border-radius: 24px;
    color: var(--text-primary);
    font-size: 15px;
    outline: none;
  }

  .search-input::placeholder {
    color: var(--text-subdued);
  }

  .browse-artist-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    margin-bottom: 20px;
    border-radius: 8px;
    background: var(--bg-secondary);
    transition: background 0.15s;
  }

  .browse-artist-row:hover {
    background: var(--bg-elevated);
  }

  .browse-artist-avatar {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: var(--bg-elevated);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    font-weight: 700;
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .browse-artist-info {
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .browse-artist-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .browse-artist-sub {
    font-size: 12px;
    color: var(--text-secondary);
  }

  .section {
    margin-bottom: 32px;
  }

  .section-title {
    font-size: 20px;
    font-weight: 700;
    margin-bottom: 16px;
  }

  .subsection-title {
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-secondary);
    margin-bottom: 10px;
    margin-top: 20px;
  }

  .subsection-title:first-child {
    margin-top: 0;
  }

  .status-text {
    color: var(--text-secondary);
    font-size: 14px;
  }

  .artist-chips {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .artist-chip {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 10px;
    border-radius: 6px;
    transition: background 0.15s;
  }

  .artist-chip:hover {
    background: var(--bg-elevated);
  }

  .artist-avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--bg-elevated);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    font-weight: 700;
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .artist-chip-info {
    display: flex;
    flex-direction: column;
  }

  .artist-chip-name {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-primary);
  }

  .artist-chip-count {
    font-size: 12px;
    color: var(--text-secondary);
  }

  .album-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 12px;
  }

  .yt-meta {
    color: var(--text-secondary);
    font-size: 14px;
    margin-bottom: 12px;
  }

  .yt-album-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .yt-album {
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid transparent;
    transition: border-color 0.15s;
  }

  .yt-album.expanded { border-color: var(--bg-elevated); }

  .yt-album-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 10px;
    width: 100%;
    background: none;
    border: none;
    color: var(--text-primary);
    cursor: pointer;
    border-radius: 8px;
    text-align: left;
    transition: background 0.1s;
  }

  .yt-album-header:hover { background: var(--bg-secondary); }

  .yt-album-thumb {
    width: 48px;
    height: 48px;
    border-radius: 4px;
    object-fit: cover;
    flex-shrink: 0;
  }

  .yt-album-thumb.placeholder { background: var(--bg-elevated); }

  .yt-album-meta {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .yt-album-title {
    font-size: 14px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .yt-album-sub { font-size: 12px; color: var(--text-secondary); }

  .chevron {
    flex-shrink: 0;
    color: var(--text-secondary);
    transition: transform 0.2s;
  }

  .chevron.rotated { transform: rotate(180deg); }

  .yt-album-tracks { padding: 0 10px 10px 10px; }

  .track-list-header {
    display: flex;
    align-items: center;
    padding: 6px 0 8px 0;
    border-bottom: 1px solid var(--bg-elevated);
    margin-bottom: 4px;
  }

  .dl-all-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: 1px solid var(--text-secondary);
    color: var(--text-secondary);
    font-size: 12px;
    padding: 4px 10px;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .dl-all-btn:hover { border-color: var(--text-primary); color: var(--text-primary); }

  .show-more-btn {
    margin-top: 12px;
    background: none;
    border: 1px solid var(--text-secondary);
    color: var(--text-secondary);
    font-size: 13px;
    padding: 6px 16px;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .show-more-btn:hover { border-color: var(--text-primary); color: var(--text-primary); }

  .dl-done { font-size: 12px; color: var(--accent); }

  .dl-loading {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text-secondary);
  }

  .yt-track-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 5px 4px;
    border-radius: 6px;
    transition: background 0.1s;
  }

  .yt-track-row:hover { background: var(--bg-secondary); }

  .track-num {
    width: 20px;
    text-align: right;
    font-size: 12px;
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .track-thumb {
    width: 32px;
    height: 32px;
    border-radius: 3px;
    object-fit: cover;
    flex-shrink: 0;
  }

  .track-thumb.placeholder { background: var(--bg-elevated); }

  .track-title {
    flex: 1;
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .track-duration {
    font-size: 12px;
    color: var(--text-secondary);
    flex-shrink: 0;
    width: 38px;
    text-align: right;
  }

  .track-dl-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
    border-radius: 4px;
    flex-shrink: 0;
    transition: color 0.15s;
  }

  .track-dl-btn:hover { color: var(--text-primary); }

  .track-dl-btn--error { color: #e05252; }

  .track-done {
    font-size: 13px;
    color: var(--accent);
    flex-shrink: 0;
    width: 24px;
    text-align: center;
  }

  .track-action { flex-shrink: 0; }

  .yt-results {
    display: flex;
    flex-direction: column;
  }

  .yt-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px;
    border-radius: 6px;
    transition: background 0.15s;
  }

  .yt-row:hover {
    background: var(--bg-elevated);
  }

  .yt-thumb {
    width: 64px;
    height: 36px;
    border-radius: 4px;
    object-fit: cover;
    flex-shrink: 0;
    background: var(--bg-highlight);
  }

  .yt-info {
    flex: 1;
    min-width: 0;
  }

  .yt-title {
    font-size: 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .yt-artist {
    font-size: 12px;
    color: var(--text-secondary);
  }

  .yt-actions {
    flex-shrink: 0;
  }

  .cache-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    background: transparent;
    border: 1px solid var(--text-secondary);
    border-radius: 16px;
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 600;
    transition: all 0.15s;
  }

  .cache-btn:hover {
    border-color: var(--text-primary);
    transform: scale(1.05);
  }

  .cache-btn--error {
    border-color: #e05252;
    color: #e05252;
  }

  .cached-badge {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--accent);
    font-weight: 600;
  }

  .downloading-badge {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--text-secondary);
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .spin {
    animation: spin 1s linear infinite;
  }
</style>
