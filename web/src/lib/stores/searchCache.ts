import type { Artist, Album, Song } from '$lib/subsonic';
import type { YouTubeResult } from '$lib/api';

export type SearchSnapshot = {
  query: string;
  libraryArtists: Artist[];
  libraryAlbums: Album[];
  librarySongs: Song[];
  librarySongsHasMore: boolean;
  youtubeResults: YouTubeResult[];
  cachedIds: string[];
  // How far the results were unfolded, so the restored page is the same height
  // as the one that was left — otherwise scroll restoration lands in the wrong
  // part of the list.
  expandedAlbums: string[];
  ytAlbumsVisible: number;
};

// Only the last search is kept: coming back from a track or album should land on
// the results you left, but an older search is not worth showing stale.
let last: SearchSnapshot | null = null;

function normalize(query: string): string {
  return query.trim().toLowerCase();
}

export function rememberSearch(snapshot: SearchSnapshot): void {
  last = snapshot;
}

// The Search tab links to a bare /search, so returning to it has no query to
// match on — it just wants whatever was last on screen.
export function lastSearch(): SearchSnapshot | null {
  return last;
}

export function cachedSearch(query: string): SearchSnapshot | null {
  if (!last || normalize(last.query) !== normalize(query)) return null;
  return last;
}

export function forgetSearch(): void {
  last = null;
}
