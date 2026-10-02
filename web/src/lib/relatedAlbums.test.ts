import { describe, it, expect } from 'vitest';
import type { Album } from './subsonic';
import { relatedAlbums } from './relatedAlbums';

function album(id: string, artistId: string, genres: string[] = [], year?: number): Album {
  return { id, name: id, artist: artistId, artistId, songCount: 5, genres, year } as Album;
}

describe('relatedAlbums', () => {
  it('omits the album itself', () => {
    const cur = album('a1', 'x', ['jazz']);
    expect(relatedAlbums(cur, [cur, album('a2', 'x')]).map((a) => a.id)).toEqual(['a2']);
  });

  it('puts the same artist ahead of genre matches, newest first', () => {
    const cur = album('cur', 'x', ['jazz']);
    const all = [
      cur,
      album('genre', 'y', ['jazz']),
      album('old', 'x', [], 1959),
      album('new', 'x', [], 1970),
    ];
    expect(relatedAlbums(cur, all).map((a) => a.id)).toEqual(['new', 'old', 'genre']);
  });

  it('ranks other artists by shared genres, then by overlap ratio', () => {
    const cur = album('cur', 'x', ['techno', 'industrial']);
    const all = [
      cur,
      album('one', 'a', ['techno']),
      album('both-wide', 'b', ['techno', 'industrial', 'dark', 'hard']),
      album('both-tight', 'c', ['techno', 'industrial']),
    ];
    expect(relatedAlbums(cur, all).map((a) => a.id)).toEqual(['both-tight', 'both-wide', 'one']);
  });

  it('matches genres ignoring case and whitespace', () => {
    const cur = album('cur', 'x', ['Techno']);
    expect(relatedAlbums(cur, [cur, album('o', 'y', [' techno '])]).map((a) => a.id)).toEqual(['o']);
  });

  it('drops other artists who share no genre', () => {
    const cur = album('cur', 'x', ['jazz']);
    expect(relatedAlbums(cur, [cur, album('o', 'y', ['reggae']), album('n', 'z', [])])).toEqual([]);
  });

  it('adds no genre matches when the album has no genres', () => {
    const cur = album('cur', 'x', []);
    expect(relatedAlbums(cur, [cur, album('o', 'y', ['jazz'])])).toEqual([]);
  });

  it('caps the result', () => {
    const cur = album('cur', 'x', ['jazz']);
    const all = [cur, ...Array.from({ length: 30 }, (_, i) => album(`g${i}`, `y${i}`, ['jazz']))];
    expect(relatedAlbums(cur, all, 12)).toHaveLength(12);
  });
});
