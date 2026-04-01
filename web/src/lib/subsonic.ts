import { get } from 'svelte/store';
import { auth } from './auth';

const NAVIDROME_URL = import.meta.env.VITE_NAVIDROME_URL || '/navidrome';

function md5(input: string): Promise<string> {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    return crypto.subtle.digest('MD5', data).then((hash) => {
      return Array.from(new Uint8Array(hash))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }).catch(() => {
      return '';
    });
  } catch {
    // crypto.subtle unavailable in non-secure contexts (HTTP + non-localhost)
    // Fall back to cleartext password via p= param
    return Promise.resolve('');
  }
}

function randomHex(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function subsonicParams(): Promise<URLSearchParams> {
  const { username, password } = get(auth);
  const salt = randomHex(8);
  const token = await md5(password + salt);

  const params = new URLSearchParams();
  params.set('u', username);
  if (token) {
    params.set('t', token);
    params.set('s', salt);
  } else {
    params.set('p', password);
  }
  params.set('v', '1.16.1');
  params.set('c', 'omniMux');
  params.set('f', 'json');
  return params;
}

async function subsonicGet(endpoint: string, extra: Record<string, string> = {}): Promise<any> {
  const params = await subsonicParams();
  for (const [k, v] of Object.entries(extra)) {
    params.set(k, v);
  }
  const res = await fetch(`${NAVIDROME_URL}/rest/${endpoint}?${params.toString()}`);
  const data = await res.json();
  const sr = data['subsonic-response'];
  if (sr?.status !== 'ok') {
    throw new Error(sr?.error?.message || 'Subsonic API error');
  }
  return sr;
}

export async function streamUrl(id: string): Promise<string> {
  const params = await subsonicParams();
  params.set('id', id);
  return `${NAVIDROME_URL}/rest/stream.view?${params.toString()}`;
}

export async function coverArtUrl(id: string, size = 300): Promise<string> {
  const params = await subsonicParams();
  params.set('id', id);
  params.set('size', size.toString());
  return `${NAVIDROME_URL}/rest/getCoverArt.view?${params.toString()}`;
}

export interface Playlist {
  id: string;
  name: string;
  songCount: number;
  duration: number;
  coverArt?: string;
}

export interface Artist {
  id: string;
  name: string;
  albumCount: number;
  coverArt?: string;
}

export interface Album {
  id: string;
  name: string;
  artist: string;
  artistId: string;
  coverArt?: string;
  songCount: number;
  year?: number;
  genre?: string;
}

export interface Song {
  id: string;
  title: string;
  artist: string;
  artistId: string;
  album: string;
  albumId: string;
  coverArt?: string;
  duration: number;
  track?: number;
  year?: number;
  genre?: string;
}

export const subsonic = {
  async ping(): Promise<boolean> {
    try {
      await subsonicGet('ping.view');
      return true;
    } catch {
      return false;
    }
  },

  async getArtists(): Promise<Artist[]> {
    const data = await subsonicGet('getArtists.view');
    const index = data.artists?.index || [];
    const artists: Artist[] = [];
    for (const group of index) {
      for (const a of group.artist || []) {
        artists.push({
          id: a.id,
          name: a.name,
          albumCount: a.albumCount || 0,
          coverArt: a.coverArt,
        });
      }
    }
    return artists;
  },

  async getArtist(id: string): Promise<{ artist: Artist; albums: Album[] }> {
    const data = await subsonicGet('getArtist.view', { id });
    const a = data.artist;
    return {
      artist: { id: a.id, name: a.name, albumCount: a.albumCount || 0, coverArt: a.coverArt },
      albums: (a.album || []).map((al: any) => ({
        id: al.id,
        name: al.name,
        artist: al.artist,
        artistId: al.artistId,
        coverArt: al.coverArt,
        songCount: al.songCount || 0,
        year: al.year,
        genre: al.genre,
      })),
    };
  },

  async getAlbum(id: string): Promise<{ album: Album; songs: Song[] }> {
    const data = await subsonicGet('getAlbum.view', { id });
    const al = data.album;
    return {
      album: {
        id: al.id,
        name: al.name,
        artist: al.artist,
        artistId: al.artistId,
        coverArt: al.coverArt,
        songCount: al.songCount || 0,
        year: al.year,
        genre: al.genre,
      },
      songs: (al.song || []).map((s: any) => ({
        id: s.id,
        title: s.title,
        artist: s.artist,
        artistId: s.artistId,
        album: s.album,
        albumId: s.albumId,
        coverArt: s.coverArt,
        duration: s.duration || 0,
        track: s.track,
        year: s.year,
        genre: s.genre,
      })),
    };
  },

  async search(query: string): Promise<{ artists: Artist[]; albums: Album[]; songs: Song[] }> {
    const data = await subsonicGet('search3.view', { query, artistCount: '15', albumCount: '10', songCount: '10' });
    const sr = data.searchResult3 || {};
    return {
      artists: (sr.artist || []).map((a: any) => ({
        id: a.id, name: a.name, albumCount: a.albumCount || 0, coverArt: a.coverArt,
      })),
      albums: (sr.album || []).map((al: any) => ({
        id: al.id, name: al.name, artist: al.artist, artistId: al.artistId,
        coverArt: al.coverArt, songCount: al.songCount || 0, year: al.year, genre: al.genre,
      })),
      songs: (sr.song || []).map((s: any) => ({
        id: s.id, title: s.title, artist: s.artist, artistId: s.artistId,
        album: s.album, albumId: s.albumId, coverArt: s.coverArt,
        duration: s.duration || 0, track: s.track, year: s.year, genre: s.genre,
      })),
    };
  },

  async getRecentAlbums(count = 20): Promise<Album[]> {
    const data = await subsonicGet('getAlbumList2.view', { type: 'newest', size: count.toString() });
    return (data.albumList2?.album || []).map((al: any) => ({
      id: al.id, name: al.name, artist: al.artist, artistId: al.artistId,
      coverArt: al.coverArt, songCount: al.songCount || 0, year: al.year, genre: al.genre,
    }));
  },

  async getRandomAlbums(count = 12): Promise<Album[]> {
    const data = await subsonicGet('getAlbumList2.view', { type: 'random', size: count.toString() });
    return (data.albumList2?.album || []).map((al: any) => ({
      id: al.id, name: al.name, artist: al.artist, artistId: al.artistId,
      coverArt: al.coverArt, songCount: al.songCount || 0, year: al.year, genre: al.genre,
    }));
  },

  async getAllAlbums(): Promise<Album[]> {
    const data = await subsonicGet('getAlbumList2.view', { type: 'alphabeticalByName', size: '500' });
    return (data.albumList2?.album || []).map((al: any) => ({
      id: al.id, name: al.name, artist: al.artist, artistId: al.artistId,
      coverArt: al.coverArt, songCount: al.songCount || 0, year: al.year, genre: al.genre,
    }));
  },

  async getRandomSongs(count = 20): Promise<Song[]> {
    const data = await subsonicGet('getRandomSongs.view', { size: count.toString() });
    return (data.randomSongs?.song || []).map((s: any) => ({
      id: s.id, title: s.title, artist: s.artist, artistId: s.artistId,
      album: s.album, albumId: s.albumId, coverArt: s.coverArt,
      duration: s.duration || 0, track: s.track, year: s.year, genre: s.genre,
    }));
  },

  async getPlaylists(): Promise<Playlist[]> {
    const data = await subsonicGet('getPlaylists.view');
    return (data.playlists?.playlist || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      songCount: p.songCount || 0,
      duration: p.duration || 0,
      coverArt: p.coverArt,
    }));
  },

  async getPlaylist(id: string): Promise<{ playlist: Playlist; songs: Song[] }> {
    const data = await subsonicGet('getPlaylist.view', { id });
    const p = data.playlist;
    return {
      playlist: {
        id: p.id,
        name: p.name,
        songCount: p.songCount || 0,
        duration: p.duration || 0,
        coverArt: p.coverArt,
      },
      songs: (p.entry || []).map((s: any) => ({
        id: s.id, title: s.title, artist: s.artist, artistId: s.artistId,
        album: s.album, albumId: s.albumId, coverArt: s.coverArt,
        duration: s.duration || 0, track: s.track, year: s.year, genre: s.genre,
      })),
    };
  },
};
