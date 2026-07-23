<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { subsonic, type Playlist, type Song } from '$lib/subsonic';
  import { isGuest } from '$lib/auth';
  import TrackList from '../../../components/TrackList.svelte';

  let playlist = $state<Playlist | null>(null);
  let songs = $state<Song[]>([]);
  let loading = $state(true);
  let editingName = $state(false);
  let nameInput = $state('');
  let confirmDelete = $state(false);
  let deleting = $state(false);
  let actionError = $state('');

  $effect(() => {
    loadPlaylist(page.params.id!);
  });

  async function loadPlaylist(id: string) {
    loading = true;
    try {
      const data = await subsonic.getPlaylist(id);
      playlist = data.playlist;
      songs = data.songs;
    } catch {
      playlist = null;
      songs = [];
    } finally {
      loading = false;
    }
  }

  function startEdit() {
    if (!playlist) return;
    nameInput = playlist.name;
    editingName = true;
  }

  async function saveName() {
    if (!playlist) return;
    const trimmed = nameInput.trim();
    editingName = false;
    if (!trimmed || trimmed === playlist.name) return;
    try {
      await subsonic.renamePlaylist(playlist.id, trimmed);
      playlist = { ...playlist, name: trimmed };
    } catch (e: any) {
      actionError = e.message || 'Failed to rename playlist';
    }
  }

  async function deletePlaylist() {
    if (!playlist) return;
    deleting = true;
    actionError = '';
    try {
      await subsonic.deletePlaylist(playlist.id);
      goto('/playlists');
    } catch (e: any) {
      actionError = e.message || 'Failed to delete playlist';
      deleting = false;
    }
  }

  async function handleRemoveSong(index: number) {
    if (!playlist) return;
    actionError = '';
    try {
      await subsonic.removeSongsFromPlaylist(playlist.id, [index]);
      songs = songs.filter((_, i) => i !== index);
      playlist = { ...playlist, songCount: Math.max(0, playlist.songCount - 1) };
    } catch (e: any) {
      actionError = e.message || 'Failed to remove track';
    }
  }

  function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }
</script>

<div class="playlist-page">
  {#if loading}
    <p class="loading-text">Loading...</p>
  {:else if playlist}
    <div class="playlist-header">
      <div class="playlist-icon">
        <svg viewBox="0 0 24 24" width="64" height="64" fill="var(--text-subdued)"><path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/></svg>
      </div>
      <div class="playlist-info">
        {#if editingName}
          <input
            class="name-input"
            type="text"
            bind:value={nameInput}
            onblur={saveName}
            onkeydown={(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') editingName = false; }}
            autofocus
          />
        {:else}
          <h1 class="page-title">
            {playlist.name}
            {#if !$isGuest}
              <button class="icon-btn" onclick={startEdit} title="Rename playlist">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
              </button>
            {/if}
          </h1>
        {/if}
        <p class="playlist-meta">
          {playlist.songCount} track{playlist.songCount !== 1 ? 's' : ''}
          {#if playlist.duration > 0} &middot; {formatDuration(playlist.duration)}{/if}
        </p>
        {#if !$isGuest}
          <div class="playlist-actions">
            {#if confirmDelete}
              <span class="delete-confirm-label">Delete this playlist?</span>
              <button class="btn btn--danger" onclick={deletePlaylist} disabled={deleting}>Yes, delete</button>
              <button class="btn btn--ghost" onclick={() => (confirmDelete = false)}>Cancel</button>
            {:else}
              <button class="btn btn--danger-ghost" onclick={() => (confirmDelete = true)}>Delete playlist</button>
            {/if}
          </div>
        {/if}
        {#if actionError}
          <p class="error-text">{actionError}</p>
        {/if}
      </div>
    </div>

    {#if songs.length > 0}
      <TrackList {songs} showAlbum onRemove={handleRemoveSong} />
    {:else}
      <p class="loading-text">This playlist is empty. Tracks will appear here once downloads complete.</p>
    {/if}
  {:else}
    <p class="loading-text">Playlist not found.</p>
  {/if}
</div>

<style>
  .playlist-page {
    max-width: 900px;
  }

  .playlist-header {
    display: flex;
    align-items: center;
    gap: 24px;
    margin-bottom: 32px;
  }

  .playlist-icon {
    width: 120px;
    height: 120px;
    border-radius: 8px;
    background: var(--bg-elevated);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .playlist-info {
    flex: 1;
    min-width: 0;
  }

  .page-title {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 32px;
    font-weight: 700;
    margin-bottom: 8px;
  }

  .icon-btn {
    background: transparent;
    border: none;
    color: var(--text-subdued);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4px;
    border-radius: 4px;
    transition: color 0.15s;
  }

  .icon-btn:hover {
    color: var(--text-primary);
  }

  .name-input {
    font-size: 32px;
    font-weight: 700;
    margin-bottom: 8px;
    background: var(--bg-elevated);
    border: none;
    border-radius: 8px;
    color: var(--text-primary);
    padding: 4px 10px;
    outline: none;
    width: 100%;
  }

  .playlist-meta {
    color: var(--text-secondary);
    font-size: 14px;
  }

  .playlist-actions {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 12px;
  }

  .delete-confirm-label {
    font-size: 13px;
    color: var(--text-secondary);
  }

  .btn {
    padding: 7px 14px;
    border-radius: 20px;
    font-size: 13px;
    font-weight: 600;
    border: 1px solid transparent;
    transition: opacity 0.15s, background 0.15s;
  }

  .btn:disabled {
    opacity: 0.5;
  }

  .btn--danger {
    background: var(--danger);
    color: #fff;
  }

  .btn--danger:not(:disabled):hover {
    opacity: 0.85;
  }

  .btn--danger-ghost {
    background: transparent;
    border-color: var(--danger);
    color: var(--danger);
  }

  .btn--danger-ghost:hover {
    background: color-mix(in srgb, var(--danger) 12%, transparent);
  }

  .btn--ghost {
    background: var(--bg-elevated);
    color: var(--text-primary);
  }

  .btn--ghost:hover {
    background: var(--bg-highlight, rgba(255,255,255,0.08));
  }

  .error-text {
    font-size: 13px;
    color: var(--danger);
    margin-top: 8px;
  }

  .loading-text {
    color: var(--text-secondary);
    font-size: 14px;
  }
</style>
