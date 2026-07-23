<script lang="ts">
  import { subsonic, type Playlist } from '$lib/subsonic';
  import { addToPlaylistTarget } from '$lib/stores/ui';

  let song = $derived($addToPlaylistTarget);

  let playlists = $state<Playlist[]>([]);
  let loading = $state(true);
  let creating = $state(false);
  let newName = $state('');
  let error = $state('');
  let addedTo = $state<Set<string>>(new Set());

  $effect(() => {
    if (song) {
      loadPlaylists(song.id);
    }
  });

  async function loadPlaylists(songId: string) {
    loading = true;
    error = '';
    creating = false;
    newName = '';
    addedTo = new Set();
    try {
      const all = await subsonic.getPlaylists();
      playlists = all.filter((pl) => !pl.name.startsWith('Mood: '));
      const memberships = await Promise.allSettled(
        playlists
          .filter((pl) => pl.songCount > 0)
          .map(async (pl) => {
            const { songs: plSongs } = await subsonic.getPlaylist(pl.id);
            return plSongs.some((s) => s.id === songId) ? pl.id : null;
          }),
      );
      const already = new Set<string>();
      for (const result of memberships) {
        if (result.status === 'fulfilled' && result.value) already.add(result.value);
      }
      addedTo = already;
    } catch {
      error = 'Failed to load playlists';
    } finally {
      loading = false;
    }
  }

  function close() {
    addToPlaylistTarget.set(null);
  }

  async function addTo(playlistId: string) {
    if (!song) return;
    error = '';
    try {
      await subsonic.addSongsToPlaylist(playlistId, [song.id]);
      addedTo = new Set(addedTo).add(playlistId);
    } catch {
      error = 'Failed to add track';
    }
  }

  async function createAndAdd() {
    if (!song || !newName.trim()) return;
    error = '';
    try {
      const pl = await subsonic.createPlaylist(newName.trim(), [song.id]);
      playlists = [pl, ...playlists];
      addedTo = new Set(addedTo).add(pl.id);
      newName = '';
      creating = false;
    } catch {
      error = 'Failed to create playlist';
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }
</script>

{#if song}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-backdrop" onclick={close}></div>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="modal" role="dialog" aria-modal="true" onkeydown={handleKeydown}>
    <div class="modal-header">
      <span class="modal-title">Add to playlist</span>
      <button class="close-btn" onclick={close}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
      </button>
    </div>
    <p class="hint">{song.title} &middot; {song.artist}</p>

    {#if creating}
      <div class="new-row">
        <input
          class="name-input"
          type="text"
          placeholder="Playlist name"
          bind:value={newName}
          onkeydown={(e) => e.key === 'Enter' && createAndAdd()}
          autofocus
        />
        <button class="action-btn" onclick={createAndAdd} disabled={!newName.trim()}>Create</button>
      </div>
    {:else}
      <button class="new-playlist-btn" onclick={() => (creating = true)}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM2 16h8v-2H2v2z"/></svg>
        New playlist
      </button>
    {/if}

    {#if error}
      <p class="error-text">{error}</p>
    {/if}

    {#if loading}
      <p class="hint">Loading playlists…</p>
    {:else if playlists.length === 0}
      <p class="hint">No playlists yet.</p>
    {:else}
      <div class="playlist-list">
        {#each playlists as pl}
          <button class="playlist-row" onclick={() => addTo(pl.id)} disabled={addedTo.has(pl.id)}>
            <span class="row-title">{pl.name}</span>
            {#if addedTo.has(pl.id)}
              <svg viewBox="0 0 24 24" width="14" height="14" fill="var(--accent)"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
            {/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}

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
    width: min(400px, calc(100vw - 32px));
    max-height: calc(100vh - 64px);
    display: flex;
    flex-direction: column;
    gap: 12px;
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
    flex-shrink: 0;
  }

  .error-text {
    font-size: 13px;
    color: var(--danger);
    margin: 0;
    flex-shrink: 0;
  }

  .new-playlist-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    background: var(--bg-elevated);
    border: none;
    border-radius: 8px;
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 600;
    flex-shrink: 0;
    transition: background 0.15s;
  }

  .new-playlist-btn:hover {
    background: var(--bg-highlight, rgba(255,255,255,0.08));
  }

  .new-row {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }

  .name-input {
    flex: 1;
    padding: 10px 12px;
    background: var(--bg-elevated);
    border: none;
    border-radius: 8px;
    color: var(--text-primary);
    font-size: 13px;
    outline: none;
    min-width: 0;
  }

  .action-btn {
    padding: 10px 16px;
    background: var(--accent);
    border: none;
    border-radius: 8px;
    color: #000;
    font-size: 13px;
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
    justify-content: space-between;
    gap: 10px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--bg-highlight);
    text-align: left;
    transition: background 0.1s;
  }

  .playlist-row:last-child {
    border-bottom: none;
  }

  .playlist-row:hover:not(:disabled) {
    background: var(--bg-elevated);
  }

  .playlist-row:disabled {
    color: var(--text-secondary);
  }

  .row-title {
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
