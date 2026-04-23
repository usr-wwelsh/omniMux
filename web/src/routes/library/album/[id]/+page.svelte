<script lang="ts">
  import { subsonic, coverArtUrl, type Album, type Song } from '$lib/subsonic';
  import { api, type YouTubeResult } from '$lib/api';
  import TrackList from '../../../../components/TrackList.svelte';

  // --- merge modal state ---
  let mergeOpen = $state(false);
  let mergeAlbums = $state<Album[]>([]);
  let mergeSelected = $state<Set<string>>(new Set());
  let mergeFilter = $state('');
  let mergeLoading = $state(false);
  let merging = $state(false);
  let mergeResult = $state<string | null>(null);

  function norm(s: string) {
    return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function wordSim(a: string, b: string): number {
    const aw = new Set(a.split(' ').filter(Boolean));
    const bw = b.split(' ').filter(Boolean);
    if (!aw.size && !bw.length) return 1;
    if (!aw.size || !bw.length) return 0;
    const hits = bw.filter(w => aw.has(w)).length;
    const union = new Set([...aw, ...bw]).size;
    return hits / union;
  }

  function albumScore(current: Album, candidate: Album): number {
    const cn = norm(current.name), ca = norm(current.artist);
    const dn = norm(candidate.name), da = norm(candidate.artist);
    let nameSim = cn === dn ? 1 : (cn.includes(dn) || dn.includes(cn)) ? 0.75 : wordSim(cn, dn);
    let artistSim = ca === da ? 1 : (ca.includes(da) || da.includes(ca)) ? 0.7 : wordSim(ca, da);
    return nameSim * 0.6 + artistSim * 0.4;
  }

  async function openMergeModal() {
    if (!album) return;
    mergeOpen = true;
    mergeSelected = new Set();
    mergeFilter = '';
    mergeResult = null;
    mergeLoading = true;
    try {
      const all = await subsonic.getAllAlbums();
      mergeAlbums = all
        .filter(a => a.id !== album!.id)
        .map(a => ({ ...a, _score: albumScore(album!, a) } as Album & { _score: number }))
        .sort((a, b) => (b as any)._score - (a as any)._score);
    } catch {
      mergeAlbums = [];
    } finally {
      mergeLoading = false;
    }
  }

  let mergeFiltered = $derived(
    mergeFilter.trim()
      ? mergeAlbums.filter(a =>
          norm(a.name).includes(norm(mergeFilter)) || norm(a.artist).includes(norm(mergeFilter))
        )
      : mergeAlbums
  );

  function toggleMerge(id: string) {
    const s = new Set(mergeSelected);
    s.has(id) ? s.delete(id) : s.add(id);
    mergeSelected = s;
  }

  async function confirmMerge() {
    if (!album || mergeSelected.size === 0) return;
    merging = true;
    mergeResult = null;
    try {
      const sources = mergeAlbums
        .filter(a => mergeSelected.has(a.id))
        .map(a => ({ album: a.name, artist: a.artist }));
      const r = await api.mergeAlbums(album.name, album.artist, sources);
      mergeResult = r.errors.length
        ? `Merged ${r.merged} tracks. Errors: ${r.errors.join(', ')}`
        : `Merged ${r.merged} tracks into "${album.name}".`;
      mergeSelected = new Set();
    } catch (e: any) {
      mergeResult = `Error: ${e.message}`;
    } finally {
      merging = false;
    }
  }

  let { data } = $props();

  let album = $state<Album | null>(null);
  let songs = $state<Song[]>([]);
  let coverUrl = $state('');
  let loading = $state(true);

  let missingTracks = $state<YouTubeResult[]>([]);
  let cachedIds = $state<Set<string>>(new Set());
  let downloadingIds = $state<Map<string, number>>(new Map());
  let checking = $state(false);
  let checkDone = $state(false);

  $effect(() => {
    loadAlbum(data.albumId);
  });

  async function loadAlbum(id: string) {
    loading = true;
    missingTracks = [];
    checkDone = false;
    try {
      const data = await subsonic.getAlbum(id);
      album = data.album;
      songs = data.songs;
      if (data.album.coverArt) {
        coverUrl = await coverArtUrl(data.album.coverArt, 500);
      }
      // Fire YouTube check in the background — don't block render
      checkMissingTracks(data.album, data.songs);
    } catch {
      album = null;
      songs = [];
    } finally {
      loading = false;
    }
  }

  async function checkMissingTracks(al: Album, localSongs: Song[]) {
    checking = true;
    try {
      const [ytTracks, cached] = await Promise.all([
        api.getYouTubeAlbumTracks(al.artist, al.name),
        api.getCachedIds(),
      ]);
      cachedIds = new Set(cached);
      const localTitles = localSongs.map((s) => normalizeTitle(s.title));
      missingTracks = ytTracks.filter(
        (yt) => !localTitles.some((local) => titlesMatch(local, normalizeTitle(yt.title)))
      );
    } catch {
      // non-fatal
    } finally {
      checking = false;
      checkDone = true;
    }
  }

  function normalizeTitle(title: string): string {
    return title
      .toLowerCase()
      .replace(/\s*[\(\[].*?[\)\]]/g, '')
      .replace(/\s*-\s*(remaster(ed)?|official|audio|video|lyrics?|hd|hq|mono|stereo).*$/i, '')
      .trim();
  }

  function titlesMatch(a: string, b: string): boolean {
    if (a === b) return true;
    // one contains the other (handles "Artist - Title" vs "Title")
    return a.includes(b) || b.includes(a);
  }

  async function cacheTrack(result: YouTubeResult) {
    try {
      const resp = await api.startDownload(result.url, result.youtube_id, result.title, result.artist, album?.name);
      if (resp.already_cached) {
        cachedIds = new Set([...cachedIds, result.youtube_id]);
      } else {
        downloadingIds = new Map([...downloadingIds, [result.youtube_id, resp.download_id]]);
        pollDownload(result.youtube_id, resp.download_id);
      }
    } catch {
      // ignore
    }
  }

  async function cacheAll() {
    for (const track of missingTracks) {
      if (!cachedIds.has(track.youtube_id) && !downloadingIds.has(track.youtube_id)) {
        cacheTrack(track);
      }
    }
  }

  async function pollDownload(ytId: string, dlId: number) {
    const interval = setInterval(async () => {
      try {
        const status = await api.getDownloadStatus(dlId);
        if (status.status === 'completed') {
          clearInterval(interval);
          downloadingIds.delete(ytId);
          downloadingIds = new Map(downloadingIds);
          cachedIds = new Set([...cachedIds, ytId]);
        } else if (status.status === 'failed') {
          clearInterval(interval);
          downloadingIds.delete(ytId);
          downloadingIds = new Map(downloadingIds);
        }
      } catch {
        clearInterval(interval);
      }
    }, 2000);
  }

  function formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
</script>

<div class="album-page">
  {#if loading}
    <p class="loading-text">Loading...</p>
  {:else if album}
    <div class="album-header">
      {#if coverUrl}
        <img src={coverUrl} alt={album.name} class="album-cover" />
      {:else}
        <div class="album-cover placeholder">
          <svg viewBox="0 0 24 24" width="64" height="64" fill="var(--text-subdued)"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
        </div>
      {/if}
      <div class="album-info">
        <span class="album-type">Album</span>
        <h1 class="album-name">{album.name}</h1>
        <div class="album-meta">
          <a href="/library/artist/{album.artistId}" class="album-artist-link">{album.artist}</a>
          {#if album.year} &middot; {album.year}{/if}
          &middot; {album.songCount} song{album.songCount !== 1 ? 's' : ''}
        </div>
        <button class="merge-btn" onclick={openMergeModal} title="Merge duplicate albums into this one">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M17 20.41 18.41 19 15 15.59 13.59 17 17 20.41zM7.5 8H11v5.59L5.59 19 7 20.41l6-6V8h3.5L12 3.5 7.5 8z"/></svg>
          Merge duplicates
        </button>
      </div>
    </div>

    <TrackList {songs} />

    <div class="check-row">
      {#if checking}
        <span class="check-status">
          <svg class="spin" viewBox="0 0 24 24" width="14" height="14" fill="var(--text-secondary)"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>
          Checking YouTube...
        </span>
      {:else if checkDone && missingTracks.length === 0}
        <span class="check-status check-status--done">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="var(--accent)"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
          Album is complete
        </span>
        <button class="recheck-btn" onclick={() => album && checkMissingTracks(album, songs)}>
          Re-check
        </button>
      {:else if !checking && !checkDone}
        <button class="recheck-btn" onclick={() => album && checkMissingTracks(album, songs)}>
          Check for missing tracks
        </button>
      {:else}
        <button class="recheck-btn" onclick={() => album && checkMissingTracks(album, songs)}>
          Re-check
        </button>
      {/if}
    </div>

    {#if missingTracks.length > 0}
      <div class="missing-banner">
        <div class="missing-header">
          <div class="missing-title-row">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="var(--accent)"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
            <span>Found {missingTracks.length} missing track{missingTracks.length !== 1 ? 's' : ''} on YouTube</span>
          </div>
          <button class="cache-all-btn" onclick={cacheAll}>Add all</button>
        </div>
        <div class="missing-tracks">
          {#each missingTracks as track}
            <div class="missing-row">
              <div class="missing-info">
                <span class="missing-track-title">{track.title}</span>
                <span class="missing-track-meta">{formatDuration(track.duration)}</span>
              </div>
              {#if cachedIds.has(track.youtube_id)}
                <span class="cached-badge">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="var(--accent)"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                  Added
                </span>
              {:else if downloadingIds.has(track.youtube_id)}
                <span class="downloading-badge">
                  <svg class="spin" viewBox="0 0 24 24" width="13" height="13" fill="var(--text-secondary)"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>
                  Adding...
                </span>
              {:else}
                <button class="add-btn" onclick={() => cacheTrack(track)}>Add</button>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/if}
  {/if}
</div>

{#if mergeOpen}
  <div class="modal-backdrop" onclick={() => (mergeOpen = false)} role="presentation">
    <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
      <div class="modal-header">
        <div>
          <h2 class="modal-title">Merge into "{album?.name}"</h2>
          <p class="modal-sub">Selected albums' tracks will be retagged to match this album.</p>
        </div>
        <button class="modal-close" onclick={() => (mergeOpen = false)}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
      </div>

      <input
        class="modal-search"
        type="text"
        placeholder="Filter albums…"
        bind:value={mergeFilter}
      />

      <div class="modal-list">
        {#if mergeLoading}
          <p class="modal-status">Loading albums…</p>
        {:else if mergeFiltered.length === 0}
          <p class="modal-status">No albums found.</p>
        {:else}
          {#each mergeFiltered as al}
            <label class="modal-row" class:modal-row--selected={mergeSelected.has(al.id)}>
              <input type="checkbox" checked={mergeSelected.has(al.id)} onchange={() => toggleMerge(al.id)} />
              <div class="modal-row-info">
                <span class="modal-row-name">{al.name}</span>
                <span class="modal-row-artist">{al.artist} &middot; {al.songCount} track{al.songCount !== 1 ? 's' : ''}</span>
              </div>
            </label>
          {/each}
        {/if}
      </div>

      {#if mergeResult}
        <p class="modal-result">{mergeResult}</p>
      {/if}

      <div class="modal-footer">
        <button class="modal-cancel" onclick={() => (mergeOpen = false)}>Cancel</button>
        <button
          class="modal-confirm"
          onclick={confirmMerge}
          disabled={mergeSelected.size === 0 || merging}
        >
          {merging ? 'Merging…' : `Merge ${mergeSelected.size > 0 ? mergeSelected.size + ' album' + (mergeSelected.size !== 1 ? 's' : '') : ''}`}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .album-page {
    max-width: 900px;
  }

  .album-header {
    display: flex;
    gap: 24px;
    align-items: flex-end;
    margin-bottom: 32px;
  }

  .album-cover {
    width: 200px;
    height: 200px;
    border-radius: 8px;
    object-fit: cover;
    flex-shrink: 0;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  }

  .album-cover.placeholder {
    background: var(--bg-elevated);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .album-info {
    min-width: 0;
  }

  .album-type {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .album-name {
    font-size: 36px;
    font-weight: 800;
    margin: 8px 0;
    line-height: 1.1;
  }

  .album-meta {
    font-size: 14px;
    color: var(--text-secondary);
  }

  .album-artist-link {
    color: var(--text-primary);
    font-weight: 600;
  }

  .album-artist-link:hover {
    text-decoration: underline;
  }

  .check-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 0 4px;
  }

  .check-status {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--text-secondary);
  }

  .check-status--done {
    color: var(--accent);
  }

  .recheck-btn {
    padding: 5px 14px;
    background: transparent;
    border: 1px solid var(--text-secondary);
    border-radius: 12px;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 600;
    transition: all 0.15s;
  }

  .recheck-btn:hover {
    border-color: var(--text-primary);
    color: var(--text-primary);
  }

  .missing-banner {
    margin-top: 32px;
    border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
    border-radius: 10px;
    overflow: hidden;
  }

  .missing-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }

  .missing-title-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .cache-all-btn {
    padding: 6px 16px;
    background: var(--accent);
    border: none;
    border-radius: 14px;
    color: #000;
    font-size: 12px;
    font-weight: 700;
    transition: opacity 0.15s;
  }

  .cache-all-btn:hover {
    opacity: 0.85;
  }

  .missing-tracks {
    display: flex;
    flex-direction: column;
  }

  .missing-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 16px;
    border-top: 1px solid var(--border);
  }

  .missing-info {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    flex: 1;
  }

  .missing-track-title {
    font-size: 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .missing-track-meta {
    font-size: 12px;
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .add-btn {
    padding: 5px 14px;
    background: transparent;
    border: 1px solid var(--text-secondary);
    border-radius: 12px;
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 600;
    flex-shrink: 0;
    transition: all 0.15s;
  }

  .add-btn:hover {
    border-color: var(--text-primary);
  }

  .cached-badge {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--accent);
    font-weight: 600;
    flex-shrink: 0;
  }

  .downloading-badge {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--text-secondary);
    flex-shrink: 0;
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

  .merge-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin-top: 10px;
    padding: 5px 12px;
    background: transparent;
    border: 1px solid var(--text-subdued);
    border-radius: 12px;
    color: var(--text-subdued);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
  }

  .merge-btn:hover {
    color: var(--text-primary);
    border-color: var(--text-secondary);
  }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }

  .modal {
    background: var(--bg-elevated);
    border-radius: 12px;
    width: 100%;
    max-width: 520px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: 20px 20px 12px;
    gap: 12px;
  }

  .modal-title {
    font-size: 16px;
    font-weight: 700;
    margin: 0 0 4px;
  }

  .modal-sub {
    font-size: 12px;
    color: var(--text-secondary);
    margin: 0;
  }

  .modal-close {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    flex-shrink: 0;
    padding: 2px;
  }

  .modal-close:hover {
    color: var(--text-primary);
  }

  .modal-search {
    margin: 0 16px 8px;
    padding: 8px 12px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text-primary);
    font-size: 13px;
    outline: none;
  }

  .modal-search:focus {
    border-color: var(--text-secondary);
  }

  .modal-list {
    flex: 1;
    overflow-y: auto;
    padding: 0 8px;
  }

  .modal-status {
    font-size: 13px;
    color: var(--text-secondary);
    padding: 16px;
    text-align: center;
  }

  .modal-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.1s;
  }

  .modal-row:hover {
    background: var(--bg-secondary);
  }

  .modal-row--selected {
    background: color-mix(in srgb, var(--accent, #1db954) 10%, transparent);
  }

  .modal-row input[type='checkbox'] {
    flex-shrink: 0;
    accent-color: var(--accent, #1db954);
    width: 15px;
    height: 15px;
  }

  .modal-row-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .modal-row-name {
    font-size: 13px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .modal-row-artist {
    font-size: 11px;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .modal-result {
    font-size: 12px;
    color: var(--accent, #1db954);
    padding: 8px 20px 0;
    margin: 0;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 16px 20px;
  }

  .modal-cancel {
    padding: 7px 18px;
    background: transparent;
    border: 1px solid var(--text-secondary);
    border-radius: 14px;
    color: var(--text-secondary);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }

  .modal-cancel:hover {
    border-color: var(--text-primary);
    color: var(--text-primary);
  }

  .modal-confirm {
    padding: 7px 18px;
    background: var(--accent, #1db954);
    border: none;
    border-radius: 14px;
    color: #000;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: opacity 0.15s;
  }

  .modal-confirm:hover:not(:disabled) {
    opacity: 0.85;
  }

  .modal-confirm:disabled {
    opacity: 0.4;
    cursor: default;
  }

  @media (max-width: 768px) {
    .album-header {
      flex-direction: column;
      align-items: center;
      text-align: center;
    }
    .album-cover {
      width: 180px;
      height: 180px;
    }
    .album-name {
      font-size: 24px;
    }
  }
</style>
