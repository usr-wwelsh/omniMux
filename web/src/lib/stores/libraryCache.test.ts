import { describe, it, expect, vi, beforeEach } from 'vitest';

const getAllAlbums = vi.fn();
const getArtists = vi.fn();

vi.mock('$lib/subsonic', () => ({
  subsonic: {
    getAllAlbums: () => getAllAlbums(),
    getArtists: () => getArtists(),
  },
}));

async function freshCache() {
  vi.resetModules();
  return import('./libraryCache');
}

beforeEach(() => {
  getAllAlbums.mockReset().mockResolvedValue([{ id: 'al1', name: 'Kind of Blue' }]);
  getArtists.mockReset().mockResolvedValue([{ id: 'ar1', name: 'Miles Davis' }]);
});

describe('library cache', () => {
  it('has nothing to show before the first load', async () => {
    const { cachedLibrary } = await freshCache();
    expect(cachedLibrary()).toBeNull();
  });

  it('serves a revisit without touching the server', async () => {
    const { loadLibrary } = await freshCache();
    await loadLibrary();
    const second = await loadLibrary();
    expect(getAllAlbums).toHaveBeenCalledTimes(1);
    expect(second.albums).toHaveLength(1);
  });

  it('shares one request between callers that arrive together', async () => {
    const { loadLibrary } = await freshCache();
    const [a, b] = await Promise.all([loadLibrary(), loadLibrary()]);
    expect(getArtists).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it('fetches again after the library is invalidated', async () => {
    const { loadLibrary, invalidateLibrary, cachedLibrary } = await freshCache();
    await loadLibrary();
    invalidateLibrary();
    expect(cachedLibrary()).toBeNull();
    await loadLibrary();
    expect(getAllAlbums).toHaveBeenCalledTimes(2);
  });

  it('picks up new music on an explicit refresh', async () => {
    const { loadLibrary, refreshLibrary } = await freshCache();
    await loadLibrary();
    getAllAlbums.mockResolvedValue([{ id: 'al1' }, { id: 'al2' }]);
    const refreshed = await refreshLibrary();
    expect(refreshed.albums).toHaveLength(2);
  });

  it('keeps showing the cached library when a refresh fails', async () => {
    const { loadLibrary, refreshLibrary, cachedLibrary } = await freshCache();
    const first = await loadLibrary();
    getAllAlbums.mockRejectedValue(new Error('offline'));
    await expect(refreshLibrary()).resolves.toBe(first);
    expect(cachedLibrary()).toBe(first);
  });

  it('stamps the snapshot so callers can tell how stale it is', async () => {
    const { loadLibrary } = await freshCache();
    const before = Date.now();
    const snapshot = await loadLibrary();
    expect(snapshot.fetchedAt).toBeGreaterThanOrEqual(before);
  });

  it('drops sort rankings along with the albums they ordered', async () => {
    const { rememberRanking, recalledRanking, invalidateLibrary } = await freshCache();
    rememberRanking('added', new Map([['al1', 0]]));
    expect(recalledRanking('added')?.get('al1')).toBe(0);
    invalidateLibrary();
    expect(recalledRanking('added')).toBeUndefined();
  });
});
