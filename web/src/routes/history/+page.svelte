<script lang="ts">
  import { subsonic, type Album } from '$lib/subsonic';
  import AlbumCard from '../../components/AlbumCard.svelte';

  let recent = $state<Album[]>([]);
  let mostPlayed = $state<Album[]>([]);
  let loading = $state(true);

  $effect(() => {
    load();
  });

  async function load() {
    loading = true;
    try {
      const [r, m] = await Promise.all([
        subsonic.getRecentlyPlayed(24),
        subsonic.getMostPlayed(24),
      ]);
      recent = r;
      mostPlayed = m;
    } catch {
      // Library may be empty / no history yet
    } finally {
      loading = false;
    }
  }
</script>

<div class="history">
  <div class="page-header">
    <div>
      <h1 class="page-title">Listening history</h1>
      <p class="page-sub">What you've been playing · from your library</p>
    </div>
    <button class="refresh-btn" onclick={load} disabled={loading} title="Refresh">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" class:spinning={loading}><path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
    </button>
  </div>

  {#if loading}
    <p class="status-text">Loading...</p>
  {:else if recent.length === 0 && mostPlayed.length === 0}
    <div class="empty-state">
      <svg viewBox="0 0 24 24" width="64" height="64" fill="var(--text-subdued)"><path d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6a7 7 0 1 1 2.05 4.95l-1.42 1.42A9 9 0 1 0 13 3zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8z"/></svg>
      <h2>No history yet</h2>
      <p>Play some music and your recently and most-played albums will show up here.</p>
    </div>
  {:else}
    {#if recent.length > 0}
      <section class="section">
        <h2 class="section-title">Recently played</h2>
        <div class="album-grid">
          {#each recent as album}
            <AlbumCard {album} />
          {/each}
        </div>
      </section>
    {/if}

    {#if mostPlayed.length > 0}
      <section class="section">
        <h2 class="section-title">Most played</h2>
        <div class="album-grid">
          {#each mostPlayed as album}
            <AlbumCard {album} />
          {/each}
        </div>
      </section>
    {/if}
  {/if}
</div>

<style>
  .history {
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

  .section {
    margin-bottom: 40px;
  }

  .section-title {
    font-size: 22px;
    font-weight: 700;
    margin-bottom: 16px;
  }

  .album-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 16px;
  }

  .status-text {
    color: var(--text-secondary);
    font-size: 14px;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 80px 0;
    text-align: center;
    color: var(--text-secondary);
  }

  .empty-state h2 {
    color: var(--text-primary);
    font-size: 24px;
  }

  .empty-state p {
    font-size: 14px;
    max-width: 320px;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .spinning {
    animation: spin 0.8s linear infinite;
  }

  @media (max-width: 768px) {
    .page-title {
      font-size: 24px;
    }
    .album-grid {
      grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
      gap: 12px;
    }
  }
</style>
