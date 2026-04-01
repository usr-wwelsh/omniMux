<script lang="ts">
  import { subsonic, coverArtUrl, type Artist } from '$lib/subsonic';

  let artists = $state<(Artist & { coverUrl?: string })[]>([]);
  let loading = $state(true);

  $effect(() => {
    loadArtists();
  });

  async function loadArtists() {
    loading = true;
    try {
      const raw = await subsonic.getArtists();
      artists = await Promise.all(
        raw.map(async (a) => ({
          ...a,
          coverUrl: a.coverArt ? await coverArtUrl(a.coverArt, 300) : undefined,
        }))
      );
    } catch {
      artists = [];
    } finally {
      loading = false;
    }
  }
</script>

<div class="library">
  <h1 class="page-title">Library</h1>

  {#if loading}
    <p class="loading-text">Loading...</p>
  {:else if artists.length === 0}
    <p class="empty-text">No artists in your library yet. Cache some music from YouTube!</p>
  {:else}
    <div class="artist-grid">
      {#each artists as artist}
        <a href="/library/artist/{artist.id}" class="artist-card">
          {#if artist.coverUrl}
            <img src={artist.coverUrl} alt={artist.name} class="artist-img" />
          {:else}
            <div class="artist-img placeholder">
              <svg viewBox="0 0 24 24" width="40" height="40" fill="var(--text-subdued)"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
            </div>
          {/if}
          <div class="artist-name">{artist.name}</div>
          <div class="artist-albums">{artist.albumCount} album{artist.albumCount !== 1 ? 's' : ''}</div>
        </a>
      {/each}
    </div>
  {/if}
</div>

<style>
  .library {
    max-width: 1200px;
  }

  .page-title {
    font-size: 32px;
    font-weight: 700;
    margin-bottom: 24px;
  }

  .loading-text, .empty-text {
    color: var(--text-secondary);
    font-size: 14px;
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
</style>
