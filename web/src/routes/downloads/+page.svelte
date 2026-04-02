<script lang="ts">
  import { api, type DownloadStatus } from '$lib/api';

  let downloads = $state<DownloadStatus[]>([]);
  let loading = $state(true);
  let pollInterval: ReturnType<typeof setInterval>;

  let playlistUrl = $state('');
  let playlistName = $state('');
  let importing = $state(false);
  let importResult = $state<{ queued: number; playlist_name: string | null } | null>(null);
  let importError = $state('');

  $effect(() => {
    loadDownloads();
    pollInterval = setInterval(loadDownloads, 3000);
    return () => clearInterval(pollInterval);
  });

  async function loadDownloads() {
    try {
      downloads = await api.getDownloads();
    } catch {
      // ignore
    } finally {
      loading = false;
    }
  }

  async function handleImport() {
    if (!playlistUrl.trim()) return;
    importing = true;
    importResult = null;
    importError = '';
    try {
      const result = await api.importPlaylist(playlistUrl.trim(), playlistName.trim() || undefined);
      importResult = result;
      playlistUrl = '';
      playlistName = '';
    } catch (e: any) {
      importError = e.message || 'Import failed';
    } finally {
      importing = false;
    }
  }

  let cancellingIds = $state<Set<number>>(new Set());

  async function cancelDownload(id: number) {
    cancellingIds = new Set([...cancellingIds, id]);
    try {
      await api.cancelDownload(id);
      downloads = downloads.map((dl) =>
        dl.id === id ? { ...dl, status: 'cancelled' } : dl
      );
    } catch {
      // ignore — next poll will reflect real state
    } finally {
      cancellingIds.delete(id);
      cancellingIds = new Set(cancellingIds);
    }
  }

  function statusColor(status: string): string {
    switch (status) {
      case 'completed': return 'var(--accent)';
      case 'failed': return 'var(--danger)';
      case 'cancelled': return 'var(--text-subdued)';
      case 'downloading': return '#3498db';
      case 'analyzing': return '#9b59b6';
      case 'tagging': return '#e67e22';
      case 'scanning': return '#1abc9c';
      default: return 'var(--text-subdued)';
    }
  }

  function statusLabel(status: string): string {
    switch (status) {
      case 'queued': return 'Queued';
      case 'downloading': return 'Downloading';
      case 'analyzing': return 'Analyzing mood';
      case 'tagging': return 'Tagging';
      case 'scanning': return 'Scanning library';
      case 'completed': return 'Completed';
      case 'failed': return 'Failed';
      case 'cancelled': return 'Cancelled';
      default: return status;
    }
  }

  const activeStatuses = new Set(['queued', 'downloading', 'analyzing', 'tagging', 'scanning']);
</script>

<div class="downloads-page">
  <h1 class="page-title">Downloads</h1>

  <section class="import-section">
    <h2 class="section-title">Import YouTube Playlist</h2>
    <div class="import-form">
      <input
        type="text"
        placeholder="YouTube playlist URL"
        bind:value={playlistUrl}
        class="import-input"
      />
      <input
        type="text"
        placeholder="Playlist name in Navidrome (optional)"
        bind:value={playlistName}
        class="import-input"
      />
      <button class="import-btn" onclick={handleImport} disabled={importing || !playlistUrl.trim()}>
        {#if importing}
          <svg class="spin" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>
          Importing...
        {:else}
          Import
        {/if}
      </button>
    </div>
    {#if importResult}
      <p class="import-success">
        Queued {importResult.queued} track{importResult.queued !== 1 ? 's' : ''} for download.
        {#if importResult.playlist_name}
          Tracks will be added to "<a href="/playlists" class="playlist-link">{importResult.playlist_name}</a>" in Navidrome as they complete.
        {/if}
      </p>
    {/if}
    {#if importError}
      <p class="import-error">{importError}</p>
    {/if}
  </section>

  {#if loading}
    <p class="status-text">Loading...</p>
  {:else if downloads.length === 0}
    <p class="status-text">No downloads yet. Search for music on YouTube and hit Cache!</p>
  {:else}
    <div class="download-list">
      {#each downloads as dl}
        <div class="download-row">
          <div class="dl-info">
            <div class="dl-title">{dl.title}</div>
            <div class="dl-artist">{dl.artist}</div>
          </div>

          <div class="dl-status">
            <span class="status-badge" style="color: {statusColor(dl.status)}">
              {statusLabel(dl.status)}
            </span>
            {#if dl.status === 'downloading' || dl.status === 'analyzing' || dl.status === 'tagging' || dl.status === 'scanning'}
              <div class="progress-bar">
                <div class="progress-fill" style="width: {dl.progress}%; background: {statusColor(dl.status)}"></div>
              </div>
            {/if}
          </div>

          {#if activeStatuses.has(dl.status)}
            <button
              class="cancel-btn"
              disabled={cancellingIds.has(dl.id)}
              onclick={() => cancelDownload(dl.id)}
              title="Cancel"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            </button>
          {/if}

          <div class="dl-meta">
            {#if dl.mood}
              <span class="meta-tag">{dl.mood}</span>
            {/if}
            {#if dl.bpm}
              <span class="meta-tag">{Math.round(dl.bpm)} BPM</span>
            {/if}
            {#if dl.key}
              <span class="meta-tag">{dl.key}</span>
            {/if}
          </div>

          {#if dl.error}
            <div class="dl-error">{dl.error}</div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .downloads-page {
    max-width: 900px;
  }

  .page-title {
    font-size: 32px;
    font-weight: 700;
    margin-bottom: 24px;
  }

  .import-section {
    background: var(--bg-secondary);
    border-radius: 10px;
    padding: 20px;
    margin-bottom: 32px;
  }

  .section-title {
    font-size: 16px;
    font-weight: 700;
    margin-bottom: 14px;
  }

  .import-form {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .import-input {
    flex: 1;
    min-width: 200px;
    padding: 10px 14px;
    background: var(--bg-elevated);
    border: none;
    border-radius: 8px;
    color: var(--text-primary);
    font-size: 14px;
    outline: none;
  }

  .import-input::placeholder {
    color: var(--text-subdued);
  }

  .import-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 20px;
    background: var(--accent);
    border: none;
    border-radius: 8px;
    color: #000;
    font-size: 14px;
    font-weight: 600;
    transition: opacity 0.15s;
    white-space: nowrap;
  }

  .import-btn:disabled {
    opacity: 0.5;
  }

  .import-btn:not(:disabled):hover {
    opacity: 0.85;
  }

  .import-success {
    margin-top: 12px;
    font-size: 13px;
    color: var(--accent);
  }

  .playlist-link {
    color: var(--accent);
    font-weight: 700;
    text-decoration: underline;
  }

  .import-error {
    margin-top: 12px;
    font-size: 13px;
    color: var(--danger);
  }

  .status-text {
    color: var(--text-secondary);
    font-size: 14px;
  }

  .download-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .download-row {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 12px 16px;
    border-radius: 6px;
    background: var(--bg-secondary);
    flex-wrap: wrap;
  }

  .dl-info {
    flex: 1;
    min-width: 150px;
  }

  .dl-title {
    font-size: 14px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dl-artist {
    font-size: 12px;
    color: var(--text-secondary);
  }

  .dl-status {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
    min-width: 120px;
  }

  .status-badge {
    font-size: 12px;
    font-weight: 600;
  }

  .progress-bar {
    width: 120px;
    height: 3px;
    background: var(--bg-highlight);
    border-radius: 2px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    border-radius: 2px;
    transition: width 0.3s;
  }

  .dl-meta {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .meta-tag {
    font-size: 11px;
    padding: 2px 8px;
    background: var(--bg-elevated);
    border-radius: 10px;
    color: var(--text-secondary);
  }

  .dl-error {
    width: 100%;
    font-size: 12px;
    color: var(--danger);
    margin-top: 4px;
  }

  .cancel-btn {
    padding: 5px;
    background: transparent;
    border: 1px solid var(--text-subdued);
    border-radius: 50%;
    color: var(--text-subdued);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
    flex-shrink: 0;
  }

  .cancel-btn:not(:disabled):hover {
    border-color: var(--danger);
    color: var(--danger);
  }

  .cancel-btn:disabled {
    opacity: 0.4;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .spin {
    animation: spin 1s linear infinite;
  }
</style>
