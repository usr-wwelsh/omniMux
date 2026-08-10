import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/svelte';
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

  // A full library renders every album at once. Without lazy loading the browser
  // fires one cover request per card in a single burst, which Navidrome's
  // artwork throttle answers with 429s — the "missing art" the user sees.
  it('defers loading artwork until the card is near the viewport', async () => {
    render(AlbumCard, { album: album() });

    await waitFor(() =>
      expect(screen.getByRole('img').getAttribute('loading')).toBe('lazy'),
    );
  });

  it('retries once before giving up on artwork that fails to load', async () => {
    render(AlbumCard, { album: album() });

    const img = await waitFor(() => screen.getByRole('img'));
    const first = img.getAttribute('src');
    await fireEvent.error(img);

    await waitFor(() => {
      const retried = screen.getByRole('img').getAttribute('src');
      expect(retried).not.toBe(first);
      expect(retried).toContain('al-a1');
    });
  });

  it('falls back to the placeholder once the retry also fails', async () => {
    render(AlbumCard, { album: album() });

    await fireEvent.error(await waitFor(() => screen.getByRole('img')));
    await fireEvent.error(await waitFor(() => screen.getByRole('img')));

    await waitFor(() => expect(screen.queryByRole('img')).toBeNull());
  });
});
