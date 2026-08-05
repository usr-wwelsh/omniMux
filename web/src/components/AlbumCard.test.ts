import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/svelte';
import type { Album } from '$lib/subsonic';

vi.mock('$lib/subsonic', () => ({
  coverArtUrl: async (id: string, size: number) => `/api/library/cover/${id}?size=${size}`,
  subsonic: { getAlbum: async () => ({ songs: [] }) },
}));

vi.mock('$lib/stores/player', () => ({
  addSongToQueue: async () => {},
}));

import AlbumCard from './AlbumCard.svelte';

function album(overrides: Partial<Album> = {}): Album {
  return {
    id: 'a1',
    name: 'Kind of Blue',
    artist: 'Miles Davis',
    coverArt: 'al-a1',
    songCount: 5,
    ...overrides,
  } as Album;
}

afterEach(cleanup);

describe('AlbumCard artwork', () => {
  it('drops the artwork when the album it is reused for has none', async () => {
    const { rerender } = render(AlbumCard, { album: album() });

    await waitFor(() => expect(screen.getByRole('img')).toBeTruthy());

    await rerender({ album: album({ id: 'a2', name: 'Bootleg', coverArt: undefined }) });

    await waitFor(() => expect(screen.queryByRole('img')).toBeNull());
  });

  it('swaps the artwork when the album it is reused for has its own', async () => {
    const { rerender } = render(AlbumCard, { album: album() });

    await waitFor(() => expect(screen.getByRole('img')).toBeTruthy());

    await rerender({ album: album({ id: 'a2', name: 'Milestones', coverArt: 'al-a2' }) });

    await waitFor(() =>
      expect(screen.getByRole('img').getAttribute('src')).toContain('al-a2'),
    );
  });
});
