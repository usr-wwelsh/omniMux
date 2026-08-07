import { writable } from 'svelte/store';
import { subsonic, type Album, type Artist } from '$lib/subsonic';

export type SortKey = 'name' | 'artist' | 'added' | 'year' | 'played' | 'plays';

export type LibrarySnapshot = {
  albums: Album[];
  artists: Artist[];
  fetchedAt: number;
};

// Refetching every album and artist on each visit is what makes going "back" to
// the library feel like a page load. Hold the last snapshot for the session and
// let callers decide when it is old enough to refresh behind the rendered list.
export const LIBRARY_FRESH_MS = 60_000;

let snapshot: LibrarySnapshot | null = null;
let inflight: Promise<LibrarySnapshot> | null = null;
let rankings = new Map<SortKey, Map<string, number>>();

export function cachedLibrary(): LibrarySnapshot | null {
  return snapshot;
}

export function isStale(s: LibrarySnapshot, now = Date.now()): boolean {
  return now - s.fetchedAt > LIBRARY_FRESH_MS;
}

async function fetchLibrary(): Promise<LibrarySnapshot> {
  const [albums, artists] = await Promise.all([subsonic.getAllAlbums(), subsonic.getArtists()]);
  snapshot = { albums, artists, fetchedAt: Date.now() };
  return snapshot;
}

export function loadLibrary(): Promise<LibrarySnapshot> {
  if (snapshot) return Promise.resolve(snapshot);
  if (!inflight) {
    inflight = fetchLibrary().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

// Used for background revalidation, where a failure means the network is down —
// the cached library is still the best thing to show, so keep it.
export async function refreshLibrary(): Promise<LibrarySnapshot> {
  const previous = snapshot;
  try {
    return await fetchLibrary();
  } catch (err) {
    if (!previous) throw err;
    snapshot = previous;
    return previous;
  }
}

export function invalidateLibrary(): void {
  snapshot = null;
  rankings = new Map();
}

// Server-computed orderings (recently added / played / most played) belong to
// the snapshot they ranked, so they are cleared with it.
export function rememberRanking(key: SortKey, rank: Map<string, number>): void {
  rankings.set(key, rank);
}

export function recalledRanking(key: SortKey): Map<string, number> | undefined {
  return rankings.get(key);
}

// The toolbar is part of "where you were" too — a filter typed before opening an
// album should still be there on the way back.
export const libraryView = writable<{ filter: string; sortBy: SortKey; genreFilter: string }>({
  filter: '',
  sortBy: 'name',
  genreFilter: '',
});
