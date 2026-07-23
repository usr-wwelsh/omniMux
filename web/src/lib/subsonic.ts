import { get } from 'svelte/store';
import { auth } from './auth';

// All Subsonic traffic is proxied through the omniMux API, which injects the
// Navidrome credentials server-side. The browser only carries the JWT — no
// usernames, passwords, or salted tokens ever appear in a URL.
const LIBRARY_BASE = '/api/library';

async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  delaysMs = [500, 1000, 2000],
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]));
      }
    }
  }
  throw lastError;
}

async function subsonicGet(endpoint: string, extra: Record<string, string | string[]> = {}): Promise<any> {
  return withRetry(async () => {
    const { token } = get(auth);
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(extra)) {
      if (Array.isArray(value)) {
        for (const v of value) params.append(key, v);
      } else {
        params.append(key, value);
      }
    }
    const res = await fetch(`${LIBRARY_BASE}/rest/${endpoint}?${params.toString()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const data = await res.json();
    const sr = data['subsonic-response'];
    if (sr?.status !== 'ok') {
      throw new Error(sr?.error?.message || 'Subsonic API error');
    }
    return sr;
  });
}

// Media URLs are credential-free relative paths; the proxy authenticates the
// request via the httpOnly token cookie set at login.
export async function streamUrl(id: string): Promise<string> {
  return `${LIBRARY_BASE}/stream/${encodeURIComponent(id)}`;
}

export async function coverArtUrl(id: string, size = 800): Promise<string> {
  return `${LIBRARY_BASE}/cover/${encodeURIComponent(id)}?size=${size}`;
}

export async function fetchItunesArtwork(artist: string, album: string): Promise<string | null> {
  try {
    const query = encodeURIComponent(`${artist} ${album}`);
    const res = await fetch(`https://itunes.apple.com/search?term=${query}&entity=album&limit=5`);
    if (!res.ok) return null;
    const data = await res.json();
    const result = data.results?.[0];
    if (!result?.artworkUrl100) return null;
    // Replace 100x100bb with 3000x3000bb for maximum quality
    return (result.artworkUrl100 as string).replace('100x100bb', '3000x3000bb');
  } catch {
    return null;
  }
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
  bpm?: number;
  path?: string;
}

export const SEARCH_SONG_PAGE_SIZE = 20;

function mapSong(s: any): Song {
  return {
    id: s.id, title: s.title, artist: s.artist, artistId: s.artistId,
    album: s.album, albumId: s.albumId, coverArt: s.coverArt,
    duration: s.duration || 0, track: s.track, year: s.year, genre: s.genre,
    bpm: s.bpm || undefined,
  };
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
        bpm: s.bpm || undefined,
        path: s.path,
      })),
    };
  },

  async searchArtistAlbums(artistName: string): Promise<Album[]> {
    const data = await subsonicGet('search3.view', { query: artistName, artistCount: '0', albumCount: '500', songCount: '0' });
    const sr = data.searchResult3 || {};
    const name = artistName.toLowerCase();
    return (sr.album || [])
      .filter((al: any) => al.artist?.toLowerCase() === name)
      .map((al: any) => ({
        id: al.id, name: al.name, artist: al.artist, artistId: al.artistId,
        coverArt: al.coverArt, songCount: al.songCount || 0, year: al.year, genre: al.genre,
      }));
  },

  async search(query: string): Promise<{ artists: Artist[]; albums: Album[]; songs: Song[] }> {
    const data = await subsonicGet('search3.view', { query, artistCount: '15', albumCount: '10', songCount: SEARCH_SONG_PAGE_SIZE.toString() });
    const sr = data.searchResult3 || {};
    return {
      artists: (sr.artist || []).map((a: any) => ({
        id: a.id, name: a.name, albumCount: a.albumCount || 0, coverArt: a.coverArt,
      })),
      albums: (sr.album || []).map((al: any) => ({
        id: al.id, name: al.name, artist: al.artist, artistId: al.artistId,
        coverArt: al.coverArt, songCount: al.songCount || 0, year: al.year, genre: al.genre,
      })),
      songs: (sr.song || []).map(mapSong),
    };
  },

  // Paginated continuation of search()'s song results, for "Show more" in the UI.
  async searchMoreSongs(query: string, offset: number): Promise<Song[]> {
    const data = await subsonicGet('search3.view', {
      query, artistCount: '0', albumCount: '0',
      songCount: SEARCH_SONG_PAGE_SIZE.toString(), songOffset: offset.toString(),
    });
    const sr = data.searchResult3 || {};
    return (sr.song || []).map(mapSong);
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
    const albums: Album[] = [];
    const size = 500;
    let offset = 0;
    while (true) {
      const data = await subsonicGet('getAlbumList2.view', { type: 'alphabeticalByName', size: size.toString(), offset: offset.toString() });
      const batch = (data.albumList2?.album || []).map((al: any) => ({
        id: al.id, name: al.name, artist: al.artist, artistId: al.artistId,
        coverArt: al.coverArt, songCount: al.songCount || 0, year: al.year, genre: al.genre,
      }));
      if (batch.length === 0) break;
      albums.push(...batch);
      offset += size;
    }
    return albums;
  },

  async getRandomSongs(count = 20): Promise<Song[]> {
    const data = await subsonicGet('getRandomSongs.view', { size: count.toString() });
    return (data.randomSongs?.song || []).map((s: any) => ({
      id: s.id, title: s.title, artist: s.artist, artistId: s.artistId,
      album: s.album, albumId: s.albumId, coverArt: s.coverArt,
      duration: s.duration || 0, track: s.track, year: s.year, genre: s.genre,
      bpm: s.bpm || undefined,
    }));
  },

  // Records a play in Navidrome's local DB. submission=false → "now playing",
  // submission=true → counts the play (increments playCount / sets last-played).
  async scrobble(id: string, submission: boolean): Promise<void> {
    await subsonicGet('scrobble.view', {
      id,
      submission: submission ? 'true' : 'false',
      time: Date.now().toString(),
    });
  },

  async getRecentlyPlayed(count = 20): Promise<Album[]> {
    const data = await subsonicGet('getAlbumList2.view', { type: 'recent', size: count.toString() });
    return (data.albumList2?.album || []).map((al: any) => ({
      id: al.id, name: al.name, artist: al.artist, artistId: al.artistId,
      coverArt: al.coverArt, songCount: al.songCount || 0, year: al.year, genre: al.genre,
    }));
  },

  async getMostPlayed(count = 20): Promise<Album[]> {
    const data = await subsonicGet('getAlbumList2.view', { type: 'frequent', size: count.toString() });
    return (data.albumList2?.album || []).map((al: any) => ({
      id: al.id, name: al.name, artist: al.artist, artistId: al.artistId,
      coverArt: al.coverArt, songCount: al.songCount || 0, year: al.year, genre: al.genre,
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

  async getPlaylistCoverArts(id: string, count = 4): Promise<string[]> {
    const data = await subsonicGet('getPlaylist.view', { id });
    return (data.playlist?.entry || [])
      .slice(0, count)
      .filter((s: any) => s.coverArt)
      .map((s: any) => s.coverArt as string);
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
        bpm: s.bpm || undefined,
      })),
    };
  },

  async createPlaylist(name: string, songIds: string[] = []): Promise<Playlist> {
    const params: Record<string, string | string[]> = { name };
    if (songIds.length > 0) params.songId = songIds;
    const data = await subsonicGet('createPlaylist.view', params);
    const p = data.playlist;
    return {
      id: p.id,
      name: p.name,
      songCount: p.songCount || 0,
      duration: p.duration || 0,
      coverArt: p.coverArt,
    };
  },

  async renamePlaylist(id: string, name: string): Promise<void> {
    await subsonicGet('updatePlaylist.view', { playlistId: id, name });
  },

  async deletePlaylist(id: string): Promise<void> {
    await subsonicGet('deletePlaylist.view', { id });
  },

  // Subsonic's updatePlaylist doesn't dedupe songIdToAdd, so filter out songs
  // already in the playlist ourselves to keep re-adds a no-op.
  async addSongsToPlaylist(id: string, songIds: string[]): Promise<void> {
    if (songIds.length === 0) return;
    const { songs: existingSongs } = await this.getPlaylist(id);
    const existing = new Set(existingSongs.map((s) => s.id));
    const toAdd = songIds.filter((sid) => !existing.has(sid));
    if (toAdd.length === 0) return;
    await subsonicGet('updatePlaylist.view', { playlistId: id, songIdToAdd: toAdd });
  },

  async removeSongsFromPlaylist(id: string, indexes: number[]): Promise<void> {
    if (indexes.length === 0) return;
    await subsonicGet('updatePlaylist.view', { playlistId: id, songIndexToRemove: indexes.map(String) });
  },
};
