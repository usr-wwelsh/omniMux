<script lang="ts">
  import { api, type DiscoverResult } from '$lib/api';
  import { goto } from '$app/navigation';

  let suggestions = $state<DiscoverResult[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  let imgErrors = $state<Set<string>>(new Set());

  function onImgError(key: string) {
    imgErrors = new Set([...imgErrors, key]);
  }

  let previewKey = $state<string | null>(null);
  let previewYtId = $state<string | null>(null);
  let previewLoading = $state<string | null>(null);

  async function load() {
    loading = true;
    error = null;
    try {
      suggestions = await api.getDiscover(200);
    } catch (e: any) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  load();

  function search(track: DiscoverResult) {
    goto(`/search?q=${encodeURIComponent(`${track.artist} ${track.title}`)}`);
  }

  async function startPreview(track: DiscoverResult) {
    const key = `${track.artist}|${track.title}`;
    if (previewKey === key) {
      previewKey = null;
      previewYtId = null;
      return;
    }
    previewLoading = key;
    previewKey = null;
    previewYtId = null;
    try {
      const results = await api.searchYouTube(`${track.artist} ${track.title}`, 1);
      if (results.length > 0) {
        previewKey = key;
        previewYtId = results[0].youtube_id;
      }
    } catch {}
    previewLoading = null;
  }
</script>

<div class="discover-page">
  <div class="page-header">
    <div>
      <h1 class="page-title">Discover</h1>
      <p class="page-sub">Track recommendations · based on your library</p>
    </div>
    <button class="refresh-btn" onclick={load} disabled={loading} title="Refresh suggestions">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" class:spinning={loading}>
        <path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
      </svg>
    </button>
  </div>

  {#if loading}
    <div class="grid">
      {#each Array(12) as _}
        <div class="card card--skeleton">
          <div class="skeleton-artist"></div>
          <div class="skeleton-title"></div>
        </div>
      {/each}
    </div>
  {:else if error}
    <p class="status-text">Failed to load suggestions: {error}</p>
  {:else if suggestions.length === 0}
    <p class="status-text">No suggestions yet — download more music to seed your taste profile.</p>
  {:else}
    <div class="grid">
      {#each suggestions as track}
        {@const key = `${track.artist}|${track.title}`}
        {@const isPreviewing = previewKey === key}
        {@const isLoading = previewLoading === key}
        <div class="card" class:card--active={isPreviewing}>
          <div class="card-row">
            <button class="card-body" onclick={() => search(track)}>
              {#if track.image_url && !imgErrors.has(key)}
                <img class="card-thumb" src={track.image_url} alt={track.artist} loading="lazy" onerror={() => onImgError(key)} />
              {:else}
                <div class="card-icon">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                    <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/>
                  </svg>
                </div>
              {/if}
              <div class="card-info">
                <span class="card-artist">{track.artist}</span>
                <span class="card-title">{track.title}</span>
              </div>
              <svg class="card-arrow" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6-6-6z"/>
              </svg>
            </button>
            <button
              class="preview-btn"
              class:preview-btn--active={isPreviewing}
              onclick={() => startPreview(track)}
              title={isPreviewing ? 'Stop preview' : 'Preview'}
              disabled={isLoading && !isPreviewing}
            >
              {#if isLoading}
                <svg class="spinning" viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                  <path d="M12 4V2A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8z"/>
                </svg>
              {:else if isPreviewing}
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                  <path d="M6 6h12v12H6z"/>
                </svg>
              {:else}
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                  <path d="M8 5v14l11-7z"/>
                </svg>
              {/if}
            </button>
          </div>
          {#if isPreviewing && previewYtId}
            <div class="preview-player">
              <iframe
                src="https://www.youtube.com/embed/{previewYtId}?autoplay=1"
                allow="autoplay; encrypted-media"
                frameborder="0"
                title="Preview"
              ></iframe>
            </div>
          {/if}
        </div>
      {/each}
    </div>
    <p class="hint">Suggestions refresh hourly · click any track to search YouTube · ▶ previews</p>
  {/if}
</div>

<style>
  .discover-page {
    max-width: 900px;
  }

  .page-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: 24px;
  }

  .page-title {
    font-size: 32px;
    font-weight: 700;
    margin: 0 0 4px;
  }

  .page-sub {
    font-size: 14px;
    color: var(--text-secondary);
    margin: 0;
  }

  .refresh-btn {
    background: var(--bg-elevated);
    border: none;
    border-radius: 50%;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: var(--text-secondary);
    transition: color 0.15s, background 0.15s;
    flex-shrink: 0;
  }

  .refresh-btn:hover:not(:disabled) {
    color: var(--text-primary);
    background: var(--bg-secondary);
  }

  .refresh-btn:disabled {
    cursor: default;
  }

  .spinning {
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 10px;
  }

  .card {
    display: flex;
    flex-direction: column;
    background: var(--bg-elevated);
    border-radius: 8px;
    overflow: hidden;
    transition: background 0.12s;
  }

  .card:not(.card--active, .card--skeleton):hover {
    background: var(--bg-secondary);
  }

  .card--skeleton {
    padding: 14px 12px;
    gap: 8px;
    min-height: 72px;
    cursor: default;
  }

  .card-row {
    display: flex;
    align-items: center;
    width: 100%;
  }

  .card-body {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 12px;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    color: var(--text-primary);
    min-width: 0;
  }

  .card-thumb {
    flex-shrink: 0;
    width: 40px;
    height: 40px;
    border-radius: 4px;
    object-fit: cover;
  }

  .card-icon {
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--accent, #1db954) 15%, transparent);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent, #1db954);
  }

  .card-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .card-artist {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .card-title {
    font-size: 14px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .card-arrow {
    flex-shrink: 0;
    color: var(--text-subdued);
  }

  .preview-btn {
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    background: none;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-subdued);
    border-radius: 50%;
    margin-right: 8px;
    transition: color 0.12s, background 0.12s;
  }

  .preview-btn:hover:not(:disabled) {
    color: var(--accent, #1db954);
    background: color-mix(in srgb, var(--accent, #1db954) 12%, transparent);
  }

  .preview-btn--active {
    color: var(--accent, #1db954);
  }

  .preview-btn:disabled {
    cursor: default;
    opacity: 0.5;
  }

  .preview-player {
    width: 100%;
  }

  .preview-player iframe {
    width: 100%;
    height: 158px;
    border: none;
    display: block;
  }

  .skeleton-artist {
    width: 60%;
    height: 10px;
    border-radius: 4px;
    background: var(--bg-secondary);
    animation: pulse 1.4s ease-in-out infinite;
  }

  .skeleton-title {
    width: 80%;
    height: 14px;
    border-radius: 4px;
    background: var(--bg-secondary);
    animation: pulse 1.4s ease-in-out infinite 0.2s;
  }

  @keyframes pulse {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 0.8; }
  }

  .hint {
    font-size: 12px;
    color: var(--text-subdued);
    margin-top: 16px;
    text-align: center;
  }

  .status-text {
    color: var(--text-secondary);
    font-size: 14px;
  }
</style>
