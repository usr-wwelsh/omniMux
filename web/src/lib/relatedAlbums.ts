import type { Album } from './subsonic';

const DEFAULT_LIMIT = 20;

function genreSet(a: Album): Set<string> {
  return new Set((a.genres ?? []).map((g) => g.trim().toLowerCase()).filter(Boolean));
}

export function relatedAlbums(current: Album, all: Album[], limit = DEFAULT_LIMIT): Album[] {
  const mine = genreSet(current);
  const sameArtist: Album[] = [];
  const scored: { album: Album; shared: number; ratio: number }[] = [];

  for (const a of all) {
    if (a.id === current.id) continue;
    if (a.artistId && a.artistId === current.artistId) {
      sameArtist.push(a);
      continue;
    }
    const theirs = genreSet(a);
    let shared = 0;
    for (const g of theirs) if (mine.has(g)) shared++;
    if (shared === 0) continue;
    scored.push({ album: a, shared, ratio: shared / (mine.size + theirs.size - shared) });
  }

  sameArtist.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  scored.sort((a, b) => b.shared - a.shared || b.ratio - a.ratio || a.album.name.localeCompare(b.album.name));

  return [...sameArtist, ...scored.map((s) => s.album)].slice(0, limit);
}
