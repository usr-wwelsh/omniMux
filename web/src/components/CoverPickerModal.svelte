<script lang="ts">
  import { api, type CoverSuggestion } from '#lib/api';
  import { loadCoverOverrides, downscaleToJpeg, hasCoverOverride } from '#lib/covers';
  import { errorMessage } from '#lib/errors';

  let { albumId, artist, album, onclose, onchange }: {
    albumId: string;
    artist: string;
    album: string;
    onclose: () => void;
    onchange: () => void;
  } = $props();

  let suggestions = $state<CoverSuggestion[]>([]);
  let loading = $state(true);
  let busy = $state(false);
  let error = $state('');
  let broken = $state(new Set<string>());
  const shown = $derived(suggestions.filter((s) => !broken.has(s.url)));
  let fileInput: HTMLInputElement;

  $effect(() => {
    api.getCoverSuggestions(artist, album)
      .then((s) => (suggestions = s))
      .catch(() => (suggestions = []))
      .finally(() => (loading = false));
  });

  async function apply(action: () => Promise<void>) {
    busy = true;
    error = '';
    try {
      await action();
      await loadCoverOverrides();
      onchange();
      onclose();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      busy = false;
    }
  }

  const pick = (url: string) => apply(() => api.pickCover(albumId, url));
  const reset = () => apply(() => api.resetCover(albumId));

  async function upload(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (file) await apply(async () => api.uploadCover(albumId, await downscaleToJpeg(file)));
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={onclose}></div>
<div class="modal" role="dialog" aria-modal="true" aria-label="Change album art" tabindex="-1" onkeydown={handleKeydown}>
  <div class="modal-header">
    <span class="modal-title">Change album art</span>
    <button class="close-btn" aria-label="Close" onclick={onclose}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
    </button>
  </div>

  <div class="actions">
    <button class="action-btn" disabled={busy} onclick={() => fileInput.click()}>Upload image</button>
    {#if hasCoverOverride(albumId)}
      <button class="action-btn" disabled={busy} onclick={reset}>Reset to automatic</button>
    {/if}
    <input bind:this={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onchange={upload} />
  </div>

  {#if error}<p class="error">{error}</p>{/if}

  <div class="grid">
    {#if loading}
      <p class="hint">Finding suggestions...</p>
    {:else if shown.length === 0}
      <p class="hint">No suggestions found.</p>
    {:else}
      {#each shown as s (s.url)}
        <button class="suggestion" disabled={busy} onclick={() => pick(s.url)} title={s.source}>
          <img src={s.url} alt="" loading="lazy" referrerpolicy="no-referrer" onerror={() => (broken = new Set(broken).add(s.url))} />
          <span>{s.source}</span>
        </button>
      {/each}
    {/if}
  </div>
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
    width: min(520px, calc(100vw - 32px));
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
    padding: 4px;
    border-radius: 4px;
    transition: color 0.15s;
  }

  .close-btn:hover {
    color: var(--text-primary);
  }

  .actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .action-btn {
    padding: 8px 14px;
    border-radius: 999px;
    border: 1px solid var(--bg-highlight);
    background: var(--bg-elevated);
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 600;
  }

  .action-btn:disabled,
  .suggestion:disabled {
    opacity: 0.5;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 12px;
    overflow-y: auto;
  }

  .suggestion {
    display: flex;
    flex-direction: column;
    gap: 4px;
    background: transparent;
    border: none;
    padding: 0;
    color: var(--text-secondary);
    font-size: 11px;
    text-align: left;
  }

  .suggestion img {
    width: 100%;
    aspect-ratio: 1;
    object-fit: cover;
    border-radius: 6px;
    background: var(--bg-elevated);
  }

  .suggestion:hover img {
    outline: 2px solid var(--accent, currentColor);
  }

  .hint,
  .error {
    font-size: 13px;
    color: var(--text-secondary);
    grid-column: 1 / -1;
  }

  .error {
    color: var(--danger);
  }
</style>
