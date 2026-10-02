import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/svelte';
import type { Album } from '$lib/subsonic';

const loadLibrary = vi.fn();
let failLoad = false;

vi.mock('$lib/subsonic', () => ({
  coverArtUrl: async (id: string, size: number) => `/api/library/cover/${id}?size=${size}`,
  subsonic: { getAlbum: async () => ({ songs: [] }) },
}));

vi.mock('$lib/stores/libraryCache', () => ({
  loadLibrary: () => (failLoad ? (loadLibrary(), Promise.reject(new Error('boom'))) : loadLibrary()),
}));

vi.mock('$lib/stores/player', () => ({
  addSongToQueue: async () => {},
}));

import RelatedAlbums from './RelatedAlbums.svelte';

function album(id: string, name: string, artistId = 'ar1', genres: string[] = []): Album {
  return { id, name, artist: artistId, artistId, coverArt: `al-${id}`, songCount: 5, genres } as Album;
}

const library = (albums: Album[]) => ({ albums, artists: [], fetchedAt: 0 });

beforeEach(() => {
  loadLibrary.mockReset();
  failLoad = false;
});
afterEach(cleanup);

describe('RelatedAlbums', () => {
  it('shows the artist’s other albums and genre neighbours, never the current album', async () => {
    const cur = album('a1', 'Kind of Blue', 'ar1', ['jazz']);
    loadLibrary.mockResolvedValue(
      library([cur, album('a2', 'Bitches Brew', 'ar1'), album('b1', 'Blue Train', 'ar2', ['Jazz']), album('c1', 'Dub Plate', 'ar3', ['dub'])]),
    );

    render(RelatedAlbums, { album: cur });

    await waitFor(() => expect(screen.getByText('Blue Train')).toBeTruthy());
    expect(screen.getByText('Bitches Brew')).toBeTruthy();
    expect(screen.queryByText('Kind of Blue')).toBeNull();
    expect(screen.queryByText('Dub Plate')).toBeNull();
  });

  it('renders nothing when nothing is related', async () => {
    const cur = album('a1', 'Kind of Blue');
    loadLibrary.mockResolvedValue(library([cur]));

    const { container } = render(RelatedAlbums, { album: cur });

    await waitFor(() => expect(loadLibrary).toHaveBeenCalled());
    expect(container.querySelector('section')).toBeNull();
  });

  it('renders nothing when the library fails to load', async () => {
    failLoad = true;

    const { container } = render(RelatedAlbums, { album: album('a1', 'Kind of Blue') });

    await waitFor(() => expect(loadLibrary).toHaveBeenCalled());
    expect(container.querySelector('section')).toBeNull();
  });

  it('reloads when the album changes', async () => {
    const one = album('a1', 'Kind of Blue', 'ar1');
    const two = album('b1', 'Blue Train', 'ar2');
    loadLibrary.mockResolvedValue(library([one, album('a2', 'Bitches Brew', 'ar1'), two, album('b2', 'Moanin', 'ar2')]));
    const { rerender } = render(RelatedAlbums, { album: one });
    await waitFor(() => expect(screen.getByText('Bitches Brew')).toBeTruthy());

    await rerender({ album: two });

    await waitFor(() => expect(screen.getByText('Moanin')).toBeTruthy());
    expect(screen.queryByText('Bitches Brew')).toBeNull();
  });
});
