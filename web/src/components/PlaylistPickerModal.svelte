<script lang="ts">
  import { goto } from '$app/navigation';
  import { playlistPickerTarget } from '$lib/stores/ui';

  let playlists = $derived($playlistPickerTarget);

  function close() {
    playlistPickerTarget.set(null);
  }

  function open(playlistId: string) {
    close();
    goto(`/playlists/${playlistId}`);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }
</script>

{#if playlists}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-backdrop" onclick={close}></div>
  <div class="modal" role="dialog" aria-modal="true" aria-label="In playlists" tabindex="-1" onkeydown={handleKeydown}>
    <div class="modal-header">
      <span class="modal-title">In playlists</span>
      <button class="close-btn" aria-label="Close" onclick={close}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
      </button>
    </div>
    <div class="playlist-list">
      {#each playlists as pl (pl.id)}
        <button class="playlist-row" onclick={() => open(pl.id)}>
          <span class="row-title">{pl.name}</span>
        </button>
      {/each}
    </div>
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
    padding: 10px 12px;
    border-bottom: 1px solid var(--bg-highlight);
    text-align: left;
    transition: background 0.1s;
  }

  .playlist-row:last-child {
    border-bottom: none;
  }

  .playlist-row:hover {
    background: var(--bg-elevated);
  }

  .row-title {
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
