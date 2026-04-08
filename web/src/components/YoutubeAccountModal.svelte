<script lang="ts">
  import { api, type ChannelPlaylist } from '$lib/api';

  let { onclose, onimported }: {
    onclose: () => void;
    onimported: (result: { totalQueued: number }) => void;
  } = $props();

  type Stage = 'input' | 'fetching' | 'selecting' | 'importing' | 'done';

  let stage = $state<Stage>('input');
  let channelUrl = $state('');
  let fetchError = $state('');
  let playlists = $state<ChannelPlaylist[]>([]);
  let selected = $state<Set<string>>(new Set());
  let importError = $state('');
  let totalQueued = $state(0);
  let failedPlaylists = $state(0);

  async function fetchPlaylists() {
    if (!channelUrl.trim()) return;
    stage = 'fetching';
    fetchError = '';
    try {
      playlists = await api.getChannelPlaylists(channelUrl.trim());
      if (playlists.length === 0) {
        fetchError = 'No playlists found for that channel URL.';
        stage = 'input';
        return;
      }
      selected = new Set(playlists.map((p) => p.id));
      stage = 'selecting';
    } catch (e: any) {
      fetchError = e.message || 'Failed to fetch playlists.';
      stage = 'input';
    }
  }

  function toggleAll() {
    if (selected.size === playlists.length) {
      selected = new Set();
    } else {
      selected = new Set(playlists.map((p) => p.id));
    }
  }

  function togglePlaylist(id: string) {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    selected = next;
  }

  async function importSelected() {
    const toImport = playlists.filter((p) => selected.has(p.id));
    if (toImport.length === 0) return;
    stage = 'importing';
    importError = '';
    try {
      const result = await api.importChannel(
        toImport.map((p) => ({ url: p.url, name: p.title }))
      );
      totalQueued = result.queued;
      failedPlaylists = result.failed_playlists;
      stage = 'done';
      onimported({ totalQueued: result.queued });
    } catch (e: any) {
      importError = e.message || 'Import failed';
      stage = 'selecting';
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={onclose}></div>
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="modal" role="dialog" aria-modal="true" onkeydown={handleKeydown}>
  <div class="modal-header">
    <span class="modal-title">Import from YouTube Channel</span>
    <button class="close-btn" onclick={onclose}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
    </button>
  </div>

  {#if stage === 'input'}
    <p class="hint">Paste a YouTube channel URL (e.g. <code>https://www.youtube.com/@ChannelName/playlists</code>)</p>
    <div class="url-row">
      <input
        class="url-input"
        type="text"
        placeholder="https://www.youtube.com/@ChannelName/playlists"
        bind:value={channelUrl}
        onkeydown={(e) => e.key === 'Enter' && fetchPlaylists()}
        autofocus
      />
      <button class="action-btn" onclick={fetchPlaylists} disabled={!channelUrl.trim()}>
        Fetch Playlists
      </button>
    </div>
    {#if fetchError}
      <p class="error-text">{fetchError}</p>
    {/if}

  {:else if stage === 'fetching'}
    <div class="center-state">
      <svg class="spin" viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>
      <span>Fetching playlists…</span>
    </div>

  {:else if stage === 'selecting' || stage === 'importing'}
    <div class="select-controls">
      <span class="select-count">{selected.size} of {playlists.length} selected</span>
      <button class="text-btn" onclick={toggleAll}>
        {selected.size === playlists.length ? 'Deselect all' : 'Select all'}
      </button>
    </div>
    <div class="playlist-list">
      {#each playlists as playlist}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
          class="playlist-row"
          class:selected={selected.has(playlist.id)}
          onclick={() => togglePlaylist(playlist.id)}
          role="checkbox"
          aria-checked={selected.has(playlist.id)}
        >
          <div class="row-check" class:checked={selected.has(playlist.id)}>
            {#if selected.has(playlist.id)}
              <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
            {/if}
          </div>
          <span class="row-title">{playlist.title}</span>
          {#if playlist.track_count > 0}
            <span class="row-count">{playlist.track_count}</span>
          {/if}
        </div>
      {/each}
    </div>
    {#if importError}
      <p class="error-text">{importError}</p>
    {/if}
    <div class="footer">
      <button class="action-btn" onclick={importSelected} disabled={selected.size === 0 || stage === 'importing'}>
        {#if stage === 'importing'}
          <svg class="spin" viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>
          Queueing…
        {:else}
          Queue {selected.size} playlist{selected.size !== 1 ? 's' : ''}
        {/if}
      </button>
    </div>

  {:else if stage === 'done'}
    <div class="center-state done">
      <svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor" style="color: var(--accent)"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
      <span>Queued <strong>{totalQueued}</strong> track{totalQueued !== 1 ? 's' : ''} for download.</span>
      {#if failedPlaylists > 0}
        <span style="font-size: 12px; color: var(--text-subdued)">{failedPlaylists} playlist{failedPlaylists !== 1 ? 's' : ''} could not be fetched (rate limited or unavailable)</span>
      {/if}
      <button class="action-btn" onclick={onclose}>Done</button>
    </div>
  {/if}
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 400;
  }

  .modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 401;
    background: var(--bg-secondary);
    border-radius: 12px;
    padding: 24px;
    width: min(640px, calc(100vw - 32px));
    max-height: calc(100vh - 64px);
    display: flex;
    flex-direction: column;
    gap: 16px;
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }

  .modal-title {
    font-size: 16px;
    font-weight: 700;
  }

  .close-btn {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4px;
    border-radius: 4px;
    transition: color 0.15s;
  }

  .close-btn:hover {
    color: var(--text-primary);
  }

  .hint {
    font-size: 13px;
    color: var(--text-secondary);
    margin: 0;
  }

  .hint code {
    font-size: 11px;
    background: var(--bg-elevated);
    padding: 2px 5px;
    border-radius: 4px;
    color: var(--text-primary);
  }

  .url-row {
    display: flex;
    gap: 10px;
  }

  .url-input {
    flex: 1;
    padding: 10px 14px;
    background: var(--bg-elevated);
    border: none;
    border-radius: 8px;
    color: var(--text-primary);
    font-size: 14px;
    outline: none;
  }

  .url-input::placeholder {
    color: var(--text-subdued);
    font-size: 12px;
  }

  .action-btn {
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
    white-space: nowrap;
    transition: opacity 0.15s;
  }

  .action-btn:disabled {
    opacity: 0.5;
  }

  .action-btn:not(:disabled):hover {
    opacity: 0.85;
  }

  .error-text {
    font-size: 13px;
    color: var(--danger);
    margin: 0;
    flex-shrink: 0;
  }

  .center-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    padding: 32px 0;
    color: var(--text-secondary);
    font-size: 14px;
  }

  .center-state.done {
    color: var(--text-primary);
  }

  .select-controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }

  .select-count {
    font-size: 13px;
    color: var(--text-secondary);
  }

  .text-btn {
    background: transparent;
    border: none;
    color: var(--accent);
    font-size: 13px;
    font-weight: 600;
    padding: 0;
    transition: opacity 0.15s;
  }

  .text-btn:hover {
    opacity: 0.75;
  }

  .playlist-list {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    border-radius: 8px;
    border: 1px solid var(--bg-highlight);
  }

  .playlist-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 12px;
    cursor: pointer;
    border-bottom: 1px solid var(--bg-highlight);
    transition: background 0.1s;
  }

  .playlist-row:last-child {
    border-bottom: none;
  }

  .playlist-row:hover {
    background: var(--bg-elevated);
  }

  .playlist-row.selected {
    background: var(--bg-elevated);
  }

  .row-check {
    width: 16px;
    height: 16px;
    border-radius: 4px;
    border: 1.5px solid var(--text-subdued);
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #000;
    transition: background 0.1s, border-color 0.1s;
  }

  .row-check.checked {
    background: var(--accent);
    border-color: var(--accent);
  }

  .row-title {
    flex: 1;
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .row-count {
    font-size: 12px;
    color: var(--text-subdued);
    flex-shrink: 0;
  }

  .footer {
    display: flex;
    justify-content: flex-end;
    flex-shrink: 0;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .spin {
    animation: spin 1s linear infinite;
  }
</style>
