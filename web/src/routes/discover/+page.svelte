<script lang="ts">
  import { api, type DiscoverResult } from '$lib/api';
  import { goto } from '$app/navigation';
  import { isGuest } from '$lib/auth';

  $effect(() => {
    if ($isGuest) goto('/');
  });

  let suggestions = $state<DiscoverResult[]>([]);
  let images = $state<Map<string, string>>(new Map());
  let loading = $state(true);
  let error = $state<string | null>(null);

  const pendingKeys = new Set<string>();
  let queue: Array<{artist: string; title: string}> = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  function tkey(artist: string, title: string) {
    return `${artist}|${title}`;
  }

  function artistColor(artist: string): string {
    let hash = 0;
    for (let i = 0; i < artist.length; i++) {
      hash = artist.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h1 = Math.abs(hash) % 360;
    const h2 = (h1 + 40) % 360;
    return `linear-gradient(135deg, hsl(${h1}, 50%, 20%), hsl(${h2}, 40%, 12%))`;
  }

  async function flushQueue() {
    flushTimer = null;
    if (!queue.length) return;
    const batch = queue.splice(0, 30);
    try {
      const results = await api.getDiscoverImages(batch);
      const next = new Map(images);
      for (const r of results) {
        if (r.image_url) next.set(tkey(r.artist, r.title), r.image_url);
      }
      images = next;
    } catch {}
    if (queue.length) flushTimer = setTimeout(flushQueue, 100);
  }

  function enqueue(artist: string, title: string) {
    const k = tkey(artist, title);
    if (pendingKeys.has(k)) return;
    pendingKeys.add(k);
    queue.push({artist, title});
    if (!flushTimer) flushTimer = setTimeout(flushQueue, 400);
  }

  const io = typeof IntersectionObserver !== 'undefined'
    ? new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) {
              const el = e.target as HTMLElement;
              enqueue(el.dataset.artist!, el.dataset.title!);
              io.unobserve(el);
            }
          }
        },
        { rootMargin: '400px' }
      )
    : null;

  function observe(node: HTMLElement, track: DiscoverResult) {
    node.dataset.artist = track.artist;
    node.dataset.title = track.title;
    io?.observe(node);
    return { destroy: () => io?.unobserve(node) };
  }

  let featured = $derived([...suggestions].sort((a, b) => b.score - a.score).slice(0, 5));
  let featuredSet = $derived(new Set(featured.map(t => tkey(t.artist, t.title))));
  let grid = $derived(suggestions.filter(t => !featuredSet.has(tkey(t.artist, t.title))));

  let previewKey = $state<string | null>(null);
  let previewYtId = $state<string | null>(null);
  let previewLoading = $state<string | null>(null);

  async function load(fresh = false) {
    loading = true;
    error = null;
    try {
      suggestions = await api.getDiscover(100, fresh);
      images = new Map();
      pendingKeys.clear();
      queue.length = 0;
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
    const k = tkey(track.artist, track.title);
    if (previewKey === k) {
      previewKey = null;
      previewYtId = null;
      return;
    }
    previewLoading = k;
    previewKey = null;
    previewYtId = null;
    try {
      const results = await api.searchYouTube(`${track.artist} ${track.title}`, 1);
      if (results.length > 0) {
        previewKey = k;
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
    <button class="refresh-btn" onclick={() => load(true)} disabled={loading} title="Refresh suggestions">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" class:spinning={loading}>
        <path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
      </svg>
    </button>
  </div>

  {#if loading}
    <div class="featured-row featured-row--skeleton">
      {#each Array(5) as _}
        <div class="featured-card featured-card--skeleton">
          <div class="skeleton-art"></div>
          <div class="skeleton-badge"></div>
          <div class="skeleton-artist"></div>
          <div class="skeleton-title"></div>
        </div>
      {/each}
    </div>
    <div class="grid">
      {#each Array(10) as _}
        <div class="card card--skeleton">
          <div class="skeleton-art"></div>
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
    {#if featured.length > 0}
      <section class="featured-section">
        <p class="section-label">Featured for you</p>
        <div class="featured-row">
          {#each featured as track}
            {@const k = tkey(track.artist, track.title)}
            {@const isPreviewing = previewKey === k}
            {@const isLoading = previewLoading === k}
            {@const imgUrl = images.get(k)}
            <div class="featured-card" class:featured-card--active={isPreviewing} use:observe={track}>
              <button class="featured-art-btn" onclick={() => search(track)}>
                {#if imgUrl}
                  <img class="card-art" src={imgUrl} alt={track.artist} loading="lazy" />
                {:else}
                  <div class="card-art-placeholder" style="background: {artistColor(track.artist)}">
                    <svg viewBox="0 0 24 24" width="40" height="40" fill="white" opacity="0.15">
                      <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/>
                    </svg>
                  </div>
                {/if}
                <div class="art-overlay">
                  <svg viewBox="0 0 24 24" width="36" height="36" fill="white">
                    <path d="M10.5 1.5a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 16a7 7 0 1 1 0-14 7 7 0 0 1 0 14zm8.7-3.2l4.25 4.25a1 1 0 1 1-1.41 1.41l-4.25-4.25a1 1 0 1 1 1.41-1.41z"/>
                  </svg>
                </div>
              </button>
              <div class="featured-body">
                <div class="featured-badges">
                  {#if track.seed_artist && track.seed_artist.toLowerCase() !== track.artist.toLowerCase()}
                    <span class="badge-seed">Because you like {track.seed_artist}</span>
                  {/if}
                  {#if track.score > 0}
                    <span class="badge-score">{Math.round(track.score * 100)}% match</span>
                  {/if}
                </div>
                <div class="card-info">
                  <span class="card-artist">{track.artist}</span>
                  <span class="card-title">{track.title}</span>
                </div>
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
      </section>
    {/if}

    <div class="grid">
      {#each grid as track}
        {@const k = tkey(track.artist, track.title)}
        {@const isPreviewing = previewKey === k}
        {@const isLoading = previewLoading === k}
        {@const imgUrl = images.get(k)}
        <div class="card" class:card--active={isPreviewing} use:observe={track}>
          <button class="card-art-btn" onclick={() => search(track)}>
            {#if imgUrl}
              <img class="card-art" src={imgUrl} alt={track.artist} loading="lazy" />
            {:else}
              <div class="card-art-placeholder" style="background: {artistColor(track.artist)}">
                <svg viewBox="0 0 24 24" width="32" height="32" fill="white" opacity="0.15">
                  <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/>
                </svg>
              </div>
            {/if}
            <div class="art-overlay">
              <svg viewBox="0 0 24 24" width="28" height="28" fill="white">
                <path d="M10.5 1.5a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 16a7 7 0 1 1 0-14 7 7 0 0 1 0 14zm8.7-3.2l4.25 4.25a1 1 0 1 1-1.41 1.41l-4.25-4.25a1 1 0 1 1 1.41-1.41z"/>
              </svg>
            </div>
          </button>
          <div class="card-body">
            <div class="card-content">
              <div class="card-badges">
                {#if track.seed_artist && track.seed_artist.toLowerCase() !== track.artist.toLowerCase()}
                  <span class="badge-seed-small">via {track.seed_artist}</span>
                {/if}
                {#if track.score > 0}
                  <span class="badge-score-small">{Math.round(track.score * 100)}%</span>
                {/if}
              </div>
              <div class="card-info">
                <span class="card-artist">{track.artist}</span>
                <span class="card-title">{track.title}</span>
              </div>
            </div>
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
    <p class="hint">Suggestions refresh hourly · click art to search · ▶ for preview</p>
  {/if}
</div>

<style>
  .discover-page {
    max-width: 1200px;
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

  /* ── Featured row ── */

  .featured-section {
    margin-bottom: 36px;
  }

  .section-label {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-subdued);
    margin: 0 0 14px;
  }

  .featured-row {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 14px;
  }

  .featured-card {
    display: flex;
    flex-direction: column;
    background: var(--bg-elevated);
    border-radius: 10px;
    overflow: hidden;
    transition: background 0.12s, transform 0.15s, box-shadow 0.15s;
  }

  .featured-card:not(.featured-card--active):hover {
    background: var(--bg-secondary);
    transform: translateY(-3px);
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35);
  }

  .featured-art-btn {
    position: relative;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    width: 100%;
    aspect-ratio: 1;
  }

  .featured-body {
    padding: 10px 12px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .featured-badges {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    min-height: 20px;
  }

  .badge-seed {
    font-size: 10px;
    font-weight: 500;
    color: var(--accent, #1db954);
    background: color-mix(in srgb, var(--accent, #1db954) 14%, transparent);
    border-radius: 10px;
    padding: 2px 8px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 160px;
  }

  .badge-score {
    font-size: 10px;
    font-weight: 600;
    color: var(--text-subdued);
    white-space: nowrap;
  }

  .badge-seed-small {
    font-size: 9px;
    font-weight: 500;
    color: var(--accent, #1db954);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }

  .badge-score-small {
    font-size: 9px;
    font-weight: 600;
    color: var(--text-subdued);
    white-space: nowrap;
  }

  .card-badges {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
    min-height: 14px;
  }

  /* ── Hover art overlay (shared by featured + grid) ── */

  .art-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.38);
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.15s;
  }

  .featured-art-btn:hover .art-overlay,
  .card-art-btn:hover .art-overlay {
    opacity: 1;
  }

  /* ── Grid ── */

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
    gap: 12px;
  }

  .card {
    display: flex;
    flex-direction: column;
    background: var(--bg-elevated);
    border-radius: 8px;
    overflow: hidden;
    transition: background 0.12s, transform 0.15s, box-shadow 0.15s;
  }

  .card:not(.card--active, .card--skeleton):hover {
    background: var(--bg-secondary);
    transform: translateY(-2px);
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3);
  }

  .card--skeleton {
    gap: 8px;
    cursor: default;
  }

  .card-art-btn {
    position: relative;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    width: 100%;
    aspect-ratio: 1;
  }

  .card-art {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .card-art-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .card-body {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
    padding: 12px;
  }

  .card-content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
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
    font-size: 13px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .preview-btn {
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    background: none;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-subdued);
    border-radius: 50%;
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
    height: 140px;
    border: none;
    display: block;
  }

  /* ── Skeletons ── */

  .featured-card--skeleton {
    gap: 8px;
    cursor: default;
  }

  .skeleton-art {
    width: 100%;
    aspect-ratio: 1;
    background: var(--bg-secondary);
    animation: pulse 1.4s ease-in-out infinite;
  }

  .skeleton-badge {
    width: 60%;
    height: 16px;
    border-radius: 8px;
    background: var(--bg-secondary);
    animation: pulse 1.4s ease-in-out infinite 0.05s;
    margin: 0 12px;
  }

  .skeleton-artist {
    width: 70%;
    height: 10px;
    border-radius: 4px;
    background: var(--bg-secondary);
    animation: pulse 1.4s ease-in-out infinite 0.1s;
    margin: 0 12px;
  }

  .skeleton-title {
    width: 90%;
    height: 12px;
    border-radius: 4px;
    background: var(--bg-secondary);
    animation: pulse 1.4s ease-in-out infinite 0.2s;
    margin: 0 12px 12px;
  }

  @keyframes pulse {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 0.8; }
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .spinning {
    animation: spin 0.8s linear infinite;
  }

  .hint {
    font-size: 12px;
    color: var(--text-subdued);
    margin-top: 20px;
    text-align: center;
  }

  .status-text {
    color: var(--text-secondary);
    font-size: 14px;
  }

  @media (max-width: 900px) {
    .featured-row {
      grid-template-columns: repeat(3, 1fr);
    }
  }

  @media (max-width: 600px) {
    .featured-row {
      grid-template-columns: repeat(2, 1fr);
    }
  }
</style>
