<script lang="ts">
  import { subsonic, type Album, type Song } from '$lib/subsonic';
  import AlbumCard from '../components/AlbumCard.svelte';
  import TrackList from '../components/TrackList.svelte';

  let randomAlbums = $state<Album[]>([]);
  let randomSongs = $state<Song[]>([]);
  let loading = $state(true);

  $effect(() => {
    loadHome();
  });

  async function loadHome() {
    loading = true;
    try {
      const [albums, songs] = await Promise.all([
        subsonic.getRandomAlbums(12),
        subsonic.getRandomSongs(10),
      ]);
      randomAlbums = albums;
      randomSongs = songs;
    } catch {
      // Library may be empty
    } finally {
      loading = false;
    }
  }
</script>

<div class="home">
  <h1 class="page-title">Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}</h1>

  {#if loading}
    <p class="loading-text">Loading...</p>
  {:else}
    {#if randomAlbums.length > 0}
      <section class="section">
        <h2 class="section-title">Albums</h2>
        <div class="album-grid">
          {#each randomAlbums as album}
            <AlbumCard {album} />
          {/each}
        </div>
      </section>
    {/if}

    {#if randomSongs.length > 0}
      <section class="section">
        <h2 class="section-title">Discover</h2>
        <TrackList songs={randomSongs} showAlbum />
      </section>
    {/if}

    {#if randomAlbums.length === 0 && randomSongs.length === 0}
      <div class="empty-state">
        <svg viewBox="0 0 24 24" width="64" height="64" fill="var(--text-subdued)"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
        <h2>Your library is empty</h2>
        <p>Search for music on YouTube and cache it to build your library.</p>
        <a href="/search" class="cta-btn">Start searching</a>
      </div>
    {/if}
  {/if}
</div>

<style>
  .home {
    max-width: 1200px;
  }

  .page-title {
    font-size: 32px;
    font-weight: 700;
    margin-bottom: 24px;
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

  .loading-text {
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
    max-width: 300px;
  }

  .cta-btn {
    display: inline-block;
    margin-top: 8px;
    padding: 12px 32px;
    background: var(--accent);
    color: #000;
    font-weight: 700;
    border-radius: 24px;
    transition: background 0.15s;
  }

  .cta-btn:hover {
    background: var(--accent-hover);
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
