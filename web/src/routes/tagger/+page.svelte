<script lang="ts">
  import { get } from 'svelte/store';
  import { goto } from '$app/navigation';
  import { isGuest } from '$lib/auth';
  import { onMount } from 'svelte';
  import { api, type TaggerTrack } from '$lib/api';

  let retagging = $state(false);
  let undoing = $state(false);
  let undoPaths = $state<string[]>([]);

  onMount(() => {
    if (get(isGuest)) goto('/');
    const saved = localStorage.getItem('tagger_undo_paths');
    if (saved) {
      try { undoPaths = JSON.parse(saved); } catch {}
    }
  });

  function setUndoPaths(paths: string[]) {
    undoPaths = paths;
    if (paths.length > 0) {
      localStorage.setItem('tagger_undo_paths', JSON.stringify(paths));
    } else {
      localStorage.removeItem('tagger_undo_paths');
    }
  }

  let tracks = $state<TaggerTrack[]>([]);
  let loading = $state(true);
  let filter = $state('');
  let selected = $state<Set<string>>(new Set());
  let saving = $state(false);
  let saveResult = $state<string | null>(null);
  let confirmDelete = $state(false);

  // Bulk edit fields — empty string = don't change
  let bulkTitle = $state('');
  let bulkArtist = $state('');
  let bulkAlbumArtist = $state('');
  let bulkAlbum = $state('');
  let bulkGenre = $state('');
  let bulkYear = $state('');
  let bulkIgnore = $state<'' | 'true' | 'false'>(''); // '' = don't change

  type SortKey = 'title' | 'artist' | 'album' | 'genre' | 'year' | 'duration' | 'added_date' | 'ignore_in_autodj';
  let sortKey = $state<SortKey>('title');
  let sortAsc = $state(true);

  function setSort(key: SortKey) {
    if (sortKey === key) {
      sortAsc = !sortAsc;
    } else {
      sortKey = key;
      sortAsc = true;
    }
  }

  $effect(() => {
    api.getTaggerTracks()
      .then((t) => (tracks = t))
      .catch(() => {})
      .finally(() => (loading = false));
  });

  function sortVal(t: TaggerTrack): string | number | boolean {
    if (sortKey === 'duration') return t.duration;
    if (sortKey === 'added_date') return t.added_date;
    if (sortKey === 'ignore_in_autodj') return t.ignore_in_autodj ? 1 : 0;
    return (t[sortKey] || '').toLowerCase();
  }

  function formatDate(ts: number): string {
    if (!ts) return '—';
    return new Date(ts * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  let filtered = $derived((() => {
    const base = filter.trim()
      ? tracks.filter((t) => {
          const q = filter.toLowerCase();
          return (
            t.title.toLowerCase().includes(q) ||
            t.artist.toLowerCase().includes(q) ||
            t.album.toLowerCase().includes(q) ||
            t.genre.toLowerCase().includes(q)
          );
        })
      : tracks;
    return base.slice().sort((a, b) => {
      const av = sortVal(a);
      const bv = sortVal(b);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortAsc ? cmp : -cmp;
    });
  })());

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
    bulkAlbumArtist = '';
    bulkAlbum = '';
    bulkGenre = '';
    bulkYear = '';
    bulkIgnore = '';
  }

  async function deleteTracks() {
    saving = true;
    saveResult = null;
    confirmDelete = false;
    const paths = [...selected];
    try {
      const result = await api.deleteTracks(paths);
      saveResult = `Deleted ${result.deleted} track${result.deleted !== 1 ? 's' : ''}${result.errors.length ? ` · ${result.errors.length} error(s)` : ''}.`;
      tracks = tracks.filter((t) => !paths.includes(t.file_path));
      selected = new Set();
    } catch (e: any) {
      saveResult = `Error: ${e.message}`;
    } finally {
      saving = false;
    }
  }

  async function retagSelected() {
    retagging = true;
    saveResult = null;
    setUndoPaths([]);
    const paths = [...selected];
    try {
      const result = await api.retagTracks(paths);
      saveResult = `Retagged ${result.retagged} · skipped ${result.skipped}${result.errors.length ? ` · ${result.errors.length} error(s)` : ''}.`;
      if (result.retagged > 0) setUndoPaths(paths);
      tracks = await api.getTaggerTracks();
    } catch (e: any) {
      saveResult = `Error: ${e.message}`;
    } finally {
      retagging = false;
    }
  }

  async function undoLastOp() {
    undoing = true;
    saveResult = null;
    try {
      const result = await api.undoTags(undoPaths);
      saveResult = `Restored ${result.restored} track${result.restored !== 1 ? 's' : ''}${result.skipped ? ` · ${result.skipped} had no snapshot` : ''}${result.errors.length ? ` · ${result.errors.length} error(s)` : ''}.`;
      setUndoPaths([]);
      tracks = await api.getTaggerTracks();
    } catch (e: any) {
      saveResult = `Error: ${e.message}`;
    } finally {
      undoing = false;
    }
  }

  async function applyTags() {
    const tags: Record<string, string> = {};
    if (bulkTitle) tags.title = bulkTitle;
    if (bulkArtist) tags.artist = bulkArtist;
    if (bulkAlbumArtist) tags.albumartist = bulkAlbumArtist;
    if (bulkAlbum) tags.album = bulkAlbum;
    if (bulkGenre) tags.genre = bulkGenre;
    if (bulkYear) tags.year = bulkYear;

    if (Object.keys(tags).length === 0 && bulkIgnore === '') {
      saveResult = 'No fields filled in.';
      return;
    }

    saving = true;
    saveResult = null;
    setUndoPaths([]);
    try {
      const paths = [...selected];
      const results: string[] = [];

      if (Object.keys(tags).length > 0) {
        const result = await api.writeTags(paths, tags);
        results.push(`Updated ${result.updated} track${result.updated !== 1 ? 's' : ''}${result.errors.length ? ` · ${result.errors.length} tag error(s)` : ''}.`);
        if (result.updated > 0) setUndoPaths(paths);
        for (const fp of paths) {
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
      }

      if (bulkIgnore !== '') {
        const ignoreVal = bulkIgnore === 'true';
        const flagResult = await api.setTrackFlags(paths, ignoreVal);
        results.push(`DJ flag set for ${flagResult.updated} track${flagResult.updated !== 1 ? 's' : ''}${flagResult.errors.length ? ` · ${flagResult.errors.length} flag error(s)` : ''}.`);
        for (const fp of paths) {
          const idx = tracks.findIndex((t) => t.file_path === fp);
          if (idx !== -1) tracks[idx] = { ...tracks[idx], ignore_in_autodj: ignoreVal };
        }
      }

      saveResult = results.join(' ');
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
        <input class="bulk-field" placeholder="Album Artist" bind:value={bulkAlbumArtist} />
        <input class="bulk-field" placeholder="Album" bind:value={bulkAlbum} />
        <input class="bulk-field" placeholder="Genre" bind:value={bulkGenre} />
        <input class="bulk-field bulk-field--narrow" placeholder="Year" bind:value={bulkYear} />
        <select class="bulk-field bulk-field--narrow" bind:value={bulkIgnore} title="Skip in Auto DJ">
          <option value="">Skip DJ?</option>
          <option value="false">No</option>
          <option value="true">Yes</option>
        </select>
      </div>
      <div class="bulk-actions">
        {#if saveResult}
          <span class="save-result">{saveResult}</span>
        {/if}
        {#if undoPaths.length > 0}
          <button class="btn btn--ghost" onclick={undoLastOp} disabled={undoing}>
            {undoing ? 'Undoing…' : 'Undo'}
          </button>
        {/if}
        <button class="btn btn--ghost" onclick={clearBulk}>Clear</button>
        {#if confirmDelete}
          <span class="delete-confirm-label">Delete {selected.size} file{selected.size !== 1 ? 's' : ''}?</span>
          <button class="btn btn--danger" onclick={deleteTracks} disabled={saving}>Yes, delete</button>
          <button class="btn btn--ghost" onclick={() => (confirmDelete = false)}>Cancel</button>
        {:else}
          <button class="btn btn--ghost" onclick={retagSelected} disabled={saving || retagging} title="Auto-fix tags via audio fingerprint">
            {retagging ? 'Retagging…' : 'Retag'}
          </button>
          <button class="btn btn--danger-ghost" onclick={() => (confirmDelete = true)} disabled={saving}>
            Delete
          </button>
          <button class="btn btn--primary" onclick={applyTags} disabled={saving}>
            {saving ? 'Saving…' : 'Apply'}
          </button>
        {/if}
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
            <th class="col-title col-sortable" onclick={() => setSort('title')}>Title{sortKey==='title' ? (sortAsc?' ↑':' ↓') : ''}</th>
            <th class="col-artist col-sortable" onclick={() => setSort('artist')}>Artist{sortKey==='artist' ? (sortAsc?' ↑':' ↓') : ''}</th>
            <th class="col-album col-sortable" onclick={() => setSort('album')}>Album{sortKey==='album' ? (sortAsc?' ↑':' ↓') : ''}</th>
            <th class="col-genre col-sortable" onclick={() => setSort('genre')}>Genre{sortKey==='genre' ? (sortAsc?' ↑':' ↓') : ''}</th>
            <th class="col-year col-sortable" onclick={() => setSort('year')}>Year{sortKey==='year' ? (sortAsc?' ↑':' ↓') : ''}</th>
            <th class="col-dur col-sortable" onclick={() => setSort('duration')}>Duration{sortKey==='duration' ? (sortAsc?' ↑':' ↓') : ''}</th>
            <th class="col-added col-sortable" onclick={() => setSort('added_date')}>Added{sortKey==='added_date' ? (sortAsc?' ↑':' ↓') : ''}</th>
            <th class="col-skip col-sortable" onclick={() => setSort('ignore_in_autodj')}>Skip DJ{sortKey==='ignore_in_autodj' ? (sortAsc?' ↑':' ↓') : ''}</th>
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
              <td class="col-added">{formatDate(track.added_date)}</td>
              <td class="col-skip">
                {#if track.ignore_in_autodj}
                  <span class="skip-badge">Skip</span>
                {/if}
              </td>
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

  select.bulk-field {
    appearance: none;
    cursor: pointer;
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

  .btn--danger-ghost {
    background: transparent;
    color: #e05252;
    border: 1px solid #e05252;
  }

  .btn--danger-ghost:hover {
    background: rgba(224, 82, 82, 0.1);
  }

  .btn--danger {
    background: #e05252;
    color: #fff;
  }

  .btn--danger:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .delete-confirm-label {
    font-size: 13px;
    color: #e05252;
    font-weight: 600;
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

  .col-sortable {
    cursor: pointer;
    user-select: none;
  }

  .col-sortable:hover {
    color: var(--text-primary);
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
  .col-added { width: 110px; color: var(--text-subdued); white-space: nowrap; }
  .col-skip { width: 64px; text-align: center; }

  .skip-badge {
    display: inline-block;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(224, 82, 82, 0.15);
    color: #e05252;
  }

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
