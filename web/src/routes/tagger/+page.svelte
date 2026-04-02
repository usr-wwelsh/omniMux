<script lang="ts">
  import { api, type TaggerTrack } from '$lib/api';

  let tracks = $state<TaggerTrack[]>([]);
  let loading = $state(true);
  let filter = $state('');
  let selected = $state<Set<string>>(new Set());
  let saving = $state(false);
  let saveResult = $state<string | null>(null);

  // Bulk edit fields — empty string = don't change
  let bulkTitle = $state('');
  let bulkArtist = $state('');
  let bulkAlbum = $state('');
  let bulkGenre = $state('');
  let bulkYear = $state('');

  $effect(() => {
    api.getTaggerTracks()
      .then((t) => (tracks = t))
      .catch(() => {})
      .finally(() => (loading = false));
  });

  let filtered = $derived(
    filter.trim()
      ? tracks.filter((t) => {
          const q = filter.toLowerCase();
          return (
            t.title.toLowerCase().includes(q) ||
            t.artist.toLowerCase().includes(q) ||
            t.album.toLowerCase().includes(q) ||
            t.genre.toLowerCase().includes(q)
          );
        })
      : tracks
  );

  let selectedTracks = $derived(tracks.filter((t) => selected.has(t.file_path)));
  let allFilteredSelected = $derived(
    filtered.length > 0 && filtered.every((t) => selected.has(t.file_path))
  );

  function toggleAll() {
    if (allFilteredSelected) {
      const next = new Set(selected);
      filtered.forEach((t) => next.delete(t.file_path));
      selected = next;
    } else {
      const next = new Set(selected);
      filtered.forEach((t) => next.add(t.file_path));
      selected = next;
    }
  }

  function toggleTrack(fp: string) {
    const next = new Set(selected);
    if (next.has(fp)) next.delete(fp);
    else next.add(fp);
    selected = next;
  }

  function clearBulk() {
    bulkTitle = '';
    bulkArtist = '';
    bulkAlbum = '';
    bulkGenre = '';
    bulkYear = '';
  }

  async function applyTags() {
    const tags: Record<string, string> = {};
    if (bulkTitle) tags.title = bulkTitle;
    if (bulkArtist) tags.artist = bulkArtist;
    if (bulkAlbum) tags.album = bulkAlbum;
    if (bulkGenre) tags.genre = bulkGenre;
    if (bulkYear) tags.year = bulkYear;

    if (Object.keys(tags).length === 0) {
      saveResult = 'No fields filled in.';
      return;
    }

    saving = true;
    saveResult = null;
    try {
      const result = await api.writeTags([...selected], tags);
      saveResult = `Updated ${result.updated} track${result.updated !== 1 ? 's' : ''}${result.errors.length ? ` · ${result.errors.length} error(s)` : ''}.`;
      // Update local track data
      for (const fp of selected) {
        const idx = tracks.findIndex((t) => t.file_path === fp);
        if (idx !== -1) {
          tracks[idx] = {
            ...tracks[idx],
            ...(tags.title ? { title: tags.title } : {}),
            ...(tags.artist ? { artist: tags.artist } : {}),
            ...(tags.album ? { album: tags.album } : {}),
            ...(tags.genre ? { genre: tags.genre } : {}),
            ...(tags.year ? { year: tags.year } : {}),
          };
        }
      }
      clearBulk();
      selected = new Set();
    } catch (e: any) {
      saveResult = `Error: ${e.message}`;
    } finally {
      saving = false;
    }
  }

  function formatDuration(s: number): string {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  // Placeholder for bulk title field when exactly 1 track is selected
  let titlePlaceholder = $derived(
    selectedTracks.length === 1 ? selectedTracks[0].title : ''
  );
</script>

<div class="tagger-page">
  <div class="page-header">
    <h1 class="page-title">Tagger</h1>
    <input
      class="filter-input"
      type="search"
      placeholder="Filter tracks…"
      bind:value={filter}
    />
  </div>

  {#if selected.size > 0}
    <div class="bulk-panel">
      <span class="bulk-count">{selected.size} selected</span>
      <div class="bulk-fields">
        {#if selectedTracks.length === 1}
          <input class="bulk-field" placeholder="Title" bind:value={bulkTitle} />
        {/if}
        <input class="bulk-field" placeholder="Artist" bind:value={bulkArtist} />
        <input class="bulk-field" placeholder="Album" bind:value={bulkAlbum} />
        <input class="bulk-field" placeholder="Genre" bind:value={bulkGenre} />
        <input class="bulk-field bulk-field--narrow" placeholder="Year" bind:value={bulkYear} />
      </div>
      <div class="bulk-actions">
        {#if saveResult}
          <span class="save-result">{saveResult}</span>
        {/if}
        <button class="btn btn--ghost" onclick={clearBulk}>Clear</button>
        <button class="btn btn--primary" onclick={applyTags} disabled={saving}>
          {saving ? 'Saving…' : 'Apply'}
        </button>
      </div>
    </div>
  {/if}

  {#if loading}
    <p class="status-text">Loading tracks…</p>
  {:else if tracks.length === 0}
    <p class="status-text">No tracks found in the music directory.</p>
  {:else}
    <div class="table-wrap">
      <table class="track-table">
        <thead>
          <tr>
            <th class="col-check">
              <input
                type="checkbox"
                checked={allFilteredSelected}
                onchange={toggleAll}
              />
            </th>
            <th class="col-title">Title</th>
            <th class="col-artist">Artist</th>
            <th class="col-album">Album</th>
            <th class="col-genre">Genre</th>
            <th class="col-year">Year</th>
            <th class="col-dur">Duration</th>
          </tr>
        </thead>
        <tbody>
          {#each filtered as track (track.file_path)}
            <tr
              class:selected={selected.has(track.file_path)}
              onclick={() => toggleTrack(track.file_path)}
            >
              <td class="col-check" onclick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={selected.has(track.file_path)}
                  onchange={() => toggleTrack(track.file_path)}
                />
              </td>
              <td class="col-title" title={track.title}>{track.title || '—'}</td>
              <td class="col-artist" title={track.artist}>{track.artist || '—'}</td>
              <td class="col-album" title={track.album}>{track.album || '—'}</td>
              <td class="col-genre">{track.genre || '—'}</td>
              <td class="col-year">{track.year || '—'}</td>
              <td class="col-dur">{track.duration ? formatDuration(track.duration) : '—'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="track-count">{filtered.length} track{filtered.length !== 1 ? 's' : ''}{filter ? ` matching "${filter}"` : ''}</p>
  {/if}
</div>

<style>
  .tagger-page {
    max-width: 1400px;
  }

  .page-header {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 16px;
  }

  .page-title {
    font-size: 32px;
    font-weight: 700;
    margin: 0;
    flex-shrink: 0;
  }

  .filter-input {
    flex: 1;
    max-width: 360px;
    background: var(--bg-elevated);
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 8px 12px;
    font-size: 14px;
    color: var(--text-primary);
    outline: none;
  }

  .filter-input:focus {
    border-color: var(--accent, #1db954);
  }

  /* Bulk edit panel */
  .bulk-panel {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    background: var(--bg-elevated);
    border-radius: 8px;
    padding: 10px 14px;
    margin-bottom: 16px;
  }

  .bulk-count {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .bulk-fields {
    display: flex;
    gap: 8px;
    flex: 1;
    flex-wrap: wrap;
  }

  .bulk-field {
    background: var(--bg-secondary);
    border: 1px solid transparent;
    border-radius: 4px;
    padding: 6px 10px;
    font-size: 13px;
    color: var(--text-primary);
    outline: none;
    min-width: 120px;
    flex: 1;
  }

  .bulk-field--narrow {
    max-width: 80px;
    flex: 0 0 80px;
  }

  .bulk-field:focus {
    border-color: var(--accent, #1db954);
  }

  .bulk-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .save-result {
    font-size: 12px;
    color: var(--text-secondary);
  }

  .btn {
    padding: 6px 16px;
    border-radius: 20px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    border: none;
    white-space: nowrap;
  }

  .btn--ghost {
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--border, rgba(255,255,255,0.1));
  }

  .btn--ghost:hover {
    color: var(--text-primary);
  }

  .btn--primary {
    background: var(--accent, #1db954);
    color: #000;
  }

  .btn--primary:disabled {
    opacity: 0.5;
    cursor: default;
  }

  /* Table */
  .table-wrap {
    overflow-x: auto;
    border-radius: 8px;
    background: var(--bg-secondary);
  }

  .track-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  .track-table thead th {
    padding: 10px 12px;
    text-align: left;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-subdued);
    border-bottom: 1px solid var(--border, rgba(255,255,255,0.06));
    position: sticky;
    top: 0;
    background: var(--bg-secondary);
    z-index: 1;
  }

  .track-table tbody tr {
    border-bottom: 1px solid var(--border, rgba(255,255,255,0.04));
    cursor: pointer;
    transition: background 0.1s;
  }

  .track-table tbody tr:hover {
    background: var(--bg-elevated);
  }

  .track-table tbody tr.selected {
    background: color-mix(in srgb, var(--accent, #1db954) 12%, transparent);
  }

  .track-table tbody tr.selected:hover {
    background: color-mix(in srgb, var(--accent, #1db954) 18%, transparent);
  }

  .track-table td {
    padding: 8px 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .col-check { width: 36px; }
  .col-title { max-width: 220px; font-weight: 500; }
  .col-artist { max-width: 160px; color: var(--text-secondary); }
  .col-album { max-width: 160px; color: var(--text-secondary); }
  .col-genre { max-width: 120px; color: var(--text-subdued); }
  .col-year { width: 60px; color: var(--text-subdued); }
  .col-dur { width: 70px; color: var(--text-subdued); text-align: right; }

  .track-count {
    font-size: 12px;
    color: var(--text-subdued);
    margin-top: 10px;
  }

  .status-text {
    color: var(--text-secondary);
    font-size: 14px;
  }

  input[type="checkbox"] {
    accent-color: var(--accent, #1db954);
    width: 15px;
    height: 15px;
    cursor: pointer;
  }
</style>
