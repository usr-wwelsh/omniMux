import { describe, it, expect, beforeEach } from 'vitest';
import { cachedSearch, rememberSearch, forgetSearch, lastSearch, type SearchSnapshot } from './searchCache';

function snapshot(query: string): SearchSnapshot {
  return {
    query,
    libraryArtists: [],
    libraryAlbums: [],
    librarySongs: [],
    librarySongsHasMore: false,
    youtubeResults: [],
    cachedIds: ['yt1'],
    expandedAlbums: ['Kind of Blue'],
    ytAlbumsVisible: 15,
  };
}

beforeEach(forgetSearch);

describe('search cache', () => {
  it('has nothing for a search never run', () => {
    expect(cachedSearch('miles davis')).toBeNull();
  });

  it('returns to a search where it was left', () => {
    rememberSearch(snapshot('miles davis'));
    const restored = cachedSearch('miles davis');
    expect(restored?.cachedIds).toEqual(['yt1']);
    expect(restored?.expandedAlbums).toEqual(['Kind of Blue']);
    expect(restored?.ytAlbumsVisible).toBe(15);
  });

  it('ignores whitespace and case the user did not mean', () => {
    rememberSearch(snapshot('Miles Davis'));
    expect(cachedSearch('  miles davis ')).not.toBeNull();
  });

  it('does not answer with results from a different search', () => {
    rememberSearch(snapshot('miles davis'));
    expect(cachedSearch('john coltrane')).toBeNull();
  });

  it('offers the last search to a search page opened without a query', () => {
    expect(lastSearch()).toBeNull();
    rememberSearch(snapshot('miles davis'));
    expect(lastSearch()?.query).toBe('miles davis');
  });

  it('forgets everything once the search box is cleared', () => {
    rememberSearch(snapshot('miles davis'));
    forgetSearch();
    expect(lastSearch()).toBeNull();
    expect(cachedSearch('miles davis')).toBeNull();
  });
});
