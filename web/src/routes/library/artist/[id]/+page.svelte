<script lang="ts">
  import { page } from '$app/state';
  import { subsonic, type Artist, type Album } from '$lib/subsonic';
  import { api, type YouTubeResult } from '$lib/api';
  import { isGuest } from '$lib/auth';
  import AlbumCard from '../../../../components/AlbumCard.svelte';

  let artist = $state<Artist | null>(null);
  let albums = $state<Album[]>([]);
  let ytTracks = $state<YouTubeResult[]>([]);
  let ytLoading = $state(false);
  let ytError = $state(false);
  let loading = $state(true);

  let expandedAlbums = $state<Set<string>>(new Set());
  let downloadingIds = $state<Set<string>>(new Set());
  let downloadedIds = $state<Set<string>>(new Set());
  let downloadingAlbums = $state<Set<string>>(new Set());

  $effect(() => { loadArtist(page.params.id); });

  // Group tracks by album, preserving order. Tracks with no album go to "Singles & Other".
  const albumGroups = $derived.by(() => {
    const groups = new Map<string, YouTubeResult[]>();
    for (const t of ytTracks) {
      const key = t.album || 'Singles & Other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(t);
    }
    return groups;
  });

  async function loadArtist(id: string) {
    loading = true;
    ytLoading = false;
    ytError = false;
    ytTracks = [];
    expandedAlbums = new Set();
    try {
      const data = await subsonic.getArtist(id);
      artist = data.artist;
      albums = data.albums;
      if (!$isGuest) {
        ytLoading = true;
        api.getArtistTopicTracks(data.artist.name, 100)
          .then((r) => { ytTracks = r; ytLoading = false; })
          .catch(() => { ytError = true; ytLoading = false; });
      }
    } catch {
      artist = null;
      albums = [];
    } finally {
      loading = false;
    }
  }

  function toggleAlbum(albumName: string) {
    const next = new Set(expandedAlbums);
    if (next.has(albumName)) next.delete(albumName);
    else next.add(albumName);
    expandedAlbums = next;
  }

  async function downloadTrack(track: YouTubeResult) {
    if (downloadingIds.has(track.youtube_id) || downloadedIds.has(track.youtube_id)) return;
    downloadingIds = new Set([...downloadingIds, track.youtube_id]);
    try {
      await api.startDownload(track.url, track.youtube_id, track.title, track.artist, track.album || undefined);
      downloadingIds.delete(track.youtube_id);
      downloadingIds = new Set(downloadingIds);
      downloadedIds = new Set([...downloadedIds, track.youtube_id]);
    } catch {
      downloadingIds.delete(track.youtube_id);
      downloadingIds = new Set(downloadingIds);
    }
  }

  async function downloadAlbumTracks(albumName: string, tracks: YouTubeResult[]) {
    if (downloadingAlbums.has(albumName)) return;
    downloadingAlbums = new Set([...downloadingAlbums, albumName]);
    await Promise.allSettled(tracks.map((t) => downloadTrack(t)));
    downloadingAlbums.delete(albumName);
    downloadingAlbums = new Set(downloadingAlbums);
  }

  function albumDlState(albumName: string, tracks: YouTubeResult[]): 'idle' | 'loading' | 'done' {
    if (downloadingAlbums.has(albumName)) return 'loading';
    if (tracks.every((t) => downloadedIds.has(t.youtube_id))) return 'done';
    return 'idle';
  }

  function formatDuration(seconds: number): string {
    if (!seconds) return '';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
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
        <p class="muted">{artist.albumCount} album{artist.albumCount !== 1 ? 's' : ''}</p>
        <div class="album-grid">
          {#each albums as album}
            <AlbumCard {album} />
          {/each}
        </div>
      </section>
    {/if}

    {#if !$isGuest}
    <section class="section">
      <h2 class="section-title">On YouTube</h2>
      {#if ytLoading}
        <p class="loading-text">Loading tracks...</p>
      {:else if ytError || ytTracks.length === 0}
        <p class="loading-text">No tracks found on YouTube.</p>
      {:else}
        <p class="muted">{ytTracks.length} tracks · {albumGroups.size} album{albumGroups.size !== 1 ? 's' : ''}</p>
        <div class="yt-album-list">
          {#each albumGroups as [albumName, tracks]}
            {@const isExpanded = expandedAlbums.has(albumName)}
            {@const dlState = albumDlState(albumName, tracks)}
            {@const thumb = tracks[0]?.thumbnail_url}
            <div class="yt-album" class:expanded={isExpanded}>
              <button class="yt-album-header" onclick={() => toggleAlbum(albumName)}>
                {#if thumb}
                  <img src={thumb} alt="" class="yt-album-thumb" />
                {:else}
                  <div class="yt-album-thumb placeholder"></div>
                {/if}
                <div class="yt-album-meta">
                  <span class="yt-album-title">{albumName}</span>
                  <span class="muted small">{tracks.length} track{tracks.length !== 1 ? 's' : ''}</span>
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
                        <img src={track.thumbnail_url} alt="" class="track-thumb" />
                      {:else}
                        <div class="track-thumb placeholder"></div>
                      {/if}
                      <span class="track-title">{track.title}</span>
                      <span class="track-duration">{formatDuration(track.duration)}</span>
                      {#if downloadedIds.has(track.youtube_id)}
                        <span class="track-done" title="Queued">✓</span>
                      {:else if downloadingIds.has(track.youtube_id)}
                        <svg class="spin track-action" viewBox="0 0 24 24" width="16" height="16" fill="var(--text-secondary)"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>
                      {:else}
                        <button class="track-dl-btn" onclick={() => downloadTrack(track)} title="Queue download">
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
      {/if}
    </section>
    {/if}
  {/if}
</div>

<style>
  .artist-page { max-width: 1200px; }

  .page-title { font-size: 32px; font-weight: 700; margin-bottom: 24px; }

  .section { margin-bottom: 36px; }

  .section-title { font-size: 20px; font-weight: 700; margin-bottom: 12px; }

  .muted { color: var(--text-secondary); font-size: 14px; margin-bottom: 16px; }

  .small { font-size: 12px; }

  .album-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 16px;
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

  .track-done {
    font-size: 13px;
    color: var(--accent);
    flex-shrink: 0;
    width: 24px;
    text-align: center;
  }

  .track-action { flex-shrink: 0; }

  .loading-text { color: var(--text-secondary); font-size: 14px; }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .spin { animation: spin 1s linear infinite; }
</style>
