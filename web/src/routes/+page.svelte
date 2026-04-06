<script lang="ts">
  import { subsonic, type Album, type Song, type Playlist } from '$lib/subsonic';
  import AlbumCard from '../components/AlbumCard.svelte';
  import TrackList from '../components/TrackList.svelte';
  import { otherDevices, listenHere } from '$lib/stores/devices';
  import { addToQueue, currentTrack } from '$lib/stores/player';
  import { streamUrl } from '$lib/subsonic';
  import { autoDJActive, toggleAutoDJ } from '$lib/stores/autodj';

  let randomAlbums = $state<Album[]>([]);
  let randomSongs = $state<Song[]>([]);
  let moodPlaylists = $state<Playlist[]>([]);
  let loading = $state(true);

  const activeDevices = $derived($otherDevices.filter((d) => d.track && d.is_playing));

  $effect(() => {
    loadHome();
  });

  async function loadHome() {
    loading = true;
    try {
      const [albums, songs, playlists] = await Promise.all([
        subsonic.getRandomAlbums(12),
        subsonic.getRandomSongs(10),
        subsonic.getPlaylists(),
      ]);
      randomAlbums = albums;
      randomSongs = songs;
      moodPlaylists = playlists.filter((p) => p.name.startsWith('Mood: '));
    } catch {
      // Library may be empty
    } finally {
      loading = false;
    }
  }
</script>

<div class="home">
  <div class="page-header">
    <h1 class="page-title">Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}</h1>
    <div class="header-actions">
      <button
        class="autodj-btn"
        class:autodj-btn--active={$autoDJActive}
        onclick={toggleAutoDJ}
        disabled={!$currentTrack}
        title={$autoDJActive ? 'Stop Auto DJ' : 'Start Auto DJ'}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/><circle cx="18" cy="7" r="3"/></svg>
        {$autoDJActive ? 'Auto DJ: On' : 'Auto DJ'}
      </button>
      <a href="/settings" class="settings-link" aria-label="Settings">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
      </a>
    </div>
  </div>

  {#if activeDevices.length > 0}
    <section class="section">
      <h2 class="section-title">Playing on other devices</h2>
      <div class="device-cards">
        {#each activeDevices as device}
          <div class="device-card">
            <div class="device-card-info">
              <div class="device-card-name">{device.device_name}</div>
              <div class="device-card-track">{device.track!.title}</div>
              <div class="device-card-artist">{device.track!.artist}</div>
            </div>
            <div class="device-card-actions">
              <button class="device-action-btn device-action-btn--primary" onclick={() => listenHere(device)}>
                Listen here
              </button>
              <button class="device-action-btn" onclick={async () => { if (device.track) { const url = await streamUrl(device.track.id); addToQueue({ id: device.track.id, title: device.track.title, artist: device.track.artist, album: device.track.album, artistId: '', albumId: '', duration: device.track.duration, streamUrl: url, coverUrl: device.track.cover_url ?? undefined }); } }}>
                Add to queue
              </button>
            </div>
          </div>
        {/each}
      </div>
    </section>
  {/if}

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

    {#if moodPlaylists.length > 0}
      <section class="section">
        <h2 class="section-title">Moods</h2>
        <div class="mood-chips">
          {#each moodPlaylists as playlist}
            <a href="/playlists/{playlist.id}" class="mood-chip">
              {playlist.name.slice(6)}
            </a>
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

  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 24px;
  }

  .page-title {
    font-size: 32px;
    font-weight: 700;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .autodj-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 14px;
    border-radius: 20px;
    border: 2px solid var(--border);
    background: var(--bg-elevated);
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s, color 0.15s;
    white-space: nowrap;
  }

  .autodj-btn:hover:not(:disabled) {
    border-color: var(--accent);
  }

  .autodj-btn--active {
    border-color: var(--accent);
    background: var(--accent);
    color: #000;
  }

  .autodj-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .settings-link {
    display: none;
    color: var(--text-subdued);
    padding: 4px;
    transition: color 0.15s;
  }

  .settings-link:hover {
    color: var(--text-primary);
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

  .mood-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .mood-chip {
    padding: 8px 20px;
    border-radius: 20px;
    background: var(--bg-elevated);
    color: var(--text-primary);
    font-size: 14px;
    font-weight: 600;
    transition: background 0.15s;
    white-space: nowrap;
  }

  .mood-chip:hover {
    background: var(--accent);
    color: #000;
  }

  .device-cards {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .device-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 16px;
    background: var(--bg-secondary);
    border-radius: 10px;
  }

  .device-card-name {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-subdued);
    margin-bottom: 3px;
  }

  .device-card-track {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .device-card-artist {
    font-size: 12px;
    color: var(--text-secondary);
    margin-top: 2px;
  }

  .device-card-actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }

  .device-action-btn {
    padding: 7px 14px;
    border-radius: 16px;
    border: 1px solid var(--text-secondary);
    background: transparent;
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    transition: all 0.15s;
  }

  .device-action-btn:hover {
    border-color: var(--text-primary);
  }

  .device-action-btn--primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #000;
  }

  .device-action-btn--primary:hover {
    opacity: 0.85;
  }

  @media (max-width: 600px) {
    .device-card {
      flex-direction: column;
      align-items: flex-start;
    }
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
    .settings-link {
      display: flex;
    }
    .album-grid {
      grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
      gap: 12px;
    }
  }
</style>
